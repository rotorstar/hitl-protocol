import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { calculateJwkThumbprint } from 'jose'
import { Pool } from 'pg'
import { z } from 'zod'
import {
  createAuthorizationRequest, exchangeAuthorizationCode, generateDPoPKey, createDPoPProof,
  EnrollmentResponseSchema, OperationResponseSchema, AgentAccessContextSchema,
  type DPoPKeyPair, type EnrollmentResponse, type OperationResponse, type PrepareInput,
} from '@hitl-protocol/agent-access'

export const PUBLIC_BASE = 'http://127.0.0.1:8789'
export const ISSUER = 'http://localhost:8189/realms/hitl'
export const DATABASE_URL = process.env.EVAL_DATABASE_URL ?? 'postgresql://hitl:hitl-local@127.0.0.1:5459/hitl'
const CALLBACK = 'http://127.0.0.1:8899/callback'
const REFERENCE = fileURLToPath(new URL('../', import.meta.url))
const SCOPES = ['profile', 'hitl:agent:enroll', 'hitl:reviews:read', 'bookings:read', 'bookings:prepare', 'bookings:commit']
const TOKENS = z.object({ access_token: z.string(), refresh_token: z.string().optional() })
const HitlEnvelope = z.object({ status: z.literal('human_input_required'), hitl: z.object({
  case_id: z.string(), review_url: z.url(), poll_url: z.url(),
  context: z.object({ 'x-hitl-agent-access': AgentAccessContextSchema }),
}).passthrough() })
export type Prepared = { operation: OperationResponse; reviewUrl?: string; caseId?: string }
export type FixtureUser = 'alice' | 'bob'
export interface AgentFixture {
  user: FixtureUser; key: DPoPKeyPair; accessToken: string; refreshToken?: string; nonce?: string
  enrollment?: EnrollmentResponse
}
export interface Worker { port: number; child: ChildProcess; output: () => string }
export interface HttpResult { status: number; body: unknown; headers: Headers }
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Only fixture passwords are used. Every identity comes from the real authorization server. */
export async function completeLoginForm(page: Page, user: FixtureUser): Promise<void> {
  const username = page.locator('#username')
  if (await username.isVisible()) await username.fill(user)
  // Keycloak's reauthentication page retains the selected user and renders
  // only the password control. It is still a real credential check.
  if (await page.locator('#password').isVisible()) {
    await page.locator('#password').fill(`${user}-local-eval`)
    await page.locator('#kc-login').click()
  }
}

export class EvalHarness {
  readonly namespace = `eval-auth-${randomUUID()}`
  readonly pool = new Pool({ connectionString: DATABASE_URL, max: 30, connectionTimeoutMillis: 2000 })
  readonly workers: Worker[] = []
  readonly contexts: BrowserContext[] = []
  readonly agents: AgentFixture[] = []
  readonly offerIds: string[] = []
  readonly sessionHashes = new Set<string>()
  browser?: Browser
  private callbackServer?: Server
  private readonly callbacks = new Map<string, (url: string) => void>()

