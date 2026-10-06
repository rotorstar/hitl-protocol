import { beforeAll, describe, expect, it, vi } from 'vitest'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { KeycloakAuthenticator } from '../keycloak.js'
import { createDPoPProof, generateDPoPKey, type DPoPKeyPair } from '../dpop.js'
import { TestProofStore } from './proof-store.js'
const issuer = 'https://auth.example/realms/reference'
const audience = 'https://service.example'
const now = new Date('2026-10-06T10:00:00Z')
const seconds = Math.floor(now.getTime() / 1000)
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>
let agentKey: DPoPKeyPair
let jkt: string
beforeAll(async () => {
  signingKey = await generateKeyPair('RS256', { extractable: true })
  agentKey = await generateDPoPKey()
  jkt = await calculateJwkThumbprint(await exportJWK(agentKey.publicKey))
})
async function setup(options: { inactive?: boolean; unavailable?: boolean; delayMs?: number; expiry?: number; wrongClient?: boolean;
  introspectionResponse?: () => Response; jwksDelayMs?: number } = {}) {
  let clock = now
  const store = new TestProofStore(() => clock)
  await store.saveNonce({ jkt, nonce: 'resource-server-nonce', expiresAt: new Date(now.getTime() + 60_000) })
  const token = await new SignJWT({ azp: 'agent', scope: 'bookings:read bookings:commit', typ: 'DPoP', cnf: { jkt, 'kc-jkt-type': 'DPoP' } })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'key1' }).setIssuer(issuer).setAudience(audience)
    .setSubject('user1').setIssuedAt(seconds).setExpirationTime(options.expiry ?? seconds + 300).sign(signingKey.privateKey)
  let introspections = 0
  const fetcher: typeof fetch = async (url) => {
    if (String(url).endsWith('/certs')) {
      clock = new Date(clock.getTime() + (options.jwksDelayMs ?? 0))
      return Response.json({ keys: [{ ...await exportJWK(signingKey.publicKey), kid: 'key1' }] })
    }
    introspections++
    if (options.unavailable) return new Response('Unavailable', { status: 503 })
    clock = new Date(clock.getTime() + (options.delayMs ?? 0))
    if (options.introspectionResponse) return options.introspectionResponse()
    return Response.json(options.inactive ? { active: false } : { active: true, iss: issuer, sub: 'user1', client_id: options.wrongClient ? 'other' : 'agent',
      exp: options.expiry ?? seconds + 300, aud: audience, scope: 'bookings:read', cnf: { jkt, 'kc-jkt-type': 'DPoP' } })
  }
  const authenticator = new KeycloakAuthenticator({ issuer, audience, introspectionClientId: 'resource', introspectionClientSecret: 'test-secret', fetch: fetcher }, store)
  async function request(proofOptions: { url?: string; method?: string; key?: DPoPKeyPair; accessToken?: string; nonce?: string; jti?: string; issuedAt?: Date } = {}) {
    const proof = await createDPoPProof({ url: proofOptions.url ?? `${audience}/v1/bookings/prepare`, method: proofOptions.method ?? 'POST',
      key: proofOptions.key ?? agentKey, accessToken: proofOptions.accessToken ?? token,
      nonce: proofOptions.nonce ?? 'resource-server-nonce', now: proofOptions.issuedAt ?? now, ...(proofOptions.jti ? { jti: proofOptions.jti } : {}) })
    return new Request(`${audience}/v1/bookings/prepare`, { method: 'POST', headers: { Authorization: `DPoP ${token}`, DPoP: proof } })
  }
  return { authenticator, request, token, store, introspections: () => introspections, setClock: (value: Date) => { clock = value } }
}
describe('Keycloak facts, DPoP and live introspection', () => {
  it('accepts verified Keycloak cnf extensions and starts freshness before introspection latency', async () => {
    const ctx = await setup({ delayMs: 1500 })
    const facts = await ctx.authenticator.authenticate(await ctx.request())
    expect(facts).toMatchObject({ iss: issuer, sub: 'user1', client_id: 'agent', jkt, scopes: ['bookings:read'], observed_at: now.toISOString() })
    await ctx.authenticator.authenticate(await ctx.request())
    expect(ctx.introspections()).toBe(2)
  })
  it('challenges a signed proof lacking a recognized RS nonce before using authority', async () => {
    const ctx = await setup()
    await expect(ctx.authenticator.authenticate(await ctx.request({ nonce: 'unknown' }))).rejects.toMatchObject({ code: 'use_dpop_nonce', status: 401, headers: { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' } })
    expect(ctx.introspections()).toBe(0)
  })
  it('accepts a proof once and rejects concurrent duplicate proofs', async () => {
    const ctx = await setup()
    const request = await ctx.request({ jti: 'the-same-request' })
    const outcomes = await Promise.allSettled([ctx.authenticator.authenticate(request), ctx.authenticator.authenticate(request)])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('proof_replayed')
  })
  it.each([{ method: 'GET' }, { url: `${audience}/v1/other` }, { accessToken: 'stolen-other-token' }])('rejects mismatched method/target/token: %j', async (options) => {
    const ctx = await setup()
    await expect(ctx.authenticator.authenticate(await ctx.request(options))).rejects.toMatchObject({ code: 'invalid_dpop' })
  })
  it('rejects another installation key and Bearer fallback', async () => {
    const ctx = await setup()
    await expect(ctx.authenticator.authenticate(await ctx.request({ key: await generateDPoPKey() }))).rejects.toMatchObject({ code: 'invalid_dpop' })
    const request = await ctx.request()
    request.headers.set('Authorization', `Bearer ${ctx.token}`)
    await expect(ctx.authenticator.authenticate(request)).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it('rejects revocation and caller identity mismatch', async () => {
    for (const options of [{ inactive: true }, { wrongClient: true }]) {
      const ctx = await setup(options)
      await expect(ctx.authenticator.authenticate(await ctx.request())).rejects.toMatchObject({ code: 'invalid_token' })
    }
  })
  it('fails closed on AS outage and checks expiration again after network latency', async () => {
    const outage = await setup({ unavailable: true })
    await expect(outage.authenticator.authenticate(await outage.request())).rejects.toMatchObject({ code: 'authorization_server_unavailable', status: 503 })
    const expiring = await setup({ expiry: seconds + 1, delayMs: 1500 })
    await expect(expiring.authenticator.authenticate(await expiring.request())).rejects.toMatchObject({ code: 'invalid_token' })
  })
  it('reports persistent nonce/replay store failures as unavailable', async () => {
    const ctx = await setup()
    ctx.store.consumeReplay = async () => { throw new Error('Database unavailable') }
    await expect(ctx.authenticator.authenticate(await ctx.request())).rejects.toMatchObject({ code: 'proof_store_unavailable', status: 503 })
  })
  it('rejects replay at the exact exclusive deadline after replay cleanup', async () => {
    const ctx = await setup()
    const issuedAt = new Date(now.getTime() - 89_000)
    const request = await ctx.request({ issuedAt })
    await ctx.authenticator.authenticate(request)
    await expect(ctx.authenticator.authenticate(request)).rejects.toMatchObject({ code: 'proof_replayed' })
    ctx.setClock(new Date(now.getTime() + 1000))
    ctx.store.replay.clear() // Cleanup may now delete every row for this expired proof.
    await expect(ctx.authenticator.authenticate(request)).rejects.toMatchObject({ code: 'invalid_dpop' })
    expect(ctx.introspections()).toBe(1)
  })
  it('checks proof age after a delayed signing-key fetch', async () => {
    const ctx = await setup({ jwksDelayMs: 1000 })
    await expect(ctx.authenticator.authenticate(await ctx.request({ issuedAt: new Date(now.getTime() - 89_000) })))
      .rejects.toMatchObject({ code: 'invalid_dpop' })
    expect(ctx.introspections()).toBe(0)
  })
  it('rejects proofs that expire while replay persistence is awaiting the database', async () => {
    const ctx = await setup()
    const consume = ctx.store.consumeReplay.bind(ctx.store)
    ctx.store.consumeReplay = async (record) => {
      ctx.setClock(new Date(now.getTime() + 1000))
      return consume(record)
    }
    await expect(ctx.authenticator.authenticate(await ctx.request({ issuedAt: new Date(now.getTime() - 89_000) })))
      .rejects.toMatchObject({ code: 'invalid_dpop' })
    expect(ctx.introspections()).toBe(0)
  })
  it('rejects proof expiry during introspection rather than granting stale authority', async () => {
    const ctx = await setup({ delayMs: 1000 })
    await expect(ctx.authenticator.authenticate(await ctx.request({ issuedAt: new Date(now.getTime() - 89_000) })))
      .rejects.toMatchObject({ code: 'invalid_dpop' })
  })
  it('uses the persistence clock even when the worker clock is ahead', async () => {
    vi.useFakeTimers({ now: new Date(now.getTime() + 120_000) })
    try {
      const ctx = await setup({ delayMs: 1500 })
      expect((await ctx.authenticator.authenticate(await ctx.request())).observed_at).toBe(now.toISOString())
    } finally { vi.useRealTimers() }
  })
  it('fails closed when the authoritative clock cannot be read', async () => {
    const ctx = await setup()
    ctx.store.now = async () => { throw new Error('Database unavailable') }
    await expect(ctx.authenticator.authenticate(await ctx.request())).rejects.toMatchObject({ code: 'proof_store_unavailable', status: 503 })
  })
  it('cancels an oversized chunked introspection body before reading the remaining chunks', async () => {
    let chunks = 0
    const cancelled = vi.fn()
    const ctx = await setup({ introspectionResponse: () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(chunks === 1 ? 65_536 : 1)) },
      cancel: cancelled,
    }, { highWaterMark: 0 })) })
    await expect(ctx.authenticator.authenticate(await ctx.request())).rejects.toMatchObject({ code: 'authorization_server_unavailable', status: 503 })
    expect(chunks).toBe(2)
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
