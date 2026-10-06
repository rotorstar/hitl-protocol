import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID, createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'
import { Pool } from 'pg'
import { generateKeyPair, exportJWK, calculateJwkThumbprint, type JWK } from 'jose'
import { z } from 'zod'
import { CatalogResponseSchema, signPublicWebRequest, directoryUrl, DIRECTORY_MEDIA_TYPE } from '@hitl-protocol/agent-access'
import { DATABASE_URL, ISSUER, PUBLIC_BASE, type Worker } from './helpers.js'
import { Store } from '../src/store.js'
import { readConfig } from '../src/config.js'
import { PersistentDirectories } from '../src/directories.js'

const PORTS = [8791, 8792] as const
const schema = `eval_public_${randomUUID().replaceAll('-', '')}`
const database = new URL(DATABASE_URL)
database.searchParams.set('options', `-c search_path=${schema}`)
const databaseUrl = database.href
const admin = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 2000 })
const pool = new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 2000 })
const workers: Worker[] = []
let postgresVersion = ''
const root = fileURLToPath(new URL('../', import.meta.url))
const Metadata = z.object({ fetches: z.number().int(), active: z.number().int(), peak: z.number().int() })
const PublicError = z.object({ error: z.enum(['invalid_request', 'insufficient_scope', 'rate_limited', 'temporarily_unavailable']) })
function directoryStore(): Store {
  return new Store(readConfig({ DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: PUBLIC_BASE, OIDC_ISSUER: ISSUER,
    OIDC_BROWSER_CLIENT_SECRET: 'local-browser-only', OIDC_INTROSPECTION_CLIENT_SECRET: 'local-resource-only',
    ALLOW_INSECURE_LOCALHOST: 'true' }), pool)
}
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>
interface Result { status: number; body: unknown; headers: Headers }

