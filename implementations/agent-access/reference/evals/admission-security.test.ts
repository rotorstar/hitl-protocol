import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { calculateJwkThumbprint, decodeJwt } from 'jose'
import { z } from 'zod'
import { createDPoPProof } from '@hitl-protocol/agent-access'
import { EvalHarness, PUBLIC_BASE, completeLoginForm, type AgentFixture } from './helpers.js'

const h = new EvalHarness()
const Count = z.object({ count: z.coerce.number().int().nonnegative() })
let alice: AgentFixture
let jkt: string

async function fillQuota(key: string, count: number) {
  // Include the next window so this test cannot become nondeterministic at a minute boundary.
  await h.pool.query(`INSERT INTO quotas(key,window_start,count)
    SELECT $1,date_trunc('minute',clock_timestamp())+n*$3::interval,$2 FROM generate_series(0,1) AS steps(n)
    ON CONFLICT(key,window_start) DO UPDATE SET count=EXCLUDED.count`, [key, count, '1 minute'])
}

async function count(sql: string, values: unknown[] = []) {
  return Count.parse((await h.pool.query(sql, values)).rows[0]).count
}

async function allocatedBrowserState() {
  return {
    sessions: (await h.pool.query<{ token_hash: string }>('SELECT token_hash FROM browser_sessions')).rows.map((row) => row.token_hash).sort(),
    attempts: (await h.pool.query<{ state_hash: string }>('SELECT state_hash FROM oidc_states')).rows.map((row) => row.state_hash).sort(),
  }
}

describe('Admission and browser boundaries · actual HTTP, PostgreSQL and OIDC', () => {
  beforeAll(async () => {
    await h.start()
    alice = await h.loginAgent('alice')
    jkt = await calculateJwkThumbprint(await crypto.subtle.exportKey('jwk', alice.key.publicKey))
    await h.enroll(alice, await h.context())
  }, 60000)
  beforeEach(async () => { await h.resetScenario() })
  afterAll(async () => { await h.close() }, 30000)

  it.each(['', '?token=', '?token=invalid'] as const)('invalid review link %s allocates no session or OIDC state', async (suffix) => {
    const before = await allocatedBrowserState()
    const response = await fetch(`${PUBLIC_BASE}/review/review_${randomUUID()}${suffix}`, { redirect: 'manual' })
    expect(response.status).toBe(404)
    expect(response.headers.has('Set-Cookie')).toBe(false)
    expect(await allocatedBrowserState()).toEqual(before)
  })

  it.each(['/connect/enroll_missing', '/review/review_missing/respond', '/account/agents/principal_missing/revoke'])('unauthenticated POST %s allocates no session', async (path) => {
    const before = await allocatedBrowserState()
    const response = await fetch(`${PUBLIC_BASE}${path}`, { method: 'POST', redirect: 'manual',
      headers: { Origin: PUBLIC_BASE, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'csrf=invalid&action=confirm' })
    expect(response.status).toBe(401)
    expect(response.headers.has('Set-Cookie')).toBe(false)
    expect(await allocatedBrowserState()).toEqual(before)
  })

  it('both workers reject exhausted peer admission before nonce allocation and ignore forwarded headers', async () => {
    await fillQuota(`admission:${h.namespace}:ip:127.0.0.1`, 240)
    const before = await count('SELECT count(*) AS count FROM nonces WHERE jkt=$1', [jkt])
    const proof = await createDPoPProof({ url: `${PUBLIC_BASE}/v1/agent-enrollments`, method: 'POST', key: alice.key, accessToken: alice.accessToken })
    for (const port of [8789, 8790]) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/agent-enrollments`, { method: 'POST', headers: {
        Authorization: `DPoP ${alice.accessToken}`, DPoP: proof, 'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.${port - 8788}`, Forwarded: 'for=198.51.100.90',
      }, body: JSON.stringify({ display_name: 'admission regression', max_total_cents: 50000 }) })
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(response.headers.has('DPoP-Nonce')).toBe(false)
    }
    expect(await count('SELECT count(*) AS count FROM nonces WHERE jkt=$1', [jkt])).toBe(before)
    expect(await count('SELECT count(*) AS count FROM quotas WHERE key=$1', [`admission:${h.namespace}:global`])).toBe(0)
    await h.pool.query('DELETE FROM quotas WHERE key=$1', [`admission:${h.namespace}:ip:127.0.0.1`])
    expect((await h.request(alice, '/v1/agent-enrollments', { method: 'POST',
      body: { display_name: 'recovered admission', max_total_cents: 50000 } })).status).toBe(201)
  })

  it('global admission rejects browser bootstrap before allocating session or authorization attempt', async () => {
    await fillQuota(`admission:${h.namespace}:global`, 2400)
    const before = await allocatedBrowserState()
    const response = await fetch(`${PUBLIC_BASE}/account/agents`, { redirect: 'manual' })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.has('Location')).toBe(false)
    expect(response.headers.has('Set-Cookie')).toBe(false)
    expect(await allocatedBrowserState()).toEqual(before)
  })

  it('an exhausted agent quota cannot consume the shared account quota', async () => {
    const claims = z.object({ iss: z.string(), sub: z.string(), azp: z.string() }).parse(decodeJwt(alice.accessToken))
    await fillQuota(`agent:${h.namespace}:${claims.iss}:${claims.sub}:${claims.azp}:${jkt}`, 60)
    const response = await h.request(alice, `/v1/agent-enrollments/${alice.enrollment!.id}`)
    expect(response.status).toBe(429)
    expect(await count('SELECT count(*) AS count FROM quotas WHERE key=$1', [`account:${h.namespace}:${claims.iss}:${claims.sub}`])).toBe(0)
  })

  it('capability redemption survives real login rotation, while the anonymous cookie loses authority', async () => {
    const prepared = await h.prepare(alice, h.input(alice, await h.offer({ refundable: false })))
    const owner = await h.context()
    const redeemed = await owner.request.get(prepared.reviewUrl!, { maxRedirects: 0 })
    expect(redeemed.status()).toBe(303)
    const anonymous = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')!
    await h.rememberSession(owner)
    const page = await owner.newPage()
    try {
      await page.goto(`${PUBLIC_BASE}/review/${prepared.caseId}`)
      await completeLoginForm(page, 'alice')
      await page.getByRole('heading', { name: 'Review booking proposal', exact: true }).waitFor()
      const authenticated = (await owner.cookies(PUBLIC_BASE)).find((entry) => entry.name === 'hitl-session')!
      expect(authenticated.value).not.toBe(anonymous.value)
      await h.rememberSession(owner)
      const stale = await fetch(`${PUBLIC_BASE}/review/${prepared.caseId}`, { headers: { Cookie: `hitl-session=${anonymous.value}` }, redirect: 'manual' })
      expect(stale.status).toBe(404)
      expect(stale.headers.has('Set-Cookie')).toBe(false)
      await page.getByRole('button', { name: 'Confirm proposal', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Confirmation recorded.' }).waitFor()
      expect(await count('SELECT count(*) AS count FROM bookings WHERE operation_id=$1', [prepared.operation.operation_id])).toBe(0)
    } finally { await page.close() }
  }, 30000)
})
