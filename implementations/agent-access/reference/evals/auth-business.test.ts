import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BrowserContext } from '@playwright/test'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { OperationResponseSchema, EnrollmentResponseSchema, AgentAccessContextSchema, snapshotDigest,
  createDPoPProof, generateDPoPKey, refreshDPoPTokens } from '@hitl-protocol/agent-access'
import { EvalHarness, PUBLIC_BASE, ISSUER, completeLoginForm, type AgentFixture } from './helpers.js'

const exec = promisify(execFile)
const Count = z.object({ count: z.coerce.number().int().nonnegative() })
const Stock = z.object({ stock: z.number().int().nonnegative() })
const ErrorResponse = z.object({ error: z.string() })
const harness = new EvalHarness()
let alice: AgentFixture
let bob: AgentFixture
let otherKey: AgentFixture
let limited: AgentFixture
let revocable: AgentFixture
let aliceBrowser: BrowserContext
let bobBrowser: BrowserContext

async function effectCount(operationId: string): Promise<number> {
  const result = await harness.pool.query('SELECT count(*) AS count FROM bookings WHERE operation_id=$1', [operationId])
  return Count.parse(result.rows[0]).count
}
async function stock(offerId: string): Promise<number> {
  const result = await harness.pool.query('SELECT stock FROM offers WHERE id=$1', [offerId])
  return Stock.parse(result.rows[0]).stock
}
async function csrf(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-csrf')
  if (!cookie) throw new Error('Actual OIDC browser session has no CSRF cookie')
  return cookie.value
}