async function startWorker(port: number, host = '127.0.0.1'): Promise<Worker> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(port, host, () => probe.close((error) => error ? reject(error) : resolve()))
  })
  let output = ''
  const child = spawn(process.execPath, ['--import', 'tsx', 'evals/public-worker.ts'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: PUBLIC_BASE,
      OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: PUBLIC_BASE, OIDC_BROWSER_CLIENT_SECRET: 'local-browser-only',
      OIDC_INTROSPECTION_CLIENT_SECRET: 'local-resource-only', SERVICE_NAMESPACE: 'eval-public',
      ALLOW_INSECURE_LOCALHOST: 'true', PORT: String(port), HOST: host },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const capture = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-12000) }
  child.stdout?.on('data', capture); child.stderr?.on('data', capture)
  const worker = { child, port, output: () => output }
  workers.push(worker)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Public worker ${port} exited: ${output}`)
    try {
      if ((await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok) return worker
    } catch { /* The owned process is still starting; its exit and output are checked. */ }
    await pause(100)
  }
  throw new Error(`Public worker ${port} never became healthy: ${output}`)
}
async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), pause(5000)])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}
async function key(): Promise<SigningKey> { return generateKeyPair('EdDSA', { extractable: true }) }
async function publicKey(pair: SigningKey): Promise<JWK> {
  const value = await exportJWK(pair.publicKey)
  return { ...value, kid: await calculateJwkThumbprint(value), use: 'sig', alg: 'EdDSA' }
}
function origin(label: string): string { return `https://${label}-${randomUUID()}.example` }
async function fixture(agentOrigin: string, keys: JWK[], options: {
  body?: string; contentType?: string; unavailable?: boolean; delay?: number; maxAge?: number
} = {}): Promise<void> {
  await pool.query(`INSERT INTO eval_directories(identifier,body,content_type,max_age,delay_ms,unavailable)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(identifier) DO UPDATE SET body=excluded.body,
    content_type=excluded.content_type,unavailable=excluded.unavailable,max_age=excluded.max_age`,
  [directoryUrl(agentOrigin).href, options.body ?? JSON.stringify({ keys }), options.contentType ?? DIRECTORY_MEDIA_TYPE,
    options.maxAge ?? 300, options.delay ?? 50, options.unavailable ?? false])
}
async function metrics(agentOrigin: string) {
  const result = await pool.query<Record<string, unknown>>('SELECT fetches,active,peak FROM eval_directories WHERE identifier=$1', [directoryUrl(agentOrigin).href])
  return Metadata.parse(result.rows[0])
}
async function signed(pair: SigningKey, agentOrigin: string, options: {
  path?: string; canonicalOrigin?: string; headers?: HeadersInit; nonce?: string
} = {}): Promise<Request> {
  const request = new Request(`${options.canonicalOrigin ?? PUBLIC_BASE}${options.path ?? '/v1/catalog'}`, {
    ...(options.headers ? { headers: options.headers } : {}),
  })
  return signPublicWebRequest(request, { agentOrigin, privateKey: pair.privateKey, publicKey: pair.publicKey,
    ...(options.nonce ? { nonce: options.nonce } : {}) })
}
/** Assemble RFC 9421 bytes independently of the package signing helper. */
async function independentSignature(pair: SigningKey, agentOrigin: string): Promise<Request> {
  const url = new URL('/v1/catalog', PUBLIC_BASE)
  const jwk = await exportJWK(pair.publicKey)
  const keyid = createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url')
  const created = Math.floor(Date.now() / 1000)
  const params = `("@method" "@authority" "@target-uri" "signature-agent";key="sig1");created=${created};expires=${created + 60};nonce="${randomUUID()}";keyid="${keyid}";tag="web-bot-auth";alg="ed25519"`
  const bytes = [`"@method": GET`, `"@authority": ${url.host}`, `"@target-uri": ${url.href}`,
    `"signature-agent";key="sig1": "${agentOrigin}"`, `"@signature-params": ${params}`].join('\n')
  const privateKey = createPrivateKey({ key: await exportJWK(pair.privateKey), format: 'jwk' })
  const signature = cryptoSign(null, Buffer.from(bytes), privateKey).toString('base64')
  return new Request(url, { headers: { 'Signature-Agent': `sig1="${agentOrigin}"`,
    'Signature-Input': `sig1=${params}`, Signature: `sig1=:${signature}:` } })
}
async function send(request: Request = new Request(`${PUBLIC_BASE}/v1/catalog`), port: number = PORTS[0], host = '127.0.0.1'): Promise<Result> {
  const physical = new URL(request.url); physical.protocol = 'http:'; physical.hostname = host.includes(':') ? `[${host}]` : host; physical.port = String(port)
  const response = await fetch(physical, { headers: request.headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
  return { status: response.status, body: await response.json(), headers: response.headers }
}
async function expectError(response: Result, status: number, error: z.infer<typeof PublicError>['error']) {
  expect(response.status).toBe(status)
  expect(PublicError.parse(response.body).error).toBe(error)
}
async function cleanupWorker(): Promise<void> {
  const worker = workers.find((entry) => entry.child.exitCode === null && entry.child.signalCode === null)
  if (!worker) throw new Error('No live worker')
  const id = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { worker.child.off('message', listen); reject(new Error('Worker cleanup timeout')) }, 5000)
    function listen(message: unknown) {
      if (!message || typeof message !== 'object' || !('id' in message) || message.id !== id) return
      clearTimeout(timer); worker!.child.off('message', listen)
      if ('kind' in message && message.kind === 'cleaned') resolve()
      else reject(new Error('Worker cleanup failed'))
    }
    worker.child.on('message', listen); worker.child.send({ kind: 'cleanup', id })
  })
}

