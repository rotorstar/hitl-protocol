import { describe, expect, it, vi } from 'vitest'
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose'
import { PublicWebVerifier, SafeDirectoryResolver, signPublicWebRequest, isPublicAddress, directoryUrl, DIRECTORY_MEDIA_TYPE } from '../public-web.js'
import { TestProofStore } from './proof-store.js'
const now = new Date('2026-10-06T10:00:00Z')
async function setup() {
  const key = await generateKeyPair('EdDSA', { extractable: true })
  const jwk = await exportJWK(key.publicKey)
  const kid = await calculateJwkThumbprint(jwk)
  const transport = vi.fn(async () => ({ body: JSON.stringify({ keys: [{ ...jwk, kid }] }), contentType: DIRECTORY_MEDIA_TYPE }))
  const resolver = new SafeDirectoryResolver({ now: () => now, transport })
  const store = new TestProofStore(() => now)
  const verifier = new PublicWebVerifier(resolver, store)
  const signed = () => signPublicWebRequest(new Request('https://service.example/v1/catalog?sort=price'),
    { agentOrigin: 'https://agent.example', ...key, now })
  return { key, kid, transport, resolver, verifier, signed, store }
}
describe('public read binding', () => {
  it('distinguishes anonymous from URL/key verified agent and detects replay', async () => {
    const ctx = await setup()
    expect(await ctx.verifier.verify(new Request('https://service.example/v1/catalog'))).toEqual({ status: 'anonymous' })
    const signed = await ctx.signed()
    expect(await ctx.verifier.verify(signed)).toMatchObject({ status: 'verified', identifier: 'https://agent.example/.well-known/http-message-signatures-directory', keyid: ctx.kid })
    expect(await ctx.verifier.verify(signed)).toEqual({ status: 'invalid', reason: 'proof_replayed' })
  })
  it('rejects query tampering and label substitution', async () => {
    const ctx = await setup()
    const signed = await ctx.signed()
    expect(await ctx.verifier.verify(new Request('https://service.example/v1/catalog?sort=other', { headers: signed.headers }))).toMatchObject({ status: 'invalid' })
    const changed = new Headers(signed.headers)
    changed.set('Signature-Agent', 'other="https://agent.example"')
    expect(await ctx.verifier.verify(new Request(signed, { headers: changed }))).toMatchObject({ status: 'invalid' })
  })
  it('does not grant verified identity when directory is unavailable', async () => {
    const ctx = await setup()
    const verifier = new PublicWebVerifier({ resolve: async () => { throw new Error('DNS failure') } }, new TestProofStore(), () => now)
    expect(await verifier.verify(await ctx.signed())).toEqual({ status: 'unverified', reason: 'directory_unavailable' })
  })
  it('coalesces same-origin fetches and rejects oversized or private-key directories', async () => {
    const ctx = await setup()
    await Promise.all([ctx.resolver.resolve('https://agent.example'), ctx.resolver.resolve('https://agent.example')])
    expect(ctx.transport).toHaveBeenCalledTimes(1)
    for (const body of ['x'.repeat(65_537), JSON.stringify({ keys: [await exportJWK(ctx.key.privateKey)] })]) {
      const invalid = new SafeDirectoryResolver({ transport: async () => ({ body, contentType: DIRECTORY_MEDIA_TYPE }) })
      await expect(invalid.resolve('https://agent.example')).rejects.toThrow()
    }
  })
  it('refreshes an unknown rotated key once and coalesces concurrent retries', async () => {
    const first = await generateKeyPair('EdDSA', { extractable: true })
    const second = await generateKeyPair('EdDSA', { extractable: true })
    const firstJwk = await exportJWK(first.publicKey)
    const secondJwk = await exportJWK(second.publicKey)
    let keys = [firstJwk]
    const transport = vi.fn(async () => ({ body: JSON.stringify({ keys }), contentType: DIRECTORY_MEDIA_TYPE }))
    const resolver = new SafeDirectoryResolver({ now: () => now, transport })
    await resolver.resolve('https://agent.example')
    keys = [firstJwk, secondJwk]
    const verifier = new PublicWebVerifier(resolver, new TestProofStore(), () => now)
    const signed = await Promise.all(Array.from({ length: 20 }, () => signPublicWebRequest(new Request('https://service.example/v1/catalog'),
      { agentOrigin: 'https://agent.example', ...second, now })))
    const results = await Promise.all(signed.map((request) => verifier.verify(request)))
    expect(results.every((result) => result.status === 'verified')).toBe(true)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('negative-caches failed resolution for 30 seconds', async () => {
    let currentTime = now
    const transport = vi.fn(async () => { throw new Error('Directory unavailable') })
    const resolver = new SafeDirectoryResolver({ now: () => currentTime, transport })
    await expect(resolver.resolve('https://agent.example')).rejects.toThrow()
    await expect(resolver.resolve('https://agent.example')).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(1)
    currentTime = new Date(now.getTime() + 30_001)
    await expect(resolver.resolve('https://agent.example')).rejects.toThrow()
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('reports persistence failure as unavailable, never as invalid cryptographic evidence', async () => {
    const ctx = await setup()
    const store = new TestProofStore()
    store.consumeReplay = async () => { throw new Error('Database unavailable') }
    const verifier = new PublicWebVerifier(ctx.resolver, store, () => now)
    await expect(verifier.verify(await ctx.signed())).rejects.toMatchObject({ code: 'proof_store_unavailable', status: 503 })
  })
  it('rejects the exact expiration boundary after replay cleanup', async () => {
    const ctx = await setup()
    let currentTime = new Date(now.getTime() + 89_999)
    const store = new TestProofStore(() => currentTime)
    const verifier = new PublicWebVerifier(ctx.resolver, store)
    const signed = await ctx.signed()
    expect(await verifier.verify(signed)).toMatchObject({ status: 'verified' })
    expect(await verifier.verify(signed)).toEqual({ status: 'invalid', reason: 'proof_replayed' })
    currentTime = new Date(now.getTime() + 90_000)
    store.replay.clear()
    expect(await verifier.verify(signed)).toEqual({ status: 'invalid', reason: 'invalid_signature' })
    expect(await verifier.verify(signed)).toEqual({ status: 'invalid', reason: 'invalid_signature' })
  })
  it('checks signature age after a slow directory fetch', async () => {
    const ctx = await setup()
    let currentTime = now
    const store = new TestProofStore(() => currentTime)
    const verifier = new PublicWebVerifier({ resolve: async (origin) => {
      const directory = await ctx.resolver.resolve(origin)
      currentTime = new Date(now.getTime() + 90_000)
      return directory
    } }, store)
    expect(await verifier.verify(await ctx.signed())).toEqual({ status: 'invalid', reason: 'invalid_signature' })
    expect(store.replay.size).toBe(0)
  })
  it('rejects expiration during replay persistence', async () => {
    const ctx = await setup()
    let currentTime = new Date(now.getTime() + 89_999)
    const store = new TestProofStore(() => currentTime)
    const consume = store.consumeReplay.bind(store)
    store.consumeReplay = async (record) => {
      currentTime = new Date(now.getTime() + 90_000)
      return consume(record)
    }
    const verifier = new PublicWebVerifier(ctx.resolver, store)
    expect(await verifier.verify(await ctx.signed())).toEqual({ status: 'invalid', reason: 'invalid_signature' })
  })
  it('rechecks the directory key expiration after cryptographic verification', async () => {
    const ctx = await setup()
    const directory = await ctx.resolver.resolve('https://agent.example')
    const keys = directory.keys.map((key) => ({ ...key, exp: now.getTime() / 1000 + 1 }))
    let reads = 0
    const store = new TestProofStore(() => new Date(now.getTime() + (reads++ === 0 ? 0 : 1000)))
    const verifier = new PublicWebVerifier({ resolve: async () => ({ ...directory, keys }) }, store)
    expect(await verifier.verify(await ctx.signed())).toEqual({ status: 'invalid', reason: 'invalid_signature' })
    expect(store.replay.size).toBe(0)
  })
  it('uses shared persistence time despite an independently skewed worker clock', async () => {
    vi.useFakeTimers({ now: new Date(now.getTime() + 120_000) })
    try {
      const ctx = await setup()
      expect(await ctx.verifier.verify(await ctx.signed())).toMatchObject({ status: 'verified', observed_at: now.toISOString() })
    } finally { vi.useRealTimers() }
  })
  it('reports failure to read the authoritative clock as unavailable', async () => {
    const ctx = await setup()
    ctx.store.now = async () => { throw new Error('Database unavailable') }
    await expect(ctx.verifier.verify(await ctx.signed())).rejects.toMatchObject({ code: 'proof_store_unavailable', status: 503 })
  })
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:8.8.8.8', '2001:db8::1', '2002::1'])('blocks unsafe address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })
  it('permits public IPs and rejects credential/path/query directory origins', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    for (const origin of ['http://agent.example', 'https://user:password@agent.example', 'https://agent.example/keys', 'https://agent.example?key=1'])
      expect(() => directoryUrl(origin)).toThrow()
  })
})