  private async startupPhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try { return await run() }
    catch (cause) {
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
      throw new Error(`Eval startup ${phase} failed after ${Math.round(performance.now() - started)}ms: ${detail}`, { cause })
    }
  }

  async start(options: { callbackServer?: boolean } = {}): Promise<void> {
    // Missing infrastructure is a failure: these evals must never become skipped green tests.
    await this.startupPhase('PostgreSQL readiness', async () => {
      const version = await this.pool.query<{ server_version: string }>('SHOW server_version')
      if (!version.rows[0]?.server_version.startsWith('18.')) throw new Error('Evals require actual PostgreSQL 18')
    })
    await this.startupPhase('Keycloak discovery (5000ms budget)', async () => {
      const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) })
      if (!discovery.ok) throw new Error(`Actual Keycloak realm returned HTTP ${discovery.status}`)
      const metadata = z.object({ issuer: z.literal(ISSUER), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url() })
        .parse(await discovery.json())
      if (!metadata.token_endpoint.startsWith(`${ISSUER}/`)) throw new Error('Unexpected fixture token endpoint')
    })
    await this.startupPhase('HTTP worker 8789', () => this.startWorker(8789))
    await this.startupPhase('HTTP worker 8790', () => this.startWorker(8790))
    this.browser = await this.startupPhase('Chromium launch', () => chromium.launch({ headless: true }))
    if (options.callbackServer === false) return
    this.callbackServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', CALLBACK)
      const deliver = this.callbacks.get(url.searchParams.get('state') ?? '')
      if (url.pathname !== '/callback' || !deliver) { response.writeHead(400); response.end('Unexpected callback'); return }
      this.callbacks.delete(url.searchParams.get('state')!)
      deliver(url.href)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Agent authenticated</title><p>Agent authenticated.</p>')
    })
    await this.startupPhase('agent callback listener 8899', async () => {
      this.callbackServer!.listen(8899, '127.0.0.1')
      await once(this.callbackServer!, 'listening')
    })
  }

  async startWorker(port: number, policyVersion = 1, delayedWrite?: { id: string; kind: 'review' | 'enrollment' }): Promise<Worker> {
    await access(`${REFERENCE}/dist/server.js`)
    await new Promise<void>((resolve, reject) => {
      const probe = createNetServer()
      probe.once('error', reject)
      probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : resolve()))
    })
    let output = ''
    // An eval-only transport seam delays exactly one guarded UPDATE before PostgreSQL evaluates
    // its clock predicate. Production Store/Auth/OIDC and the actual HTTP entrypoint stay intact.
    const command = delayedWrite ? ['--input-type=module', '--eval', `
      import pg from 'pg';
      const original = pg.Client.prototype.query;
      const fixtureId = ${JSON.stringify(delayedWrite.id)};
      const prefix = ${JSON.stringify(delayedWrite.kind === 'review' ? "UPDATE reviews SET status='completed'" : "UPDATE enrollments SET status='confirmed'")};
      pg.Client.prototype.query = function(text, ...args) {
        if (typeof text === 'string' && text.startsWith(prefix) && args[0]?.[0] === fixtureId) {
          console.log('EVAL_GUARDED_WRITE_CAPTURED');
          return original.call(this, 'SELECT pg_sleep(greatest(0,extract(epoch FROM(to_timestamp($1+300.05)-clock_timestamp()))))', [args[0][3]])
            .then(() => original.call(this, text, ...args));
        }
        return original.call(this, text, ...args);
      };
      await import('./dist/server.js');
    `] : ['dist/server.js']
    const child = spawn(process.execPath, command, { cwd: REFERENCE, env: {
      ...process.env, DATABASE_URL, PUBLIC_BASE_URL: PUBLIC_BASE, OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: PUBLIC_BASE, OIDC_BROWSER_CLIENT_ID: 'hitl-browser',
      OIDC_BROWSER_CLIENT_SECRET: 'local-browser-only', OIDC_INTROSPECTION_CLIENT_ID: 'hitl-resource',
      OIDC_INTROSPECTION_CLIENT_SECRET: 'local-resource-only', SERVICE_NAMESPACE: this.namespace,
      PORT: String(port), HOST: '127.0.0.1', POLICY_VERSION: String(policyVersion), ALLOW_INSECURE_LOCALHOST: 'true',
    }, stdio: ['ignore', 'pipe', 'pipe'] })
    const capture = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-12000) }
    child.stdout?.on('data', capture); child.stderr?.on('data', capture)
    const worker = { port, child, output: () => output }
    this.workers.push(worker)
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Worker ${port} exited: ${output}`)
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) return worker }
      catch { /* The owned process is still starting. Its exit/output are checked above. */ }
      await pause(100)
    }
    throw new Error(`Worker ${port} did not become healthy: ${output}`)
  }

  async context(): Promise<BrowserContext> {
    if (!this.browser) throw new Error('Harness has not started')
    const context = await this.browser.newContext()
    this.contexts.push(context)
    return context
  }

  async loginAgent(user: FixtureUser, options: { wrongVerifier?: boolean } = {}): Promise<AgentFixture> {
    const key = await generateDPoPKey()
    const config = { issuer: ISSUER, clientId: 'hitl-agent', redirectUri: CALLBACK, allowInsecureLocalhost: true }
    const attempt = await createAuthorizationRequest(config, { scopes: SCOPES, dpopKey: key })
    let callbackTimeout: ReturnType<typeof setTimeout> | undefined
    const callback = new Promise<string>((resolve, reject) => {
      callbackTimeout = setTimeout(() => { this.callbacks.delete(attempt.state); reject(new Error('Agent login callback timed out')) }, 30000)
      this.callbacks.set(attempt.state, (url) => { clearTimeout(callbackTimeout); resolve(url) })
    })
    void callback.catch(() => undefined) // A failed browser navigation is reported by its own awaited operation.
    const context = await this.context()
    const page = await context.newPage()
    try {
      await page.goto(attempt.authorizationUrl)
      await completeLoginForm(page, user)
      const tokens = TOKENS.parse(await exchangeAuthorizationCode(config, { callbackUrl: await callback,
        state: attempt.state, nonce: attempt.nonce, codeVerifier: options.wrongVerifier ? randomUUID().replaceAll('-', '').repeat(2) : attempt.codeVerifier }, key))
      const fixture: AgentFixture = { user, key, accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}) }
      this.agents.push(fixture)
      return fixture
    } finally { clearTimeout(callbackTimeout); this.callbacks.delete(attempt.state); await page.close() }
  }

  /** The URL in the proof is always the trusted public origin, including on worker 2. */
  async request(agent: AgentFixture, path: string, options: {
    method?: string; body?: unknown; idempotencyKey?: string; port?: number; headers?: HeadersInit
  } = {}): Promise<HttpResult> {
    const canonical = new URL(path, PUBLIC_BASE).href
    const method = options.method ?? 'GET'
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(options.headers)
      headers.set('Authorization', `DPoP ${agent.accessToken}`)
      headers.set('DPoP', await createDPoPProof({ url: canonical, method, key: agent.key,
        accessToken: agent.accessToken, ...(agent.nonce ? { nonce: agent.nonce } : {}) }))
      if (options.body !== undefined) headers.set('Content-Type', 'application/json')
      if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
      const transport = new URL(canonical); transport.port = String(options.port ?? 8789)
      const response = await fetch(transport, { method, headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(10000) })
      const nonce = response.headers.get('DPoP-Nonce')
      if (attempt === 0 && response.status === 401 && nonce) { agent.nonce = nonce; await response.body?.cancel(); continue }
      return { status: response.status, body: response.status === 304 ? undefined : await response.json(), headers: response.headers }
    }
    throw new Error('DPoP nonce retry exhausted')
  }

  async createEnrollment(agent: AgentFixture, maxTotal = 50000): Promise<EnrollmentResponse> {
    const created = await this.request(agent, '/v1/agent-enrollments', { method: 'POST',
      body: { display_name: `eval-${this.namespace}-${agent.user}`, max_total_cents: maxTotal } })
    if (created.status !== 201) throw new Error(`Enrollment failed: ${JSON.stringify(created)}`)
    return EnrollmentResponseSchema.parse(created.body)
  }

  async enroll(agent: AgentFixture, owner: BrowserContext, maxTotal = 50000): Promise<EnrollmentResponse> {
    const enrollment = await this.createEnrollment(agent, maxTotal)
    const page = await owner.newPage()
    try {
      await page.goto(enrollment.verification_url)
      await completeLoginForm(page, agent.user)
      const [posted] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === new URL(enrollment.verification_url).pathname),
        page.getByRole('button', { name: 'Connect this agent', exact: true }).click(),
      ])
      if (posted.status() !== 303) {
        const headers = await posted.request().allHeaders()
        const csrfCookie = (await owner.cookies(PUBLIC_BASE)).find((cookie) => cookie.name === 'hitl-csrf')
        const postedCsrf = new URLSearchParams(posted.request().postData() ?? '').get('csrf')
        throw new Error(`Native owner consent POST status=${posted.status()} Origin=${headers.origin ?? 'absent'} csrf_cookie_present=${Boolean(headers.cookie?.includes('hitl-csrf='))} form_matches_browser_cookie=${postedCsrf === csrfCookie?.value}`)
      }
      await page.getByRole('status').filter({ hasText: 'Connection confirmed.' }).waitFor()
      await this.rememberSession(owner)
    } catch (error) {
      const location = new URL(page.url()); location.search = ''; location.hash = ''
      throw new Error(`Real owner enrollment page failed at ${location.href}: ${(await page.locator('body').innerText()).slice(0, 2000)}`, { cause: error })
    } finally { await page.close() }
    const confirmed = await this.request(agent, `/v1/agent-enrollments/${enrollment.id}`)
    agent.enrollment = EnrollmentResponseSchema.parse(confirmed.body)
    if (agent.enrollment.status !== 'confirmed' || !agent.enrollment.grant_id || !agent.enrollment.principal_id)
      throw new Error('Browser owner did not confirm a usable delegation')
    return agent.enrollment
  }

  async rememberSession(context: BrowserContext): Promise<void> {
    const cookie = (await context.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')
    if (cookie) this.sessionHashes.add(createHash('sha256').update(cookie.value).digest('hex'))
  }

  async offer(options: { price?: number; fee?: number; refundable?: boolean; stock?: number } = {}): Promise<string> {
    const id = `eval_offer_${randomUUID()}`
    await this.pool.query(`INSERT INTO offers(id,title,unit_price_cents,fee_cents,refundable,terms,stock)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, `Integration offer ${id}`, options.price ?? 1000,
      options.fee ?? 0, options.refundable ?? true, 'Actual PostgreSQL integration fixture', options.stock ?? 50])
    this.offerIds.push(id)
    return id
  }

  input(agent: AgentFixture, offerId: string, quantity = 1, offerVersion = 1): PrepareInput {
    if (!agent.enrollment?.grant_id) throw new Error('Agent is not enrolled')
    return { grant_id: agent.enrollment.grant_id, offer_id: offerId, offer_version: offerVersion, quantity }
  }

  async prepare(agent: AgentFixture, input: PrepareInput, key = randomUUID(), port = 8789): Promise<Prepared> {
    const response = await this.request(agent, '/v1/bookings/prepare', { method: 'POST', body: input, idempotencyKey: key, port })
    if (response.status === 200) return { operation: OperationResponseSchema.parse(response.body) }
    if (response.status !== 202) throw new Error(`Prepare failed (${response.status}): ${JSON.stringify(response.body)}`)
    const envelope = HitlEnvelope.parse(response.body)
    const binding = envelope.hitl.context['x-hitl-agent-access']
    const operation = await this.request(agent, `/v1/operations/${binding.operation_id}`, { port })
    if (operation.status !== 200) throw new Error(`Read prepared operation failed: ${JSON.stringify(operation.body)}`)
    return { operation: OperationResponseSchema.parse(operation.body), reviewUrl: envelope.hitl.review_url, caseId: envelope.hitl.case_id }
  }

  commit(agent: AgentFixture, operation: OperationResponse, port = 8789): Promise<HttpResult> {
    return this.request(agent, `/v1/operations/${operation.operation_id}/commit`, { method: 'POST', port,
      body: { expected_version: operation.operation_version, snapshot_digest: operation.snapshot_digest } })
  }

  async openReview(owner: BrowserContext, prepared: Prepared): Promise<Page> {
    if (!prepared.reviewUrl) throw new Error('Operation has no human review')
    const page = await owner.newPage()
    await page.goto(prepared.reviewUrl)
    await page.getByRole('heading', { name: 'Review booking proposal', exact: true }).waitFor()
    return page
  }

  async confirm(owner: BrowserContext, prepared: Prepared): Promise<void> {
    const page = await this.openReview(owner, prepared)
    try {
      await page.getByRole('button', { name: 'Confirm proposal', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Confirmation recorded.' }).waitFor()
    } finally { await page.close() }
  }

  async resetScenario(): Promise<void> {
    await this.pool.query(`DELETE FROM quotas WHERE key LIKE $1 OR key IN
      (SELECT 'review-links:'||r.id FROM reviews r JOIN operations o ON o.id=r.operation_id WHERE o.namespace=$2)`, [`%:${this.namespace}:%`, this.namespace])
    await this.pool.query('DELETE FROM audit_events WHERE operation_id IN (SELECT id FROM operations WHERE namespace=$1)', [this.namespace])
    await this.pool.query('DELETE FROM review_capabilities WHERE review_id IN (SELECT r.id FROM reviews r JOIN operations o ON o.id=r.operation_id WHERE o.namespace=$1)', [this.namespace])
    await this.pool.query('DELETE FROM reviews WHERE operation_id IN (SELECT id FROM operations WHERE namespace=$1)', [this.namespace])
    await this.pool.query('DELETE FROM bookings WHERE operation_id IN (SELECT id FROM operations WHERE namespace=$1)', [this.namespace])
    await this.pool.query('DELETE FROM idempotency WHERE namespace=$1', [this.namespace])
    await this.pool.query('DELETE FROM operations WHERE namespace=$1', [this.namespace])
  }

  /** Close the response socket before its body is observed; the write has already committed. */
  async loseCommitResponse(agent: AgentFixture, operation: OperationResponse, port = 8789): Promise<void> {
    const path = `/v1/operations/${operation.operation_id}/commit`
    const proof = await createDPoPProof({ url: `${PUBLIC_BASE}${path}`, method: 'POST', key: agent.key,
      accessToken: agent.accessToken, ...(agent.nonce ? { nonce: agent.nonce } : {}) })
    const body = JSON.stringify({ expected_version: operation.operation_version, snapshot_digest: operation.snapshot_digest })
    await new Promise<void>((resolve, reject) => {
      const transport = new URL(`${PUBLIC_BASE}${path}`); transport.port = String(port)
      const request = httpRequest(transport, { method: 'POST', headers: {
        Authorization: `DPoP ${agent.accessToken}`, DPoP: proof, 'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      } }, (response) => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`Lost-response request failed ${response.statusCode}`)); return }
        response.destroy(); request.destroy(); resolve()
      })
      request.setTimeout(10000, () => request.destroy(new Error('Commit transport timed out')))
      request.once('error', reject)
      request.end(body)
    })
  }

  async stopWorker(port: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
    const worker = this.workers.findLast((entry) => entry.port === port && entry.child.exitCode === null && entry.child.signalCode === null)
    if (!worker) return
    const exited = once(worker.child, 'exit')
    worker.child.kill(signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), 5000) })
      if (await Promise.race([exited, timeout]) === 'timeout') { worker.child.kill('SIGKILL'); await exited }
    } finally { clearTimeout(timer) }
  }

  async close(): Promise<void> {
    const errors: unknown[] = []
    for (const context of this.contexts) { try { await this.rememberSession(context) } catch (error) { errors.push(error) } }
    try { await this.browser?.close() } catch (error) { errors.push(error) }
    if (this.callbackServer?.listening) await new Promise<void>((resolve) => this.callbackServer!.close(() => resolve()))
    for (const worker of this.workers) await this.stopWorker(worker.port)
    try {
      await this.resetScenario()
      const persisted = z.array(z.object({ jkt: z.string() })).parse((await this.pool.query(
        'SELECT jkt FROM principals WHERE namespace=$1 UNION SELECT jkt FROM enrollments WHERE namespace=$1', [this.namespace])).rows)
      const fixtureKeys = await Promise.all(this.agents.map(async (agent) => calculateJwkThumbprint(await crypto.subtle.exportKey('jwk', agent.key.publicKey))))
      // SDK-free clients may have enrolled in this fixture namespace without entering this.agents.
      const jkts = [...new Set([...persisted.map((entry) => entry.jkt), ...fixtureKeys])]
      await this.pool.query('DELETE FROM audit_events WHERE principal_id IN (SELECT id FROM principals WHERE namespace=$1)', [this.namespace])
      await this.pool.query('DELETE FROM enrollments WHERE namespace=$1', [this.namespace])
      await this.pool.query('DELETE FROM grants WHERE principal_id IN (SELECT id FROM principals WHERE namespace=$1)', [this.namespace])
      await this.pool.query('DELETE FROM principals WHERE namespace=$1', [this.namespace])
      await this.pool.query('DELETE FROM service_policies WHERE namespace=$1', [this.namespace])
      await this.pool.query('DELETE FROM offers WHERE id=ANY($1::text[])', [this.offerIds])
      await this.pool.query("DELETE FROM replays WHERE namespace='dpop' AND key=ANY($1::text[])", [jkts])
      await this.pool.query('DELETE FROM nonces WHERE jkt=ANY($1::text[])', [jkts])
      await this.pool.query('DELETE FROM oidc_states WHERE session_hash=ANY($1::text[])', [[...this.sessionHashes]])
      await this.pool.query('DELETE FROM browser_sessions WHERE token_hash=ANY($1::text[])', [[...this.sessionHashes]])
    } catch (error) { errors.push(error) }
    await this.pool.end()
    if (errors.length) throw new AggregateError(errors, 'Integration fixture cleanup failed')
  }
}
