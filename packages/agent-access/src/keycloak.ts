import { randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, customFetch, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { AgentFactsSchema, type AgentFacts } from './contracts.js'
import { AgentAccessError } from './errors.js'
import { verifyDPoPProof } from './dpop.js'
import type { PersistentProofStore } from './proof-store.js'

const ClaimsSchema = z.object({
  iss: z.string(), sub: z.string().min(1), azp: z.string().min(1), exp: z.int().positive(),
  scope: z.string().default(''), cnf: z.object({ jkt: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).passthrough(),
}).passthrough()
const IntrospectionSchema = z.object({
  active: z.literal(true), iss: z.string(), sub: z.string().min(1), client_id: z.string().min(1),
  exp: z.int().positive(), aud: z.union([z.string(), z.array(z.string())]),
  scope: z.string().default(''), cnf: z.object({ jkt: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).passthrough(),
}).passthrough()
export interface KeycloakAuthConfig {
  issuer: string; audience: string; introspectionClientId: string; introspectionClientSecret: string
  jwksUrl?: string; introspectionUrl?: string; fetch?: typeof fetch
  /** Test override only; must use the persistence/cleanup clock domain. */
  now?: () => Date
  allowInsecureLocalhost?: boolean
}
export function requireTrustedEndpoint(value: string, allowInsecureLocalhost = false): URL {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowInsecureLocalhost && local && url.protocol === 'http:')))
    throw new TypeError('Authentication endpoints require HTTPS, except explicitly enabled loopback development')
  return url
}
function splitScopes(value: string): string[] { return [...new Set(value.split(/\s+/).filter(Boolean))] }
async function proofStoreOperation<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch { throw new AgentAccessError('proof_store_unavailable', 503) }
}
async function boundedIntrospectionJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Missing introspection response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 65_536) {
        await reader.cancel('Introspection response oversized')
        throw new Error('Introspection response oversized')
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
}
export class KeycloakAuthenticator {
  private readonly fetcher: typeof fetch
  private readonly now: () => Promise<Date>
  private readonly jwks: JWTVerifyGetKey
  private readonly introspectionUrl: URL
  constructor(private readonly config: KeycloakAuthConfig, private readonly store: PersistentProofStore) {
    const issuer = requireTrustedEndpoint(config.issuer, config.allowInsecureLocalhost)
    if (issuer.search || issuer.href.endsWith('/')) throw new TypeError('Issuer must have no query or trailing slash')
    this.fetcher = config.fetch ?? fetch
    this.now = () => proofStoreOperation(async () => config.now ? config.now() : this.store.now())
    const jwksUrl = requireTrustedEndpoint(config.jwksUrl ?? `${config.issuer}/protocol/openid-connect/certs`, config.allowInsecureLocalhost)
    this.introspectionUrl = requireTrustedEndpoint(config.introspectionUrl ?? `${config.issuer}/protocol/openid-connect/token/introspect`, config.allowInsecureLocalhost)
    // Endpoints are deployment configuration, never selected from a token or request.
    this.jwks = createRemoteJWKSet(jwksUrl, { timeoutDuration: 2000, cacheMaxAge: 300_000, [customFetch]: this.fetcher })
  }
  async authenticate(request: Request): Promise<AgentFacts> {
    const authorization = request.headers.get('Authorization')
    const match = /^DPoP ([A-Za-z0-9_.-]+)$/i.exec(authorization ?? '')
    const token = match?.[1]
    if (!token || token.length > 16_384) throw new AgentAccessError('unauthorized', 401, { 'WWW-Authenticate': 'DPoP' })
    const now = await this.now()
    let claims: z.infer<typeof ClaimsSchema>
    try {
      const verified = await jwtVerify(token, this.jwks, { issuer: this.config.issuer, audience: this.config.audience,
        algorithms: ['RS256', 'PS256', 'ES256'], currentDate: now, requiredClaims: ['exp', 'iss', 'sub'] })
      if (verified.protectedHeader.typ !== 'JWT' && verified.protectedHeader.typ !== 'at+jwt') throw new Error('Invalid token type')
      claims = ClaimsSchema.parse(verified.payload)
    } catch (error) {
      if (error instanceof Error && ('code' in error && error.code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError))
        throw new AgentAccessError('authorization_server_unavailable', 503)
      throw new AgentAccessError('invalid_token', 401)
    }
    const proof = await verifyDPoPProof(request, token, claims.cnf.jkt, await this.now())
    const proofTime = await this.now()
    if (proofTime >= proof.expiresAt) throw new AgentAccessError('invalid_dpop', 401)
    if (claims.exp * 1000 <= proofTime.getTime()) throw new AgentAccessError('invalid_token', 401)
    if (!proof.nonce || !await proofStoreOperation(() => this.store.hasNonce({ jkt: proof.jkt, nonce: proof.nonce!, now: proofTime }))) {
      const nonce = randomBytes(32).toString('base64url')
      await proofStoreOperation(() => this.store.saveNonce({ jkt: proof.jkt, nonce, expiresAt: new Date(proofTime.getTime() + 60_000) }))
      throw new AgentAccessError('use_dpop_nonce', 401, { 'DPoP-Nonce': nonce, 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' })
    }
    if (!await proofStoreOperation(() => this.store.consumeReplay({ namespace: 'dpop', key: proof.jkt, id: proof.jti, now: proofTime,
      expiresAt: proof.expiresAt })))
      throw new AgentAccessError('proof_replayed', 401)

    // Start the freshness budget before the network request, using the same clock as commit/cleanup.
    const observedAt = await this.now()
    if (observedAt >= proof.expiresAt) throw new AgentAccessError('invalid_dpop', 401)
    if (claims.exp * 1000 <= observedAt.getTime()) throw new AgentAccessError('invalid_token', 401)
    let raw: unknown
    try {
      const response = await this.fetcher(this.introspectionUrl, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(this.config.introspectionClientId)}:${encodeURIComponent(this.config.introspectionClientSecret)}`).toString('base64')}` },
        body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
      })
      if (!response.ok) throw new Error('Introspection unavailable')
      raw = await boundedIntrospectionJson(response)
    } catch { throw new AgentAccessError('authorization_server_unavailable', 503) }
    const current = IntrospectionSchema.safeParse(raw)
    if (!current.success) throw new AgentAccessError('invalid_token', 401)
    const facts = current.data
    const completedAt = await this.now()
    if (completedAt >= proof.expiresAt) throw new AgentAccessError('invalid_dpop', 401)
    const audiences = Array.isArray(facts.aud) ? facts.aud : [facts.aud]
    if (facts.iss !== this.config.issuer || facts.sub !== claims.sub || facts.client_id !== claims.azp
      || facts.cnf.jkt !== claims.cnf.jkt || !audiences.includes(this.config.audience)
      || Math.min(claims.exp, facts.exp) * 1000 <= completedAt.getTime()) throw new AgentAccessError('invalid_token', 401)
    const currentlyAllowed = new Set(splitScopes(facts.scope))
    return AgentFactsSchema.parse({ iss: facts.iss, sub: facts.sub, client_id: facts.client_id, jkt: facts.cnf.jkt,
      scopes: splitScopes(claims.scope).filter((scope) => currentlyAllowed.has(scope)),
      exp: Math.min(claims.exp, facts.exp), observed_at: observedAt.toISOString() })
  }
}
