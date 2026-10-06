import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createAuthorizationRequest, completeBrowserLogin, authenticatedAgentFetch } from '../oauth-client.js'
import { generateDPoPKey } from '../dpop.js'
const issuer = 'https://auth.example/realms/reference'
const clientId = 'browser-client'
const redirectUri = 'https://service.example/auth/callback'
describe('OAuth/OIDC client flow', () => {
  async function setup() {
    const key = await generateKeyPair('RS256', { extractable: true })
    let expectedNonce = ''
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`, token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`, response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'] })
      if (url.endsWith('/certs')) return Response.json({ keys: [{ ...await exportJWK(key.publicKey), kid: 'test-key' }] })
      expect(new URLSearchParams(String(init?.body)).get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
      const seconds = Math.floor(Date.now() / 1000)
      const idToken = await new SignJWT({ nonce: expectedNonce, auth_time: seconds, name: 'Test owner', email: 'owner@example.com', email_verified: false })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }).setIssuer(issuer).setSubject('owner1')
        .setAudience(clientId).setIssuedAt(seconds).setExpirationTime(seconds + 300).sign(key.privateKey)
      return Response.json({ access_token: 'unused-browser-token', token_type: 'Bearer', expires_in: 300, id_token: idToken })
    }
    const config = { issuer, clientId, redirectUri, clientSecret: 'secret', fetch: fetcher }
    const attempt = await createAuthorizationRequest(config, { freshLogin: true })
    expectedNonce = attempt.nonce
    return { config, attempt, setNonce: (nonce: string) => { expectedNonce = nonce } }
  }
  it('uses S256, fresh login, state and nonce then returns signed owner identity without unverified email', async () => {
    const ctx = await setup()
    const authUrl = new URL(ctx.attempt.authorizationUrl)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('prompt')).toBe('login')
    const callbackUrl = `${redirectUri}?code=one-time-code&state=${ctx.attempt.state}`
    expect(await completeBrowserLogin(ctx.config, { ...ctx.attempt, callbackUrl })).toMatchObject({ iss: issuer, sub: 'owner1', display_name: 'Test owner' })
    expect(await completeBrowserLogin(ctx.config, { ...ctx.attempt, callbackUrl })).not.toHaveProperty('verified_email')
  })
  it('rejects mismatched state and ID-token nonce', async () => {
    const ctx = await setup()
    await expect(completeBrowserLogin(ctx.config, { ...ctx.attempt, callbackUrl: `${redirectUri}?code=code&state=wrong` })).rejects.toThrow()
    ctx.setNonce('wrong-nonce')
    await expect(completeBrowserLogin(ctx.config, { ...ctx.attempt, callbackUrl: `${redirectUri}?code=code&state=${ctx.attempt.state}` })).rejects.toThrow()
  })
  it('never follows protected-resource redirects and uses a new proof after an RS nonce challenge', async () => {
    const proofs: string[] = []
    const fetcher: typeof fetch = async (_input, init) => {
      expect(init?.redirect).toBe('error')
      proofs.push(new Headers(init?.headers).get('DPoP')!)
      return proofs.length === 1 ? new Response(null, { status: 401, headers: { 'DPoP-Nonce': 'fresh-rs-nonce' } }) : Response.json({ ok: true })
    }
    const result = await authenticatedAgentFetch('https://service.example/v1/catalog', { accessToken: 'test-token', key: await generateDPoPKey(), fetch: fetcher })
    expect(result.status).toBe(200)
    expect(proofs).toHaveLength(2)
    expect(proofs[0]).not.toBe(proofs[1])
  })
})
