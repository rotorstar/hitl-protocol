// This interoperability client intentionally imports no repository SDK, types or schemas.
// Its only protocol library is jose; all URLs, scopes and endpoint contracts come from discovery/OpenAPI.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { SignJWT, calculateJwkThumbprint, createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose'
import type { Page } from '@playwright/test'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  return value as Record<string, unknown>
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected a string'); return value }
// The versioned profile IDs in HITL discovery are distinct from the OpenAPI
// operation binding enum published by this profile.
const SUPPORTED = new Set(['public-web', 'delegated-api', 'browser'])
export function requireSupportedBindings(document: unknown): void {
  const paths = object(object(document).paths)
  for (const path of Object.values(paths)) for (const operation of Object.values(object(path))) {
    if (!operation || typeof operation !== 'object') continue
    const binding = object(operation)['x-hitl-agent-access-binding']
    if (binding !== undefined && !SUPPORTED.has(string(binding))) throw new Error('Unsupported required binding')
  }
}
export class IndependentClient {
  private token = ''
  private rsNonce: string | undefined
  private asNonce: string | undefined
  private constructor(readonly base: string, readonly metadata: Record<string, unknown>, readonly resource: Record<string, unknown>,
    private readonly privateKey: CryptoKey, private readonly publicJwk: JWK) {}
  static async discover(base: string): Promise<IndependentClient> {
    const discovery = object(await (await fetch(`${base}/.well-known/hitl.json`)).json())
    const hitl = object(discovery.hitl_protocol)
    if (hitl.spec_version !== '0.9') throw new Error('Unsupported HITL version')
    const auth = object(hitl.authentication)
    if (!Array.isArray(auth.profiles) || !auth.profiles.includes('hitl-agent-access-delegated-api/0.1')) throw new Error('Required delegated binding unavailable')
    const resource = object(await (await fetch(string(auth.well_known))).json())
    if (resource.resource !== base || resource.dpop_bound_access_tokens_required !== true) throw new Error('Resource metadata mismatch')
    if (!Array.isArray(resource.authorization_servers) || resource.authorization_servers.length !== 1) throw new Error('Ambiguous provider')
    const issuer = string(resource.authorization_servers[0])
    const metadata = object(await (await fetch(`${issuer}/.well-known/openid-configuration`)).json())
    if (metadata.issuer !== issuer) throw new Error('Issuer mismatch')
    const openapi = await (await fetch(string(object(hitl.examples).openapi))).json()
    requireSupportedBindings(openapi)
    const pair = await generateKeyPair('ES256', { extractable: true })
    return new IndependentClient(base, metadata, resource, pair.privateKey, await exportJWK(pair.publicKey))
  }
  private proof(url: string, method: string, token?: string, nonce?: string): Promise<string> {
    const target = new URL(url); target.search = ''; target.hash = ''
    return new SignJWT({ htm: method, htu: target.href, ...(token ? { ath: createHash('sha256').update(token).digest('base64url') } : {}), ...(nonce ? { nonce } : {}) })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: this.publicJwk }).setJti(randomUUID()).setIssuedAt().sign(this.privateKey)
  }
  async login(page: Page, user: 'alice' | 'bob'): Promise<void> {
    const state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url'), verifier = randomBytes(32).toString('base64url')
    const redirect = 'http://127.0.0.1:8899/callback'
    const scopes = this.resource.scopes_supported
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) throw new Error('Missing published scopes')
    const auth = new URL(string(this.metadata.authorization_endpoint))
    auth.search = new URLSearchParams({ client_id: 'hitl-agent', redirect_uri: redirect, response_type: 'code', scope: ['openid', 'profile', ...scopes].join(' '),
      state, nonce, max_age: '300', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', dpop_jkt: await calculateJwkThumbprint(this.publicJwk) }).toString()
    let delivered: ((url: string) => void) | undefined
    let callbackTimer: ReturnType<typeof setTimeout> | undefined
    const callback = new Promise<string>((resolve, reject) => {
      callbackTimer = setTimeout(() => reject(new Error('Independent OAuth callback timed out')), 30000)
      delivered = (url) => { clearTimeout(callbackTimer); resolve(url) }
    })
    void callback.catch(() => undefined)
    const callbackServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirect)
      if (request.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
        response.writeHead(400); response.end('Invalid callback'); return
      }
      response.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' })
      response.end('<title>Independent OAuth callback</title>')
      delivered!(url.href)
    })
    callbackServer.listen(8899, '127.0.0.1')
    await once(callbackServer, 'listening')
    let returned: URL
    try {
      await page.goto(auth.href)
      await page.locator('#username').fill(user); await page.locator('#password').fill(`${user}-local-eval`); await page.locator('#kc-login').click()
      returned = new URL(await callback)
    } catch (cause) {
      const location = new URL(page.url()); location.search = ''; location.hash = ''
      throw new Error(`Independent OAuth failed at ${location.href}: ${(await page.locator('body').innerText()).slice(0, 600)}`, { cause })
    } finally {
      clearTimeout(callbackTimer)
      await new Promise<void>((resolve, reject) => callbackServer.close((error) => error ? reject(error) : resolve()))
    }
    if (returned.origin !== new URL(redirect).origin || returned.pathname !== '/callback' || returned.searchParams.get('state') !== state || returned.searchParams.has('error')) throw new Error('Invalid callback')
    const endpoint = string(this.metadata.token_endpoint)
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: await this.proof(endpoint, 'POST', undefined, this.asNonce) },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'hitl-agent', redirect_uri: redirect, code: string(returned.searchParams.get('code')), code_verifier: verifier }) })
      const body = object(await response.json())
      if (response.status === 400 && body.error === 'use_dpop_nonce' && attempt === 0) { this.asNonce = string(response.headers.get('DPoP-Nonce')); continue }
      if (!response.ok || string(body.token_type).toLowerCase() !== 'dpop') throw new Error('Authorization exchange failed')
      const { payload } = await jwtVerify(string(body.id_token), createRemoteJWKSet(new URL(string(this.metadata.jwks_uri))), { issuer: string(this.metadata.issuer), audience: 'hitl-agent', algorithms: ['RS256', 'PS256', 'ES256'] })
      if (payload.nonce !== nonce || typeof payload.auth_time !== 'number' || Date.now() / 1000 - payload.auth_time > 300) throw new Error('Invalid ID token authentication')
      this.token = string(body.access_token)
      return
    }
    throw new Error('Authorization nonce retry exhausted')
  }
  async request(path: string, method = 'GET', body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = new URL(path, this.base).href
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = { Authorization: `DPoP ${this.token}`, DPoP: await this.proof(url, method, this.token, this.rsNonce) }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      const response = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
      if (response.status === 401 && response.headers.has('DPoP-Nonce') && attempt === 0) { this.rsNonce = string(response.headers.get('DPoP-Nonce')); await response.body?.cancel(); continue }
      return { status: response.status, body: object(await response.json()) }
    }
    throw new Error('Resource nonce retry exhausted')
  }
}