describe('E4–E10 · actual HTTP, PostgreSQL 18 and Keycloak DPoP', { concurrent: false }, () => {
  beforeAll(async () => {
    await harness.start()
    aliceBrowser = await harness.context()
    bobBrowser = await harness.context()
    alice = await harness.loginAgent('alice')
    bob = await harness.loginAgent('bob')
    otherKey = await harness.loginAgent('alice')
    limited = await harness.loginAgent('alice')
    revocable = await harness.loginAgent('alice')
    await harness.enroll(alice, aliceBrowser)
    await harness.enroll(bob, bobBrowser)
    await harness.enroll(otherKey, aliceBrowser)
    await harness.enroll(limited, aliceBrowser, 10000)
    await harness.enroll(revocable, aliceBrowser)
  }, 240000)
  beforeEach(async () => { await harness.resetScenario() })
  afterAll(async () => { await harness.close() }, 30000)

  it('E4 real public-client PKCE rejects the wrong verifier; refresh rejects another DPoP key and preserves the original binding', async () => {
    await expect(harness.loginAgent('alice', { wrongVerifier: true })).rejects.toMatchObject({ error: 'invalid_grant' })
    if (!alice.refreshToken) throw new Error('Actual DPoP login did not issue a refresh token')
    const config = { issuer: ISSUER, clientId: 'hitl-agent', redirectUri: 'http://127.0.0.1:8899/callback', allowInsecureLocalhost: true }
    // This is a public client: no clientSecret exists in either grant request.
    const wrongKey = await refreshDPoPTokens(config, { refreshToken: alice.refreshToken, key: await generateDPoPKey() })
      .then(() => undefined, (error: unknown) => error)
    z.object({ error: z.enum(['invalid_grant', 'invalid_dpop_proof']) }).parse(wrongKey)
    const refreshed = z.object({ access_token: z.string(), refresh_token: z.string().optional(), token_type: z.string() }).parse(
      await refreshDPoPTokens(config, { refreshToken: alice.refreshToken, key: alice.key }))
    expect(refreshed.token_type.toLowerCase()).toBe('dpop')
    alice.accessToken = refreshed.access_token
    if (refreshed.refresh_token) alice.refreshToken = refreshed.refresh_token
    expect((await harness.request(alice, `/v1/agent-enrollments/${alice.enrollment!.id}`, { port: 8790 })).status).toBe(200)
  }, 30000)

  it('E4 the same genuine DPoP proof is consumed once across two workers and a fresh proof can retry', async () => {
    const offer = await harness.offer()
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    const path = `/v1/operations/${prepared.operation.operation_id}`
    expect((await harness.request(alice, path)).status).toBe(200)
    const proof = await createDPoPProof({ url: `${PUBLIC_BASE}${path}`, method: 'GET', key: alice.key,
      accessToken: alice.accessToken, ...(alice.nonce ? { nonce: alice.nonce } : {}) })
    const responses = await Promise.all([8789, 8790].map((port) => fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: `DPoP ${alice.accessToken}`, DPoP: proof }, signal: AbortSignal.timeout(10000),
    })))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
    for (const response of responses) {
      const body: unknown = await response.json()
      if (response.status === 401) expect(ErrorResponse.parse(body).error).toBe('invalid_dpop_proof')
      else expect(OperationResponseSchema.parse(body).operation_id).toBe(prepared.operation.operation_id)
    }
    expect((await harness.request(alice, path, { port: 8790 })).status).toBe(200)
  }, 30000)

  it('E5 owner consent, account/key isolation and native browser CSRF are enforced', async () => {
    const own = await harness.request(alice, `/v1/agent-enrollments/${alice.enrollment!.id}`, { port: 8790 })
    expect(own.status).toBe(200)
    expect(EnrollmentResponseSchema.parse(own.body).status).toBe('confirmed')
    for (const agent of [bob, otherKey]) {
      const foreign = await harness.request(agent, `/v1/agent-enrollments/${alice.enrollment!.id}`)
      expect(foreign.status).toBe(404)
      expect(ErrorResponse.parse(foreign.body).error).toBe('not_found')
    }
    const foreignPage = await bobBrowser.newPage()
    try {
      const result = await foreignPage.goto(alice.enrollment!.verification_url)
      expect(result?.status()).toBe(404)
      expect(await foreignPage.getByRole('button', { name: 'Connect this agent' }).count()).toBe(0)
    } finally { await foreignPage.close() }
    const noOrigin = await aliceBrowser.request.post(`${PUBLIC_BASE}/connect/${alice.enrollment!.id}`, {
      form: { csrf: await csrf(aliceBrowser) }, maxRedirects: 0,
    })
    expect(noOrigin.status()).toBe(403)
    const offer = await harness.offer()
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    for (const agent of [bob, otherKey]) {
      const foreign = await harness.request(agent, `/v1/operations/${prepared.operation.operation_id}`)
      expect(foreign.status).toBe(404)
    }
    expect((await harness.request(bob, '/v1/bookings/prepare', { method: 'POST',
      body: harness.input(alice, offer), idempotencyKey: randomUUID() })).status).toBe(404)
  }, 30000)

  it('E5 twenty concurrent owner confirmations of a pending enrollment create one principal and one grant', async () => {
    const agent = await harness.loginAgent('alice')
    const pending = await harness.createEnrollment(agent)
    expect(pending.status).toBe('pending')
    const page = await aliceBrowser.newPage()
    try {
      expect((await page.goto(pending.verification_url))?.status()).toBe(200)
      await page.getByRole('button', { name: 'Connect this agent', exact: true }).waitFor()
      const token = await page.locator('input[name="csrf"]').inputValue()
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => aliceBrowser.request.post(
        `http://127.0.0.1:${index % 2 ? 8790 : 8789}/connect/${pending.id}`, {
          form: { csrf: token }, headers: { Origin: PUBLIC_BASE }, maxRedirects: 0,
        })))
      expect(responses.map((response) => response.status())).toEqual(Array(20).fill(303))
      const confirmed = await harness.request(agent, `/v1/agent-enrollments/${pending.id}`, { port: 8790 })
      expect(confirmed.status).toBe(200)
      const connection = EnrollmentResponseSchema.parse(confirmed.body)
      expect(connection.status).toBe('confirmed')
      expect(connection.principal_id).toBeTruthy()
      expect(connection.grant_id).toBeTruthy()
      expect(Count.parse((await harness.pool.query(`SELECT count(*) AS count FROM principals p JOIN enrollments e
        ON p.namespace=e.namespace AND p.issuer=e.issuer AND p.subject=e.subject AND p.client_id=e.client_id AND p.jkt=e.jkt
        WHERE e.id=$1`, [pending.id])).rows[0]).count).toBe(1)
      expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM grants WHERE principal_id=$1', [connection.principal_id])).rows[0]).count).toBe(1)
      expect(Count.parse((await harness.pool.query("SELECT count(*) AS count FROM audit_events WHERE principal_id=$1 AND event='enrollment.confirmed'", [connection.principal_id])).rows[0]).count).toBe(1)
      z.object({ version: z.literal(1) }).parse((await harness.pool.query('SELECT version FROM principals WHERE id=$1', [connection.principal_id])).rows[0])
    } finally { await page.close() }
  }, 30000)

  it('E5 an enrollment whose original ten-minute deadline has elapsed cannot connect or create a grant', async () => {
    const agent = await harness.loginAgent('alice')
    const pending = await harness.createEnrollment(agent)
    const Duration = z.object({ ttl_seconds: z.coerce.number() })
    const duration = Duration.parse((await harness.pool.query('SELECT extract(epoch FROM (expires_at-created_at)) AS ttl_seconds FROM enrollments WHERE id=$1', [pending.id])).rows[0])
    expect(duration.ttl_seconds).toBeGreaterThan(599)
    expect(duration.ttl_seconds).toBeLessThanOrEqual(601)
    const expiredId = `enroll_${randomUUID()}`
    // The expired fixture starts with a full ten-minute lifetime; immutable deadlines are never updated.
    await harness.pool.query(`WITH fixture_clock AS (SELECT clock_timestamp() AS now)
      INSERT INTO enrollments(id,namespace,issuer,subject,client_id,jkt,display_name,max_total_cents,scopes,created_at,expires_at)
      SELECT $1,e.namespace,e.issuer,e.subject,e.client_id,e.jkt,e.display_name,e.max_total_cents,e.scopes,
        fixture_clock.now-interval '11 minutes',fixture_clock.now-interval '1 minute'
      FROM enrollments e CROSS JOIN fixture_clock WHERE e.id=$2`, [expiredId, pending.id])
    const read = await harness.request(agent, `/v1/agent-enrollments/${expiredId}`)
    expect(read.status).toBe(200)
    const expired = EnrollmentResponseSchema.parse(read.body)
    expect(expired.status).toBe('expired')
    expect(expired.principal_id).toBeUndefined()
    expect(expired.grant_id).toBeUndefined()
    const page = await aliceBrowser.newPage()
    try {
      expect((await page.goto(expired.verification_url))?.status()).toBe(200)
      await page.getByRole('status').filter({ hasText: 'This connection request has expired.' }).waitFor()
      expect(await page.getByRole('button', { name: 'Connect this agent' }).count()).toBe(0)
      const posted = await aliceBrowser.request.post(expired.verification_url, { form: { csrf: await csrf(aliceBrowser) },
        headers: { Origin: PUBLIC_BASE }, maxRedirects: 0 })
      expect(posted.status()).toBe(410)
    } finally { await page.close() }
    z.object({ status: z.literal('expired'), principal_id: z.null(), grant_id: z.null() }).parse(
      (await harness.pool.query('SELECT status,principal_id,grant_id FROM enrollments WHERE id=$1', [expiredId])).rows[0])
    expect(Count.parse((await harness.pool.query(`SELECT count(*) AS count FROM principals p JOIN enrollments e
      ON p.namespace=e.namespace AND p.issuer=e.issuer AND p.subject=e.subject AND p.client_id=e.client_id AND p.jkt=e.jkt
      WHERE e.id=$1`, [expiredId])).rows[0]).count).toBe(0)
  }, 30000)

  it('E10 conditional operation and review reads return 304 only after authenticating the owning agent', async () => {
    const offer = await harness.offer({ price: 15000 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    for (const path of [`/v1/operations/${prepared.operation.operation_id}`, `/v1/reviews/${prepared.caseId}`]) {
      const first = await harness.request(alice, path)
      expect(first.status).toBe(200)
      const etag = first.headers.get('ETag')
      expect(etag).toBeTruthy()
      if (!etag) throw new Error('Private resource did not emit its version ETag')
      const own = await harness.request(alice, path, { port: 8790, headers: { 'If-None-Match': etag } })
      expect(own.status).toBe(304)
      expect(own.headers.get('ETag')).toBe(etag)
      expect(own.body).toBeUndefined()
      for (const foreign of [bob, otherKey]) {
        const denied = await harness.request(foreign, path, { port: 8790, headers: { 'If-None-Match': etag } })
        expect(denied.status).toBe(404)
        expect(ErrorResponse.parse(denied.body).error).toBe('not_found')
        expect(denied.headers.has('ETag')).toBe(false)
      }
      const anonymous = await fetch(`${PUBLIC_BASE}${path}`, { headers: { 'If-None-Match': etag }, signal: AbortSignal.timeout(5000) })
      expect(anonymous.status).toBe(401)
      expect(anonymous.headers.has('ETag')).toBe(false)
      await anonymous.body?.cancel()
    }
  }, 30000)

  it('E10 live local grant read scopes and activity gate data and 304 while newer grant versions retain authorized historical reads', async () => {
    const agent = await harness.loginAgent('alice')
    await harness.enroll(agent, await harness.context())
    const grantId = agent.enrollment!.grant_id
    const principalId = agent.enrollment!.principal_id
    if (!grantId || !principalId) throw new Error('Real owner consent did not create a grant/principal')
    const original = z.object({ scopes: z.array(z.string()), active: z.boolean(), version: z.number().int().positive() }).parse(
      (await harness.pool.query('SELECT scopes,active,version FROM grants WHERE id=$1', [grantId])).rows[0])
    const tokenDigest = createHash('sha256').update(agent.accessToken).digest('hex')
    const proposal = await harness.prepare(agent, harness.input(agent, await harness.offer({ price: 15000 })))
    if (!proposal.caseId) throw new Error('Actual prepare did not create the expected review')
    const resources: { path: string; scope: string; etag: string; body: unknown }[] = []
    for (const resource of [
      { path: `/v1/operations/${proposal.operation.operation_id}`, scope: 'bookings:read' },
      { path: `/v1/reviews/${proposal.caseId}`, scope: 'hitl:reviews:read' },
    ]) {
      const first = await harness.request(agent, resource.path)
      expect(first.status).toBe(200)
      const etag = first.headers.get('ETag')
      if (!etag) throw new Error('Authorized private resource did not emit an ETag')
      resources.push({ ...resource, etag, body: first.body })
    }
    async function assertReadRights(allowedScopes: string[]): Promise<void> {
      for (const resource of resources) {
        const allowed = allowedScopes.includes(resource.scope)
        const ordinary = await harness.request(agent, resource.path)
        const conditional = await harness.request(agent, resource.path, { port: 8790, headers: { 'If-None-Match': resource.etag } })
        expect(ordinary.status).toBe(allowed ? 200 : 403)
        expect(conditional.status).toBe(allowed ? 304 : 403)
        if (allowed) {
          expect(ordinary.body).toEqual(resource.body)
          expect(ordinary.headers.get('ETag')).toBe(resource.etag)
          expect(conditional.headers.get('ETag')).toBe(resource.etag)
          expect(conditional.body).toBeUndefined()
        } else {
          for (const denied of [ordinary, conditional]) {
            expect(ErrorResponse.parse(denied.body).error).toBe('insufficient_scope')
            expect(denied.headers.has('ETag')).toBe(false)
          }
        }
      }
    }
    try {
      const withoutBookingsRead = original.scopes.filter((scope) => scope !== 'bookings:read')
      await harness.pool.query('UPDATE grants SET scopes=$2 WHERE id=$1', [grantId, withoutBookingsRead])
      await assertReadRights(withoutBookingsRead)
      const withoutReviewsRead = original.scopes.filter((scope) => scope !== 'hitl:reviews:read')
      await harness.pool.query('UPDATE grants SET scopes=$2 WHERE id=$1', [grantId, withoutReviewsRead])
      await assertReadRights(withoutReviewsRead)
      await harness.pool.query('UPDATE grants SET scopes=$2,active=false WHERE id=$1', [grantId, original.scopes])
      z.object({ active: z.literal(true) }).parse((await harness.pool.query('SELECT active FROM principals WHERE id=$1', [principalId])).rows[0])
      await assertReadRights([])
      await harness.pool.query('UPDATE grants SET scopes=$2,active=$3 WHERE id=$1', [grantId, original.scopes, original.active])
      const restored = z.object({ version: z.number().int().positive() }).parse(
        (await harness.pool.query('SELECT version FROM grants WHERE id=$1', [grantId])).rows[0])
      expect(restored.version).toBeGreaterThan(original.version)
      expect(proposal.operation.snapshot.grant_version).toBe(original.version)
      await assertReadRights(original.scopes)
      expect(createHash('sha256').update(agent.accessToken).digest('hex')).toBe(tokenDigest)
    } finally {
      await harness.pool.query('UPDATE grants SET scopes=$2,active=$3 WHERE id=$1', [grantId, original.scopes, original.active])
    }
  }, 30000)

  it('E10 deadline projection changes operation and review ETags before conditional matching', async () => {
    const offer = await harness.offer({ refundable: false })
    const source = await harness.prepare(alice, harness.input(alice, offer))
    const operationId = `op_${randomUUID()}`
    const reviewId = `review_${randomUUID()}`
    await harness.pool.query(`INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'awaiting_approval',clock_timestamp()+interval '2 seconds')`,
    [operationId, harness.namespace, alice.enrollment!.principal_id, alice.enrollment!.grant_id, offer,
      JSON.stringify(source.operation.snapshot), source.operation.snapshot_digest])
    await harness.pool.query(`INSERT INTO reviews(id,operation_id,created_at,expires_at)
      SELECT $1,id,created_at,expires_at FROM operations WHERE id=$2`, [reviewId, operationId])
    const resources: { path: string; etag: string; expiresAt: string }[] = []
    for (const path of [`/v1/operations/${operationId}`, `/v1/reviews/${reviewId}`]) {
      const first = await harness.request(alice, path)
      expect(first.status).toBe(200)
      const value = z.object({ status: z.enum(['awaiting_approval', 'pending']), expires_at: z.iso.datetime() }).parse(first.body)
      const etag = first.headers.get('ETag')
      if (!etag) throw new Error('Unexpired private resource did not emit an ETag')
      expect((await harness.request(alice, path, { port: 8790, headers: { 'If-None-Match': etag } })).status).toBe(304)
      resources.push({ path, etag, expiresAt: value.expires_at })
    }
    await harness.pool.query('SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp()))))', [resources[0]!.expiresAt])
    for (const resource of resources) {
      const changed = await harness.request(alice, resource.path, { port: 8790, headers: { 'If-None-Match': resource.etag } })
      expect(changed.status).toBe(200)
      expect(z.object({ status: z.literal('expired') }).parse(changed.body).status).toBe('expired')
      const expiredEtag = changed.headers.get('ETag')
      expect(expiredEtag).toBeTruthy()
      expect(expiredEtag).not.toBe(resource.etag)
      if (!expiredEtag) throw new Error('Expired private resource did not emit an ETag')
      expect((await harness.request(alice, resource.path, { headers: { 'If-None-Match': expiredEtag } })).status).toBe(304)
    }
  }, 30000)

  it.each(['review', 'enrollment'] as const)('E5/E8 %s auth freshness expiring at guarded SQL dispatch returns 401 and rolls back without expiring business state', async (kind) => {
    const owner = await harness.context()
    const page = await owner.newPage()
    const agent = kind === 'enrollment' ? await harness.loginAgent('alice') : alice
    const enrollment = kind === 'enrollment' ? await harness.createEnrollment(agent) : undefined
    const proposal = kind === 'review' ? await harness.prepare(agent, harness.input(agent, await harness.offer({ refundable: false }))) : undefined
    const id = enrollment?.id ?? proposal?.caseId
    const verificationUrl = enrollment?.verification_url ?? proposal?.reviewUrl
    if (!id || !verificationUrl) throw new Error('Real enrollment/review fixture is missing')
    let started = false
    try {
      await page.goto(verificationUrl)
      await completeLoginForm(page, 'alice')
      await page.getByRole('button', { name: kind === 'review' ? 'Confirm proposal' : 'Connect this agent', exact: true }).waitFor()
      const token = await page.locator('input[name="csrf"]').inputValue()
      const cookie = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')
      if (!cookie) throw new Error('Real OIDC session is missing')
      const sessionHash = createHash('sha256').update(cookie.value).digest('hex')
      // Only the freshness timestamp is a race fixture. Issuer/subject, session, capability,
      // cookies and CSRF originate from actual OIDC; no authentication path is replaced.
      const original = z.object({ identity: z.record(z.string(), z.unknown()) }).parse(
        (await harness.pool.query('SELECT identity FROM browser_sessions WHERE token_hash=$1', [sessionHash])).rows[0]).identity
      const worker = await harness.startWorker(8794, 1, { id, kind }); started = true
      await harness.pool.query(`UPDATE browser_sessions SET identity=jsonb_set(identity,'{auth_time}',
        to_jsonb(floor(extract(epoch FROM clock_timestamp()))::bigint-298)) WHERE token_hash=$1`, [sessionHash])
      const path = kind === 'review' ? `/review/${id}/respond` : `/connect/${id}`
      const response = await owner.request.post(`http://127.0.0.1:8794${path}`, { maxRedirects: 0,
        headers: { Origin: PUBLIC_BASE }, form: { csrf: token, ...(kind === 'review' ? { action: 'confirm' } : {}) } })
      expect(response.status()).toBe(401)
      expect(response.headers()['content-type']).toContain('text/html')
      expect(await response.text()).toContain('Please sign in again before making this decision.')
      expect(worker.output()).toContain('EVAL_GUARDED_WRITE_CAPTURED')
      if (proposal) {
        z.object({ status: z.literal('pending'), version: z.literal(1), completed_at: z.null(), result: z.null() }).parse(
          (await harness.pool.query('SELECT status,version,completed_at,result FROM reviews WHERE id=$1', [id])).rows[0])
        const read = await harness.request(agent, `/v1/operations/${proposal.operation.operation_id}`)
        expect(OperationResponseSchema.parse(read.body).status).toBe('awaiting_approval')
        expect(await effectCount(proposal.operation.operation_id)).toBe(0)
        expect(Count.parse((await harness.pool.query("SELECT count(*) AS count FROM audit_events WHERE operation_id=$1 AND event<>'operation.prepared'", [proposal.operation.operation_id])).rows[0]).count).toBe(0)
      } else {
        z.object({ status: z.literal('pending'), principal_id: z.null(), grant_id: z.null() }).parse(
          (await harness.pool.query('SELECT status,principal_id,grant_id FROM enrollments WHERE id=$1', [id])).rows[0])
        expect(Count.parse((await harness.pool.query(`SELECT count(*) AS count FROM principals p JOIN enrollments e
          ON p.namespace=e.namespace AND p.issuer=e.issuer AND p.subject=e.subject AND p.client_id=e.client_id AND p.jkt=e.jkt
          WHERE e.id=$1`, [id])).rows[0]).count).toBe(0)
      }
      // Restore the genuine OIDC auth_time, then exercise recovery through the normal worker.
      await harness.pool.query('UPDATE browser_sessions SET identity=$2 WHERE token_hash=$1', [sessionHash, JSON.stringify(original)])
      const retry = await owner.request.post(`${PUBLIC_BASE}${path}`, { maxRedirects: 0,
        headers: { Origin: PUBLIC_BASE }, form: { csrf: token, ...(kind === 'review' ? { action: 'confirm' } : {}) } })
      expect(retry.status()).toBe(303)
      const recovered = await harness.request(agent, proposal ? `/v1/operations/${proposal.operation.operation_id}` : `/v1/agent-enrollments/${id}`)
      expect(z.object({ status: z.literal(proposal ? 'ready' : 'confirmed') }).parse(recovered.body).status).toBe(proposal ? 'ready' : 'confirmed')
    } finally {
      await page.close()
      if (started) await harness.stopWorker(8794)
    }
  }, 30000)

  it('E6 server-computed total, quantity, fees, refund status and both money boundaries select the correct flow', async () => {
    const cases = [
      { price: 4999, fee: 1, quantity: 2, refundable: true, total: 9999, expected: 200 },
      { price: 5000, fee: 0, quantity: 2, refundable: true, total: 10000, expected: 200 },
      { price: 5000, fee: 1, quantity: 2, refundable: true, total: 10001, expected: 202 },
      { price: 10000, fee: 0, quantity: 1, refundable: false, total: 10000, expected: 202 },
      { price: 50000, fee: 0, quantity: 1, refundable: true, total: 50000, expected: 202 },
      { price: 50000, fee: 1, quantity: 1, refundable: true, total: 50001, expected: 403 },
    ]
    for (const entry of cases) {
      const offer = await harness.offer(entry)
      const result = await harness.request(alice, '/v1/bookings/prepare', { method: 'POST',
        body: harness.input(alice, offer, entry.quantity), idempotencyKey: randomUUID() })
      expect(result.status, JSON.stringify(result.body)).toBe(entry.expected)
      if (entry.expected === 200) expect(OperationResponseSchema.parse(result.body).snapshot.total_cents).toBe(entry.total)
      if (entry.expected === 202) {
        const envelope = z.object({ hitl: z.object({ context: z.object({ 'x-hitl-agent-access': AgentAccessContextSchema }) }) }).parse(result.body)
        const operation = await harness.request(alice, `/v1/operations/${envelope.hitl.context['x-hitl-agent-access'].operation_id}`)
        const snapshot = OperationResponseSchema.parse(operation.body).snapshot
        expect(snapshot.total_cents).toBe(entry.total)
        expect(snapshot.quantity).toBe(entry.quantity)
        expect(snapshot.refundable).toBe(entry.refundable)
      }
      if (entry.expected === 403) expect(ErrorResponse.parse(result.body).error).toBe('limit_exceeded')
    }
    const overGrant = await harness.offer({ price: 10001 })
    const denied = await harness.request(limited, '/v1/bookings/prepare', { method: 'POST',
      body: harness.input(limited, overGrant), idempotencyKey: randomUUID() })
    expect(denied.status).toBe(403)
    expect(ErrorResponse.parse(denied.body).error).toBe('limit_exceeded')
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM operations WHERE principal_id=$1',
      [limited.enrollment!.principal_id])).rows[0]).count).toBe(0)
  }, 30000)

  it('E7 twenty prepare retries across independent workers create one operation, one case and at most five usable links', async () => {
    const offer = await harness.offer({ price: 15000 })
    const input = harness.input(alice, offer)
    const key = randomUUID()
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => harness.request(alice,
      '/v1/bookings/prepare', { method: 'POST', body: input, idempotencyKey: key, port: index % 2 ? 8790 : 8789 })))
    expect(responses.every((result) => [202, 429].includes(result.status))).toBe(true)
    expect(responses.filter((result) => result.status === 202)).toHaveLength(5)
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM operations WHERE namespace=$1', [harness.namespace])).rows[0]).count).toBe(1)
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM reviews r JOIN operations o ON o.id=r.operation_id WHERE o.namespace=$1', [harness.namespace])).rows[0]).count).toBe(1)
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM review_capabilities c JOIN reviews r ON r.id=c.review_id JOIN operations o ON o.id=r.operation_id WHERE o.namespace=$1', [harness.namespace])).rows[0]).count).toBe(5)
    const changed = await harness.request(alice, '/v1/bookings/prepare', { method: 'POST',
      body: { ...input, quantity: 2 }, idempotencyKey: key, port: 8790 })
    expect(changed.status).toBe(409)
    expect(ErrorResponse.parse(changed.body).error).toBe('idempotency_conflict')
    const successes = responses.filter((result) => result.status === 202)
    const ReviewUrl = z.object({ hitl: z.object({ review_url: z.url() }) })
    const firstUrl = ReviewUrl.parse(successes[0]?.body).hitl.review_url
    const lastUrl = ReviewUrl.parse(successes.at(-1)?.body).hitl.review_url
    expect(firstUrl).not.toBe(lastUrl)
    for (const url of [firstUrl, lastUrl]) {
      const page = await aliceBrowser.newPage()
      try { expect((await page.goto(url))?.status()).toBe(200); await page.getByRole('heading', { name: 'Review booking proposal' }).waitFor() }
      finally { await page.close() }
    }
  }, 30000)

  it('E8 confirm/cancel race records exactly one authenticated decision and confirmation alone creates no booking', async () => {
    const offer = await harness.offer({ price: 15000 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    const page = await harness.openReview(aliceBrowser, prepared)
    try {
      const token = await page.locator('input[name="csrf"]').inputValue()
      const responses = await Promise.all(['confirm', 'cancel'].map((action) => aliceBrowser.request.post(
        `${PUBLIC_BASE}/review/${prepared.caseId}/respond`, { form: { csrf: token, action },
          headers: { Origin: PUBLIC_BASE }, maxRedirects: 0 })))
      expect(responses.map((response) => response.status()).sort()).toEqual([303, 409])
      const Decision = z.object({ result: z.object({ action: z.enum(['confirm', 'cancel']) }), reviewer: z.object({ iss: z.literal(ISSUER), sub: z.string() }), status: z.literal('completed') })
      const decision = Decision.parse((await harness.pool.query('SELECT result,reviewer,status FROM reviews WHERE id=$1', [prepared.caseId])).rows[0])
      expect(await effectCount(prepared.operation.operation_id)).toBe(0)
      expect(await stock(offer)).toBe(50)
      const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
      expect(OperationResponseSchema.parse(read.body).status).toBe(decision.result.action === 'confirm' ? 'ready' : 'cancelled')
      const poll = await harness.request(alice, `/v1/reviews/${prepared.caseId}`)
      expect(poll.status).toBe(200)
      expect(z.object({ status: z.literal('completed'), result: z.object({ action: z.enum(['confirm', 'cancel']) }) }).parse(poll.body).result).toEqual(decision.result)
    } finally { await page.close() }
  }, 30000)

  it('E8 an unapproved proposal and a changed commit digest cannot execute', async () => {
    const offer = await harness.offer({ price: 15000 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    expect((await harness.commit(alice, prepared.operation)).status).toBe(409)
    await harness.confirm(aliceBrowser, prepared)
    for (const body of [
      { expected_version: 2, snapshot_digest: prepared.operation.snapshot_digest },
      { expected_version: 1, snapshot_digest: '0'.repeat(64) },
    ]) {
      const response = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}/commit`, { method: 'POST', body, port: 8790 })
      expect(response.status).toBe(409)
      expect(ErrorResponse.parse(response.body).error).toBe('version_conflict')
    }
    expect(await effectCount(prepared.operation.operation_id)).toBe(0)
  }, 30000)

  it('E9 twenty fresh commit proofs across workers return the same stored booking and decrement stock once', async () => {
    const offer = await harness.offer({ price: 6000, stock: 40 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer, 2))
    await harness.confirm(aliceBrowser, prepared)
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => harness.commit(alice, prepared.operation, index % 2 ? 8790 : 8789)))
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200))
    const stored = responses.map((response) => OperationResponseSchema.parse(response.body))
    expect(stored.every((operation) => operation.status === 'succeeded')).toBe(true)
    expect(new Set(stored.map((operation) => JSON.stringify(operation.result))).size).toBe(1)
    expect(await effectCount(prepared.operation.operation_id)).toBe(1)
    expect(await stock(offer)).toBe(38)
    expect(Count.parse((await harness.pool.query("SELECT count(*) AS count FROM audit_events WHERE operation_id=$1 AND event='operation.succeeded'", [prepared.operation.operation_id])).rows[0]).count).toBe(1)
  }, 30000)

  it('E9 actual offer and grant edits automatically revise and invalidate the approved immutable snapshot', async () => {
    for (const revision of ['offer', 'grant'] as const) {
      const offer = await harness.offer({ price: 15000 })
      const prepared = await harness.prepare(alice, harness.input(alice, offer))
      await harness.confirm(aliceBrowser, prepared)
      if (revision === 'offer') await harness.pool.query('UPDATE offers SET fee_cents=fee_cents+1 WHERE id=$1', [offer])
      if (revision === 'grant') {
        const Version = z.object({ version: z.number().int().positive() })
        const before = Version.parse((await harness.pool.query('SELECT version FROM grants WHERE id=$1', [alice.enrollment!.grant_id])).rows[0])
        await harness.pool.query('UPDATE grants SET max_total_cents=max_total_cents-1 WHERE id=$1', [alice.enrollment!.grant_id])
        const after = Version.parse((await harness.pool.query('SELECT version FROM grants WHERE id=$1', [alice.enrollment!.grant_id])).rows[0])
        expect(after.version).toBe(before.version + 1)
      }
      const response = await harness.commit(alice, prepared.operation, 8790)
      expect(response.status).toBe(409)
      expect(ErrorResponse.parse(response.body).error).toBe('version_conflict')
      const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
      const superseded = OperationResponseSchema.parse(read.body)
      expect(superseded.status).toBe('superseded')
      expect(superseded.snapshot).toEqual(prepared.operation.snapshot)
      expect(superseded.snapshot_digest).toBe(prepared.operation.snapshot_digest)
      expect(await effectCount(prepared.operation.operation_id)).toBe(0)
      expect(await stock(offer)).toBe(50)
    }
  }, 60000)

  it('E9 database constraints reject crossed ownership, mutable bindings and mutable terminal decisions', async () => {
    const offer = await harness.offer({ price: 15000 })
    const otherOffer = await harness.offer()
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    const id = prepared.operation.operation_id
    const insert = `INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ready',clock_timestamp()+interval '15 minutes')`
    const binding = [offer, JSON.stringify(prepared.operation.snapshot), prepared.operation.snapshot_digest]
    await expect(harness.pool.query(insert, [`op_${randomUUID()}`, harness.namespace, alice.enrollment!.principal_id,
      bob.enrollment!.grant_id, ...binding])).rejects.toMatchObject({ code: '23503' })
    await expect(harness.pool.query(insert, [`op_${randomUUID()}`, `${harness.namespace}-foreign`, alice.enrollment!.principal_id,
      alice.enrollment!.grant_id, ...binding])).rejects.toMatchObject({ code: '23503' })
    await harness.pool.query('DELETE FROM idempotency WHERE operation_id=$1', [id])
    await expect(harness.pool.query('INSERT INTO idempotency(namespace,principal_id,endpoint,key,fingerprint,operation_id) VALUES($1,$2,$3,$4,$5,$6)',
      [harness.namespace, bob.enrollment!.principal_id, 'bookings:prepare', randomUUID(), '0'.repeat(64), id])).rejects.toMatchObject({ code: '23503' })
    await expect(harness.pool.query('INSERT INTO bookings(id,operation_id,offer_id,quantity,total_cents,currency) VALUES($1,$2,$3,1,1000,$4)',
      [`booking_${randomUUID()}`, id, otherOffer, 'EUR'])).rejects.toMatchObject({ code: '23503' })
    await expect(harness.pool.query("UPDATE operations SET snapshot_digest=$2 WHERE id=$1", [id, '0'.repeat(64)])).rejects.toMatchObject({ code: 'P0001' })
    await expect(harness.pool.query("UPDATE operations SET expires_at=expires_at+interval '1 second' WHERE id=$1", [id])).rejects.toMatchObject({ code: 'P0001' })
    await expect(harness.pool.query('UPDATE grants SET principal_id=$2 WHERE id=$1', [alice.enrollment!.grant_id, bob.enrollment!.principal_id])).rejects.toMatchObject({ code: 'P0001' })
    await harness.confirm(aliceBrowser, prepared)
    await expect(harness.pool.query('UPDATE reviews SET result=$2 WHERE id=$1', [prepared.caseId, JSON.stringify({ action: 'cancel' })])).rejects.toMatchObject({ code: 'P0001' })
    expect((await harness.commit(alice, prepared.operation)).status).toBe(200)
    await expect(harness.pool.query("UPDATE operations SET result='{}'::jsonb WHERE id=$1", [id])).rejects.toMatchObject({ code: 'P0001' })
    expect(await effectCount(id)).toBe(1)
  }, 30000)

  it('E9 partial stock failure is persisted without any booking or stock decrement', async () => {
    const offer = await harness.offer({ price: 6000, stock: 1 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer, 2))
    await harness.confirm(aliceBrowser, prepared)
    const result = await harness.commit(alice, prepared.operation)
    expect(result.status).toBe(409)
    expect(ErrorResponse.parse(result.body).error).toBe('out_of_stock')
    const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
    const failed = OperationResponseSchema.parse(read.body)
    expect(failed.status).toBe('failed')
    expect(failed.result).toEqual({ error: 'out_of_stock' })
    expect((await harness.commit(alice, prepared.operation, 8790)).status).toBe(409)
    expect(await effectCount(prepared.operation.operation_id)).toBe(0)
    expect(await stock(offer)).toBe(1)
  }, 30000)

  it('E9 initially expired operation/review fixtures fail closed without rewriting immutable expiry', async () => {
    for (const status of ['ready', 'awaiting_approval'] as const) {
      const offer = await harness.offer({ refundable: status === 'ready' })
      const original = await harness.prepare(alice, harness.input(alice, offer))
      expect(original.operation.status).toBe(status)
      const id = `op_${randomUUID()}`
      await harness.pool.query(`INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '5 minutes')`,
      [id, harness.namespace, alice.enrollment!.principal_id, alice.enrollment!.grant_id, offer,
        JSON.stringify(original.operation.snapshot), snapshotDigest(original.operation.snapshot), status])
      const read = await harness.request(alice, `/v1/operations/${id}`)
      const expired = OperationResponseSchema.parse(read.body)
      expect(expired.status).toBe('expired')
      if (status === 'awaiting_approval') {
        const review = `review_${randomUUID()}`
        const token = randomBytes(32).toString('base64url')
        await harness.pool.query(`INSERT INTO reviews(id,operation_id,created_at,expires_at)
          VALUES($1,$2,clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '5 minutes')`, [review, id])
        await harness.pool.query('INSERT INTO review_capabilities(token_hash,review_id) VALUES($1,$2)',
          [createHash('sha256').update(token).digest('hex'), review])
        const page = await aliceBrowser.newPage()
        try { expect((await page.goto(`${PUBLIC_BASE}/review/${review}?token=${token}`))?.status()).toBe(410) }
        finally { await page.close() }
      }
      expect((await harness.commit(alice, expired, 8790)).status).toBe(410)
      expect(await effectCount(id)).toBe(0)
    }
  }, 30000)

  it('E9 a worker killed while commit waits for an offer lock leaves no effect and a fresh retry succeeds', async () => {
    const offer = await harness.offer({ stock: 2 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    const blocker = await harness.pool.connect()
    let killed = false
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM offers WHERE id=$1 FOR UPDATE', [offer])
      const pending = harness.commit(alice, prepared.operation, 8790).then((result) => result, (error: unknown) => error)
      const deadline = Date.now() + 10000
      let blocked = false
      while (Date.now() < deadline) {
        const waiting = await harness.pool.query("SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM offers WHERE id=%'")
        if (Count.parse(waiting.rows[0]).count > 0) { blocked = true; break }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      expect(blocked).toBe(true)
      await harness.stopWorker(8790, 'SIGKILL'); killed = true
      expect(await pending).toHaveProperty('message')
      await blocker.query('ROLLBACK')
      expect(await effectCount(prepared.operation.operation_id)).toBe(0)
      expect(await stock(offer)).toBe(2)
      const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
      expect(OperationResponseSchema.parse(read.body).status).toBe('ready')
    } finally {
      await blocker.query('ROLLBACK'); blocker.release()
      if (killed) await harness.startWorker(8790)
    }
    expect((await harness.commit(alice, prepared.operation, 8790)).status).toBe(200)
    expect(await effectCount(prepared.operation.operation_id)).toBe(1)
    expect(await stock(offer)).toBe(1)
  }, 30000)

  it('E9 a deadline passing after authenticated dispatch and before the write cannot create a booking', async () => {
    const offer = await harness.offer()
    const source = await harness.prepare(alice, harness.input(alice, offer))
    const id = `op_${randomUUID()}`
    await harness.pool.query(`INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ready',clock_timestamp()+interval '2 seconds')`,
    [id, harness.namespace, alice.enrollment!.principal_id, alice.enrollment!.grant_id, offer,
      JSON.stringify(source.operation.snapshot), source.operation.snapshot_digest])
    const read = await harness.request(alice, `/v1/operations/${id}`)
    const operation = OperationResponseSchema.parse(read.body)
    const blocker = await harness.pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM offers WHERE id=$1 FOR UPDATE', [offer])
      const pending = harness.commit(alice, operation, 8790)
      const deadline = Date.now() + 10000
      let blocked = false
      while (Date.now() < deadline) {
        const waiting = await harness.pool.query("SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM offers WHERE id=%'")
        if (Count.parse(waiting.rows[0]).count > 0) { blocked = true; break }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      }
      expect(blocked).toBe(true)
      await blocker.query('SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp()))))', [operation.expires_at])
      await blocker.query('COMMIT')
      const expired = await pending
      expect(expired.status).toBe(410)
      expect(ErrorResponse.parse(expired.body).error).toBe('expired')
      expect(await effectCount(id)).toBe(0)
      expect(await stock(offer)).toBe(50)
    } finally { await blocker.query('ROLLBACK'); blocker.release() }
  }, 30000)

  it('E10 loss of the committed response and a worker crash recover the stored result with a safe retry', async () => {
    const offer = await harness.offer({ stock: 2 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    await harness.loseCommitResponse(alice, prepared.operation, 8790)
    await harness.stopWorker(8790, 'SIGKILL')
    const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
    const stored = OperationResponseSchema.parse(read.body)
    expect(stored.status).toBe('succeeded')
    await harness.startWorker(8790)
    const repeated = await harness.commit(alice, prepared.operation, 8790)
    expect(repeated.status).toBe(200)
    expect(OperationResponseSchema.parse(repeated.body).result).toEqual(stored.result)
    expect(await effectCount(prepared.operation.operation_id)).toBe(1)
    expect(await stock(offer)).toBe(1)
  }, 30000)

  it('E10 revocation racing a commit has one lock order and never permits an effect after revocation wins', async () => {
    const offer = await harness.offer({ stock: 2 })
    const prepared = await harness.prepare(revocable, harness.input(revocable, offer))
    const responses = await Promise.all([
      harness.commit(revocable, prepared.operation, 8790),
      aliceBrowser.request.post(`${PUBLIC_BASE}/account/agents/${revocable.enrollment!.principal_id}/revoke`, {
        form: { csrf: await csrf(aliceBrowser) }, headers: { Origin: PUBLIC_BASE }, maxRedirects: 0,
      }),
    ])
    expect(responses[1].status()).toBe(303)
    expect([200, 403, 409]).toContain(responses[0].status)
    const effects = await effectCount(prepared.operation.operation_id)
    expect(effects).toBe(responses[0].status === 200 ? 1 : 0)
    expect(await stock(offer)).toBe(2 - effects)
    expect((await harness.commit(revocable, prepared.operation)).status).toBe(403)
    const Principal = z.object({ active: z.literal(false) })
    Principal.parse((await harness.pool.query('SELECT active FROM principals WHERE id=$1', [revocable.enrollment!.principal_id])).rows[0])
  }, 30000)

  it('E10 real AS refresh-token revocation makes a still signed access token inactive on both workers', async () => {
    const agent = await harness.loginAgent('alice')
    await harness.enroll(agent, aliceBrowser)
    if (!agent.refreshToken) throw new Error('Actual Keycloak refresh token is required')
    const offer = await harness.offer()
    const prepared = await harness.prepare(agent, harness.input(agent, offer))
    expect((await harness.request(agent, `/v1/operations/${prepared.operation.operation_id}`, { port: 8790 })).status).toBe(200)
    const revoked = await fetch(`${ISSUER}/protocol/openid-connect/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'hitl-agent', token: agent.refreshToken, token_type_hint: 'refresh_token' }),
      signal: AbortSignal.timeout(5000),
    })
    expect(revoked.status).toBe(200)
    await revoked.body?.cancel()
    const signed = await jwtVerify(agent.accessToken, createRemoteJWKSet(new URL(`${ISSUER}/protocol/openid-connect/certs`)),
      { issuer: ISSUER, audience: PUBLIC_BASE })
    expect(signed.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    const live = await fetch(`${ISSUER}/protocol/openid-connect/token/introspect`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from('hitl-resource:local-resource-only').toString('base64')}` },
      body: new URLSearchParams({ token: agent.accessToken, token_type_hint: 'access_token' }), signal: AbortSignal.timeout(5000),
    })
    expect(live.status).toBe(200)
    z.object({ active: z.literal(false) }).parse(await live.json())
    for (const port of [8789, 8790]) {
      const read = await harness.request(agent, `/v1/operations/${prepared.operation.operation_id}`, { port })
      expect(read.status).toBe(401)
      expect(ErrorResponse.parse(read.body).error).toBe('invalid_token')
      expect((await harness.commit(agent, prepared.operation, port)).status).toBe(401)
    }
    expect(await effectCount(prepared.operation.operation_id)).toBe(0)
    expect(await stock(offer)).toBe(50)
  }, 30000)

  it('E10 actual authorization-server outage fails protected reads and commit closed, then recovers', async () => {
    const offer = await harness.offer()
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    // Warm each worker's genuine JWT/JWKS validation before the actual AS is paused.
    expect((await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)).status).toBe(200)
    expect((await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`, { port: 8790 })).status).toBe(200)
    const compose = fileURLToPath(new URL('../../compose.yaml', import.meta.url))
    let paused = false
    try {
      await exec('docker', ['compose', '-f', compose, 'pause', 'keycloak'], { timeout: 10000 })
      paused = true
      for (const port of [8789, 8790]) {
        const result = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`, { port })
        expect(result.status).toBe(503)
        expect(ErrorResponse.parse(result.body).error).toBe('temporarily_unavailable')
      }
      expect((await harness.commit(alice, prepared.operation)).status).toBe(503)
      expect(await effectCount(prepared.operation.operation_id)).toBe(0)
      expect(await stock(offer)).toBe(50)
    } finally {
      if (paused) await exec('docker', ['compose', '-f', compose, 'unpause', 'keycloak'], { timeout: 10000 })
    }
    expect((await harness.commit(alice, prepared.operation, 8790)).status).toBe(200)
    expect(await effectCount(prepared.operation.operation_id)).toBe(1)
  }, 60000)

  it('E9 shared policy promotion disables old writers and the new worker invalidates old approval before executing its own version', async () => {
    const offer = await harness.offer({ price: 15000 })
    const prepared = await harness.prepare(alice, harness.input(alice, offer))
    await harness.confirm(aliceBrowser, prepared)
    await harness.startWorker(8793, 2)
    z.object({ current_version: z.literal(2) }).parse((await harness.pool.query('SELECT current_version FROM service_policies WHERE namespace=$1', [harness.namespace])).rows[0])
    const stale = await harness.commit(alice, prepared.operation)
    expect(stale.status).toBe(503)
    expect(ErrorResponse.parse(stale.body).error).toBe('temporarily_unavailable')
    const current = await harness.commit(alice, prepared.operation, 8793)
    expect(current.status).toBe(409)
    expect(ErrorResponse.parse(current.body).error).toBe('version_conflict')
    expect(await effectCount(prepared.operation.operation_id)).toBe(0)
    const read = await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)
    expect(OperationResponseSchema.parse(read.body).status).toBe('superseded')
    const freshOffer = await harness.offer()
    const fresh = await harness.prepare(alice, harness.input(alice, freshOffer), randomUUID(), 8793)
    expect(fresh.operation.snapshot.policy_version).toBe(2)
    expect((await harness.commit(alice, fresh.operation, 8793)).status).toBe(200)
    expect(await effectCount(fresh.operation.operation_id)).toBe(1)
  }, 30000)
})
