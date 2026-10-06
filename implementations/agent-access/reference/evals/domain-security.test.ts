import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AgentAccessError, BrowserIdentitySchema, KeycloakAuthenticator, OperationResponseSchema,
  createDPoPProof, type AgentFacts, type BrowserIdentity } from '@hitl-protocol/agent-access'
import { Store, hashToken, opaqueToken } from '../src/store.js'
import { readConfig } from '../src/config.js'
import { EvalHarness, DATABASE_URL, ISSUER, PUBLIC_BASE, type AgentFixture } from './helpers.js'

const harness = new EvalHarness()
const config = readConfig({ DATABASE_URL, SERVICE_NAMESPACE: harness.namespace, PUBLIC_BASE_URL: PUBLIC_BASE,
  OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: PUBLIC_BASE, OIDC_BROWSER_CLIENT_SECRET: 'local-browser-only',
  OIDC_INTROSPECTION_CLIENT_SECRET: 'local-resource-only', ALLOW_INSECURE_LOCALHOST: 'true' })
const store = new Store(config, harness.pool)
const auth = new KeycloakAuthenticator({ issuer: ISSUER, audience: PUBLIC_BASE,
  introspectionClientId: 'hitl-resource', introspectionClientSecret: 'local-resource-only', allowInsecureLocalhost: true }, store)
const Count = z.object({ count: z.coerce.number().int().nonnegative() })
let alice: AgentFixture
let aliceIdentity: BrowserIdentity
let bobIdentity: BrowserIdentity

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function facts(agent: AgentFixture = alice): Promise<AgentFacts> {
  const url = `${PUBLIC_BASE}/v1/bookings/prepare`
  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = await createDPoPProof({ url, method: 'POST', key: agent.key, accessToken: agent.accessToken,
      ...(agent.nonce ? { nonce: agent.nonce } : {}) })
    try { return await auth.authenticate(new Request(url, { method: 'POST', headers: { Authorization: `DPoP ${agent.accessToken}`, DPoP: proof } })) }
    catch (error) {
      if (!(error instanceof AgentAccessError) || error.code !== 'use_dpop_nonce' || !error.headers['DPoP-Nonce']) throw error
      agent.nonce = error.headers['DPoP-Nonce']
    }
  }
  throw new Error('Actual provider nonce exchange failed')
}

/** Delay delivery of an actual PostgreSQL result; no query, identity or stored state is mocked. */
function delayedRead() {
  const captured = deferred(), resume = deferred()
  let intercepted = false
  const pool = new Proxy(harness.pool, { get(target, property, receiver) {
    if (property !== 'query') return Reflect.get(target, property, receiver)
    return async (...args: unknown[]) => {
      const result: unknown = await Reflect.apply(target.query, target, args)
      const sql = args[0]
      if (!intercepted && typeof sql === 'string' && (sql.startsWith('SELECT to_jsonb(p) AS principal')
        || sql.startsWith('SELECT * FROM operations WHERE id=$1 AND principal_id=$2')
        || sql.startsWith('SELECT r.*,o.grant_id FROM reviews'))) {
        intercepted = true
        captured.resolve()
        await resume.promise
      }
      return result
    }
  } })
  return { store: new Store(config, pool), captured: captured.promise, resume: resume.resolve }
}

async function shortProposal(review: boolean) {
  const prepared = await harness.prepare(alice, harness.input(alice, await harness.offer({ refundable: !review })))
  const id = `op_${randomUUID()}`
  await harness.pool.query(`INSERT INTO operations(id,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,expires_at)
    SELECT $1,namespace,principal_id,grant_id,offer_id,snapshot,snapshot_digest,status,clock_timestamp()+interval '2 seconds'
    FROM operations WHERE id=$2`, [id, prepared.operation.operation_id])
  const reviewId = `review_${randomUUID()}`
  if (review) await harness.pool.query(`INSERT INTO reviews(id,operation_id,created_at,expires_at)
    SELECT $1,id,created_at,expires_at FROM operations WHERE id=$2`, [reviewId, id])
  return { operation: await store.readOperation(id, await facts()), reviewId }
}

async function afterDeadline(timestamp: string) {
  await harness.pool.query("SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.02)", [timestamp])
}