describe('E3/E4/E11 real HTTP public-web and PostgreSQL boundaries', () => {
  beforeAll(async () => {
    const version = await admin.query<{ version: string }>("SELECT current_setting('server_version') AS version")
    expect(version.rows[0]?.version).toMatch(/^18\./)
    postgresVersion = version.rows[0]!.version
    // A separate schema makes outage/cleanup injections incapable of touching other evals.
    await admin.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`CREATE TABLE eval_directories(identifier text PRIMARY KEY,body text NOT NULL,
      content_type text NOT NULL,max_age integer NOT NULL,delay_ms integer NOT NULL,unavailable boolean NOT NULL,
      fetches integer NOT NULL DEFAULT 0,active integer NOT NULL DEFAULT 0,peak integer NOT NULL DEFAULT 0)`)
    await startWorker(PORTS[0]); await startWorker(PORTS[1])
    expect(workers[0]?.child.pid).not.toBe(workers[1]?.child.pid)
  }, 30000)
  beforeEach(async () => {
    await pool.query('TRUNCATE eval_directories,directory_cache,directory_leases,replays,nonces,quotas')
  })
  afterAll(async () => {
    await Promise.all(workers.map((worker) => stopWorker(worker.child)))
    await pool.end()
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } finally { await admin.end() }
  }, 15000)

  it('distinguishes anonymous, verified, invalid and unavailable over real HTTP', async () => {
    const anonymous = await send()
    expect(anonymous.status).toBe(200)
    expect(CatalogResponseSchema.parse(anonymous.body).agent.status).toBe('anonymous')
    const pair = await key(); const who = origin('states')
    await fixture(who, [await publicKey(pair)])
    const verified = await send(await signed(pair, who))
    expect(verified.status).toBe(200)
    expect(CatalogResponseSchema.parse(verified.body).agent).toMatchObject({
      status: 'verified', identifier: directoryUrl(who).href,
      keyid: await calculateJwkThumbprint(await exportJWK(pair.publicKey)),
    })
    const invalid = await signed(pair, who)
    const headers = new Headers(invalid.headers); headers.set('Signature', 'not-a-dictionary')
    await expectError(await send(new Request(invalid, { headers })), 400, 'invalid_request')
    const unavailable = origin('unavailable')
    await fixture(unavailable, [], { unavailable: true })
    await expectError(await send(await signed(pair, unavailable)), 503, 'temporarily_unavailable')
    expect(await metrics(unavailable)).toMatchObject({ fetches: 1, active: 0, peak: 1 })
  })

  it('binds the same Ed25519 key to each discovered directory URL', async () => {
    const pair = await key(); const first = origin('binding-a'); const second = origin('binding-b')
    const jwk = await publicKey(pair)
    await fixture(first, [jwk]); await fixture(second, [jwk])
    for (const [index, who] of [first, second].entries()) {
      const response = await send(await signed(pair, who), PORTS[index % 2])
      expect(response.status).toBe(200)
      expect(CatalogResponseSchema.parse(response.body).agent.identifier).toBe(directoryUrl(who).href)
    }
    expect(await metrics(first)).toMatchObject({ fetches: 1 })
    expect(await metrics(second)).toMatchObject({ fetches: 1 })
  })

  it('uses database time for cache expiry and forced-refresh cooldown despite worker clock skew', async () => {
    const store = directoryStore()
    const who = origin('clock'); const identifier = directoryUrl(who).href
    const jwk = await publicKey(await key())
    const fetchDirectory = vi.fn(async () => ({ identifier, keys: [jwk], expiresAt: new Date((await store.now()).getTime() + 300_000) }))
    const directories = new PersistentDirectories(store, { resolve: fetchDirectory })
    await pool.query(`INSERT INTO directory_cache(identifier,payload,expires_at)
      VALUES($1,$2,clock_timestamp()+interval '5 minutes')`, [identifier, JSON.stringify([jwk])])
    const realNow = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 120_000)
    try {
      expect((await directories.resolve(who, { refresh: true })).keys).toEqual([jwk])
      expect(fetchDirectory).not.toHaveBeenCalled()
      await pool.query("UPDATE directory_cache SET expires_at=clock_timestamp()-interval '1 second' WHERE identifier=$1", [identifier])
      clock.mockReturnValue(realNow - 120_000)
      await directories.resolve(who)
      expect(fetchDirectory).toHaveBeenCalledOnce()
    } finally { clock.mockRestore() }
  })

  it.each(['success', 'failure'] as const)('fences a displaced lease owner after a late upstream %s', async (outcome) => {
    const store = directoryStore()
    const who = origin('lease'); const identifier = directoryUrl(who).href
    const stale = await publicKey(await key()); const current = await publicKey(await key())
    let started!: () => void; let release!: () => void
    const entering = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const previous = new PersistentDirectories(store, { resolve: async () => {
      started(); await gate
      if (outcome === 'failure') throw new Error('Previous owner failed')
      return { identifier, keys: [stale], expiresAt: new Date((await store.now()).getTime() + 300_000) }
    } })
    const next = new PersistentDirectories(store, { resolve: async () => ({
      identifier, keys: [current], expiresAt: new Date((await store.now()).getTime() + 300_000),
    }) })
    const pending = previous.resolve(who)
    // Observe rejection immediately while keeping deterministic control of the outstanding request.
    const completed = pending.then((value) => ({ value }), (error: unknown) => ({ error }))
    await entering
    await pool.query("UPDATE directory_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE identifier=$1", [identifier])
    expect((await next.resolve(who)).keys).toEqual([current])
    release()
    const result = await completed
    if (outcome === 'success') expect('value' in result && result.value.keys).toEqual([current])
    else expect('error' in result && result.error).toBeInstanceOf(Error)
    const cached = await pool.query<{ payload: unknown; failed: boolean }>('SELECT payload,failed FROM directory_cache WHERE identifier=$1', [identifier])
    expect(cached.rows[0]).toEqual({ payload: [current], failed: false })
  })

  it('does not start a fetch after its lease expires during the quota database operation', async () => {
    const store = directoryStore()
    const who = origin('quota-lease'); const identifier = directoryUrl(who).href
    const jwk = await publicKey(await key())
    const fetchDirectory = vi.fn(async () => ({ identifier, keys: [jwk], expiresAt: new Date((await store.now()).getTime() + 300_000) }))
    const quota = store.quota.bind(store)
    store.quota = async (...args) => {
      await quota(...args)
      await pool.query("UPDATE directory_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE identifier=$1", [identifier])
    }
    const directories = new PersistentDirectories(store, { resolve: fetchDirectory })
    await expect(directories.resolve(who)).rejects.toThrow('Directory lease expired')
    expect(fetchDirectory).not.toHaveBeenCalled()
    expect((await pool.query('SELECT identifier FROM directory_cache WHERE identifier=$1', [identifier])).rowCount).toBe(0)
  })

  it('accepts independently assembled RFC 9421 Ed25519 signature bytes over HTTP', async () => {
    const pair = await key(); const who = origin('independent')
    await fixture(who, [await publicKey(pair)])
    const request = await independentSignature(pair, who)
    const response = await send(request, PORTS[1])
    expect(response.status).toBe(200)
    expect(CatalogResponseSchema.parse(response.body).agent.identifier).toBe(directoryUrl(who).href)
  })

  it('ignores spoofed forwarding headers and rejects a target signed for the spoofed origin', async () => {
    const pair = await key(); const who = origin('forwarded')
    await fixture(who, [await publicKey(pair)])
    const headers = { Forwarded: 'for=127.0.0.1;host=attacker.example;proto=https',
      'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' }
    expect((await send(await signed(pair, who, { headers }), PORTS[1])).status).toBe(200)
    await expectError(await send(await signed(pair, who, { headers, canonicalOrigin: 'https://attacker.example' })), 400, 'invalid_request')
  })

  it('accepts a shared nonce exactly once across two worker processes and preserves the replay after restart', async () => {
    const pair = await key(); const who = origin('replay')
    await fixture(who, [await publicKey(pair)])
    const request = await signed(pair, who, { nonce: randomUUID() })
    const responses = await Promise.all(PORTS.map((port) => send(request, port)))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect(PublicError.parse(responses.find((response) => response.status === 429)?.body).error).toBe('rate_limited')
    const persisted = await pool.query<{ count: string }>("SELECT count(*) FROM replays WHERE namespace='public-web'")
    expect(persisted.rows[0]?.count).toBe('1')
    const old = workers.find((worker) => worker.port === PORTS[0])!
    await stopWorker(old.child)
    await startWorker(PORTS[0])
    await expectError(await send(request, PORTS[0]), 429, 'rate_limited')
  }, 15000)

  it('coalesces 100 cold fetches across workers and performs no fetch on 100 warm signatures', async () => {
    const pair = await key(); const who = origin('cold')
    await fixture(who, [await publicKey(pair)], { delay: 150 })
    async function hundred(phase: 'cold' | 'warm') {
      const requests = await Promise.all(Array.from({ length: 100 }, () => signed(pair, who)))
      const before = await metrics(who)
      const started = performance.now()
      const completed = await Promise.all(requests.map(async (request, index) => {
        const requestStarted = performance.now()
        const response = await send(request, PORTS[index % 2])
        return { response, latency: performance.now() - requestStarted }
      }))
      const batchMs = performance.now() - started
      const responses = completed.map((entry) => entry.response)
      expect(responses.every((response) => response.status === 200)).toBe(true)
      for (const response of responses) expect(CatalogResponseSchema.parse(response.body).agent.status).toBe('verified')
      const times = completed.map((entry) => entry.latency).sort((left, right) => left - right)
      const after = await metrics(who)
      const timing = { phase, requests: times.length, p50Ms: times[49]!, p95Ms: times[94]!, maxMs: times[99]!, batchMs,
        directoryFetches: after.fetches - before.fetches, directory: after }
      console.log(JSON.stringify({ publicWebPerformance: timing }))
      return timing
    }
    const cold = await hundred('cold')
    expect(await metrics(who)).toEqual({ fetches: 1, active: 0, peak: 1 })
    const warm = await hundred('warm')
    expect(await metrics(who)).toEqual({ fetches: 1, active: 0, peak: 1 })
    await mkdir(new URL('../.eval/', import.meta.url), { recursive: true })
    await writeFile(new URL('../.eval/public-performance.json', import.meta.url), `${JSON.stringify({
      environment: { node: process.versions.node, platform: process.platform, arch: process.arch, postgres: postgresVersion, workers: 2,
        poolMaxPerWorker: 10, directoryFixtureDelayMs: 150, transport: 'local HTTP; persistent production adapters; controlled directory fixture' },
      batches: [cold, warm],
    }, null, 2)}\n`)
  }, 20000)

  it('refreshes rotated keys at the same URL after the bounded refresh cooldown', async () => {
    const pair = await key(); const replacement = await key(); const who = origin('rotation')
    await fixture(who, [await publicKey(pair)])
    expect((await send(await signed(pair, who))).status).toBe(200)
    await fixture(who, [await publicKey(replacement)])
    // The directory/cache refresh guard intentionally bounds attacker-triggered refreshes.
    await expectError(await send(await signed(replacement, who), PORTS[1]), 400, 'invalid_request')
    expect((await metrics(who)).fetches).toBe(1)
    await pause(31_050)
    expect((await send(await signed(replacement, who), PORTS[1])).status).toBe(200)
    expect((await metrics(who)).fetches).toBe(2)
    await expectError(await send(await signed(pair, who), PORTS[0]), 400, 'invalid_request')
    expect((await metrics(who)).fetches).toBe(2)
  }, 40000)

  it('rejects oversized, private, excess-key and wrong-MIME directories and negative-caches failure', async () => {
    const pair = await key(); const jwk = await publicKey(pair)
    const malformed: Array<{ label: string; keys: JWK[]; body?: string; contentType?: string }> = [
      { label: 'oversized', keys: [], body: ' '.repeat(65_537) },
      { label: 'private', keys: [{ ...jwk, d: 'private-key-material' }] },
      { label: 'excess', keys: Array.from({ length: 33 }, () => jwk) },
      { label: 'mime', keys: [jwk], contentType: 'application/json' },
    ]
    for (const input of malformed) {
      const who = origin(input.label)
      await fixture(who, input.keys, input)
      for (const port of PORTS) await expectError(await send(await signed(pair, who), port), 503, 'temporarily_unavailable')
      expect(await metrics(who)).toEqual({ fetches: 1, active: 0, peak: 1 })
    }
    const who = origin('negative'); await fixture(who, [], { unavailable: true, delay: 100 })
    const requests = await Promise.all(Array.from({ length: 20 }, () => signed(pair, who)))
    const replies = await Promise.all(requests.map((request, index) => send(request, PORTS[index % 2])))
    expect(replies.every((response) => response.status === 503)).toBe(true)
    expect(await metrics(who)).toEqual({ fetches: 1, active: 0, peak: 1 })
  }, 15000)

  it('enforces shared anonymous, global and directory-fetch quotas with explicit retry responses', async () => {
    const batch = await Promise.all(Array.from({ length: 61 }, (_, index) => send(undefined, PORTS[index % 2])))
    expect(batch.filter((response) => response.status === 200)).toHaveLength(60)
    expect(batch.filter((response) => response.status === 429)).toHaveLength(1)
    expect(batch.find((response) => response.status === 429)?.headers.get('Retry-After')).toBe('60')
    await pool.query('TRUNCATE quotas')
    await pool.query("INSERT INTO quotas(key,window_start,count) VALUES('public:global',date_trunc('minute',clock_timestamp()),6000)")
    await expectError(await send(undefined, PORTS[1]), 429, 'rate_limited')
    await pool.query('TRUNCATE quotas')
    await pool.query("INSERT INTO quotas(key,window_start,count) VALUES('directory-fetch:global',date_trunc('minute',clock_timestamp()),100)")
    const pair = await key(); const who = origin('fetchquota')
    await fixture(who, [await publicKey(pair)])
    await expectError(await send(await signed(pair, who)), 503, 'temporarily_unavailable')
    expect((await metrics(who)).fetches).toBe(0)
    // Hitting the upstream budget also creates a bounded persistent negative cache.
    const cached = await pool.query<{ failed: boolean }>('SELECT failed FROM directory_cache WHERE identifier=$1', [directoryUrl(who).href])
    expect(cached.rows[0]?.failed).toBe(true)
  }, 15000)

  it('does not spend the global budget on 100 IP-blocked requests and permits a distinct actual peer', async () => {
    // Seed adjacent windows so crossing a minute boundary cannot change the regression's premise.
    await pool.query(`WITH current_window AS (SELECT date_trunc('minute',clock_timestamp()) AS start)
      INSERT INTO quotas(key,window_start,count)
      SELECT key,window_start,count FROM
      (VALUES ('public:ip:127.0.0.1',600),('public:global',1)) AS limits(key,count)
      CROSS JOIN (SELECT start AS window_start FROM current_window
        UNION ALL SELECT start+interval '1 minute' FROM current_window) AS windows`)
    const globalCount = async () => (await pool.query<{ count: number }>(
      "SELECT coalesce(sum(count),0)::integer AS count FROM quotas WHERE key='public:global'",
    )).rows[0]?.count
    expect(await globalCount()).toBe(2)
    const blocked = await Promise.all(Array.from({ length: 100 }, (_, index) => send(undefined, PORTS[index % 2])))
    for (const response of blocked) await expectError(response, 429, 'rate_limited')
    expect(await globalCount()).toBe(2)
    // IPv6 loopback is an actual second peer on macOS without requiring an OS loopback alias.
    const previous = workers.find((worker) => worker.port === PORTS[1] && worker.child.exitCode === null && worker.child.signalCode === null)!
    await stopWorker(previous.child)
    const ipv6 = await startWorker(PORTS[1], '::1')
    try {
      const otherPeer = await send(undefined, PORTS[1], '::1')
      expect(otherPeer.status).toBe(200)
      expect(CatalogResponseSchema.parse(otherPeer.body).agent.status).toBe('anonymous')
      expect(await globalCount()).toBe(3)
      expect((await pool.query<{ count: number }>(
        "SELECT sum(count)::integer AS count FROM quotas WHERE key='public:ip:::1'",
      )).rows[0]?.count).toBe(1)
    } finally {
      await stopWorker(ipv6.child)
      await startWorker(PORTS[1])
    }
  }, 15000)

  it('fails closed on replay-store outage and cleans expired security rows without removing live replay protection', async () => {
    const pair = await key(); const who = origin('storeoutage')
    await fixture(who, [await publicKey(pair)])
    expect((await send(await signed(pair, who))).status).toBe(200)
    await pool.query('ALTER TABLE replays RENAME TO eval_replays_outage')
    try { await expectError(await send(await signed(pair, who), PORTS[1]), 503, 'temporarily_unavailable') }
    finally { await pool.query('ALTER TABLE eval_replays_outage RENAME TO replays') }
    expect((await metrics(who)).fetches).toBe(1)
    const hash = createHash('sha256').update('expired-fixture').digest('hex')
    await pool.query("INSERT INTO replays(namespace,key,id,expires_at) VALUES('eval','expired','one',clock_timestamp()-interval '1 second'),('eval','live','two',clock_timestamp()+interval '1 minute')")
    await pool.query("INSERT INTO nonces(jkt,nonce_hash,expires_at) VALUES('eval',$1,clock_timestamp()-interval '1 second')", [hash])
    await pool.query("INSERT INTO directory_leases(identifier,owner,expires_at) VALUES('expired','eval',clock_timestamp()-interval '1 second')")
    await pool.query("INSERT INTO directory_cache(identifier,failed,expires_at) VALUES('expired',true,clock_timestamp()-interval '6 minutes')")
    await pool.query("INSERT INTO quotas(key,window_start,count) VALUES('expired',clock_timestamp()-interval '6 minutes',1)")
    await cleanupWorker()
    expect((await pool.query("SELECT id FROM replays WHERE namespace='eval'")).rows).toEqual([{ id: 'two' }])
    for (const table of ['nonces', 'directory_leases', 'directory_cache', 'quotas']) {
      expect((await pool.query(`SELECT count(*)::integer AS count FROM ${table} WHERE ${table === 'nonces' ? 'jkt' : table === 'quotas' ? 'key' : 'identifier'}=$1`,
        [table === 'nonces' ? 'eval' : 'expired'])).rows[0]?.count).toBe(0)
    }
  })
})