describe('Domain authorization, consistent reads and browser session rotation · actual PostgreSQL/OIDC', () => {
  beforeAll(async () => {
    await harness.start()
    alice = await harness.loginAgent('alice')
    const aliceBrowser = await harness.context()
    await harness.enroll(alice, aliceBrowser)
    const bob = await harness.loginAgent('bob')
    const bobBrowser = await harness.context()
    await harness.enroll(bob, bobBrowser)
    async function browserIdentity(context: typeof aliceBrowser) {
      const cookie = (await context.cookies(PUBLIC_BASE)).find((value) => value.name === 'hitl-session')
      if (!cookie) throw new Error('Real OIDC session missing')
      const session = await store.session(cookie.value)
      if (!session?.identity) throw new Error('Real OIDC identity missing')
      return BrowserIdentitySchema.parse(session.identity)
    }
    aliceIdentity = await browserIdentity(aliceBrowser)
    bobIdentity = await browserIdentity(bobBrowser)
  }, 120000)
  beforeEach(async () => { await harness.resetScenario() })
  afterAll(async () => { await harness.close() }, 30000)

  it.each(['operation', 'review'] as const)('a delayed %s read cannot invent expiry after a concurrent successful transition', async (kind) => {
    const { operation, reviewId } = await shortProposal(kind === 'review')
    const reader = delayedRead()
    const readFacts = await facts()
    const pending = kind === 'operation' ? reader.store.readOperation(operation.operation_id, readFacts)
      : reader.store.readReview(reviewId, readFacts)
    try {
      await reader.captured
      if (kind === 'operation') await store.commit(operation.operation_id, await facts(), {
        expected_version: operation.operation_version, snapshot_digest: operation.snapshot_digest })
      else await store.decide(reviewId, aliceIdentity, [reviewId], 'confirm')
      await afterDeadline(operation.expires_at)
    } finally { reader.resume() }
    const observed = await pending
    expect(observed.status).toBe(kind === 'operation' ? 'ready' : 'pending')
    const current = kind === 'operation' ? await harness.request(alice, `/v1/operations/${operation.operation_id}`)
      : await harness.request(alice, `/v1/reviews/${reviewId}`)
    expect(current.status).toBe(200)
    expect(z.object({ status: z.literal(kind === 'operation' ? 'succeeded' : 'completed') }).parse(current.body).status)
      .toBe(kind === 'operation' ? 'succeeded' : 'completed')
  }, 15000)

  it('a review capability and matching owner cannot cross the configured service namespace', async () => {
    const prepared = await harness.prepare(alice, harness.input(alice, await harness.offer({ refundable: false })))
    if (!prepared.reviewUrl || !prepared.caseId) throw new Error('Actual prepared review missing')
    const token = new URL(prepared.reviewUrl).searchParams.get('token')
    if (!token) throw new Error('Actual review capability missing')
    const other = new Store({ ...config, SERVICE_NAMESPACE: `${harness.namespace}-other` }, harness.pool)
    await expect(other.validateCapability(prepared.caseId, token)).rejects.toMatchObject({ status: 404 })
    await expect(other.browserReview(prepared.caseId, aliceIdentity, [prepared.caseId])).rejects.toMatchObject({ status: 404 })
    await expect(other.decide(prepared.caseId, aliceIdentity, [prepared.caseId], 'confirm')).rejects.toMatchObject({ status: 404 })
    expect((await store.readReview(prepared.caseId, await facts())).status).toBe('pending')
  })

  it.each(['future', 'old'] as const)('commit rejects a %s introspection observation without booking or stock effects', async (kind) => {
    const prepared = await harness.prepare(alice, harness.input(alice, await harness.offer()))
    const current = await facts(), now = await store.now()
    const observed_at = new Date(now.getTime() + (kind === 'future' ? 30000 : -2001)).toISOString()
    await expect(store.commit(prepared.operation.operation_id, { ...current, observed_at }, {
      expected_version: prepared.operation.operation_version, snapshot_digest: prepared.operation.snapshot_digest,
    })).rejects.toMatchObject({ status: 503, code: 'temporarily_unavailable' })
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM bookings WHERE operation_id=$1', [prepared.operation.operation_id])).rows[0]).count).toBe(0)
    expect(z.object({ stock: z.literal(50) }).parse((await harness.pool.query('SELECT stock FROM offers WHERE id=$1', [prepared.operation.snapshot.offer_id])).rows[0]).stock).toBe(50)
    expect(OperationResponseSchema.parse((await harness.request(alice, `/v1/operations/${prepared.operation.operation_id}`)).body).status).toBe('ready')
  })

  it('revocation freshness expiring while grant locks wait rolls back principal, grant and operation changes', async () => {
    const prepared = await harness.prepare(alice, harness.input(alice, await harness.offer()))
    const principalId = alice.enrollment!.principal_id, grantId = alice.enrollment!.grant_id
    const identity = { ...aliceIdentity, auth_time: Math.floor((await store.now()).getTime() / 1000) - 298 }
    const blocker = await harness.pool.connect()
    let pending: Promise<unknown> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM grants WHERE id=$1 FOR UPDATE', [grantId])
      pending = store.revoke(principalId!, identity).then(() => undefined, (error: unknown) => error)
      let blocked = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const row = await harness.pool.query("SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM grants WHERE principal_id=%'")
        if (Count.parse(row.rows[0]).count > 0) { blocked = true; break }
        await harness.pool.query('SELECT pg_sleep(0.01)')
      }
      expect(blocked).toBe(true)
      await afterDeadline(new Date((identity.auth_time + 300) * 1000).toISOString())
      await blocker.query('COMMIT')
      expect(await pending).toMatchObject({ status: 401, code: 'reauthentication_required' })
      expect(z.object({ active: z.literal(true) }).parse((await harness.pool.query('SELECT active FROM principals WHERE id=$1', [principalId])).rows[0]).active).toBe(true)
      expect(z.object({ active: z.literal(true) }).parse((await harness.pool.query('SELECT active FROM grants WHERE id=$1', [grantId])).rows[0]).active).toBe(true)
      expect((await store.readOperation(prepared.operation.operation_id, await facts())).status).toBe('ready')
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending }
  }, 15000)

  it.each(['anonymous', 'same-owner', 'different-owner'] as const)('login rotates %s session and consumes all old OIDC attempts', async (kind) => {
    const prepared = await harness.prepare(alice, harness.input(alice, await harness.offer({ refundable: false })))
    if (!prepared.caseId) throw new Error('Actual review missing')
    let previous = await store.createSession(opaqueToken())
    harness.sessionHashes.add(previous.session.token_hash)
    if (kind !== 'anonymous') {
      previous = await store.authenticateSession(previous.session, aliceIdentity)
      harness.sessionHashes.add(previous.session.token_hash)
    }
    await store.addCapability(previous.session, prepared.caseId)
    await store.saveOidcState(previous.session, opaqueToken(), opaqueToken(), opaqueToken(), `/review/${prepared.caseId}`)
    await store.saveOidcState(previous.session, opaqueToken(), opaqueToken(), opaqueToken(), '/account/agents')
    const next = await store.authenticateSession(previous.session, kind === 'different-owner' ? bobIdentity : aliceIdentity)
    harness.sessionHashes.add(next.session.token_hash)
    expect(next.token).not.toBe(previous.token)
    expect(next.session.csrf_hash).toBe(hashToken(next.csrf))
    expect(next.session.csrf_hash).not.toBe(previous.session.csrf_hash)
    expect(await store.session(previous.token)).toBeUndefined()
    expect(next.session.review_ids).toEqual(kind === 'different-owner' ? [] : [prepared.caseId])
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM oidc_states WHERE session_hash=$1', [previous.session.token_hash])).rows[0]).count).toBe(0)
    await expect(store.authenticateSession(previous.session, aliceIdentity)).rejects.toMatchObject({ status: 401 })
  })

  it('two concurrent successful callbacks can rotate a session only once', async () => {
    const previous = await store.createSession(opaqueToken())
    harness.sessionHashes.add(previous.session.token_hash)
    const results = await Promise.allSettled([store.authenticateSession(previous.session, aliceIdentity), store.authenticateSession(previous.session, bobIdentity)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    for (const result of results) {
      if (result.status === 'fulfilled') harness.sessionHashes.add(result.value.session.token_hash)
      else expect(result.reason).toMatchObject({ status: 401 })
    }
    expect(await store.session(previous.token)).toBeUndefined()
  })

  it('stale OIDC authentication cannot rotate a live session or consume its pending attempts', async () => {
    const previous = await store.createSession(opaqueToken())
    harness.sessionHashes.add(previous.session.token_hash)
    await store.saveOidcState(previous.session, opaqueToken(), opaqueToken(), opaqueToken(), '/account/agents')
    const identity = { ...aliceIdentity, auth_time: Math.floor((await store.now()).getTime() / 1000) - 301 }
    await expect(store.authenticateSession(previous.session, identity)).rejects.toMatchObject({ status: 401 })
    expect(await store.session(previous.token)).toBeDefined()
    expect(Count.parse((await harness.pool.query('SELECT count(*) AS count FROM oidc_states WHERE session_hash=$1', [previous.session.token_hash])).rows[0]).count).toBe(1)
  })
})
