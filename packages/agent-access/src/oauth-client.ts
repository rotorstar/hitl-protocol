import * as oauth from 'oauth4webapi'
import { calculateJwkThumbprint, createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { BrowserIdentitySchema, type BrowserIdentity } from './contracts.js'
import { requireTrustedEndpoint } from './keycloak.js'
import { createDPoPProof, type DPoPKeyPair } from './dpop.js'

export interface OAuthClientConfig {
  issuer: string; clientId: string; redirectUri: string; clientSecret?: string
  fetch?: typeof fetch; allowInsecureLocalhost?: boolean
}
export interface AuthorizationAttempt {
  authorizationUrl: string; state: string; nonce: string; codeVerifier: string
}
function requestOptions(config: OAuthClientConfig) {
  requireTrustedEndpoint(config.issuer, config.allowInsecureLocalhost)
  requireTrustedEndpoint(config.redirectUri, config.allowInsecureLocalhost)
  return { [oauth.customFetch]: config.fetch ?? fetch, [oauth.allowInsecureRequests]: config.allowInsecureLocalhost ?? false,
    signal: AbortSignal.timeout(2000) }
}
async function serverMetadata(config: OAuthClientConfig): Promise<oauth.AuthorizationServer> {
  const response = await oauth.discoveryRequest(new URL(config.issuer), requestOptions(config))
  const metadata = await oauth.processDiscoveryResponse(new URL(config.issuer), response)
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!endpoint) throw new Error('Authorization server metadata incomplete')
    requireTrustedEndpoint(endpoint, config.allowInsecureLocalhost)
  }
  return metadata
}
export async function createAuthorizationRequest(config: OAuthClientConfig, options: {
  scopes?: readonly string[]; dpopKey?: DPoPKeyPair; freshLogin?: boolean
} = {}): Promise<AuthorizationAttempt> {
  const server = await serverMetadata(config)
  const codeVerifier = oauth.generateRandomCodeVerifier()
  const state = oauth.generateRandomState()
  const nonce = oauth.generateRandomNonce()
  const url = new URL(server.authorization_endpoint!)
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: ['openid', ...(options.scopes ?? ['profile'])].join(' '),
    code_challenge: await oauth.calculatePKCECodeChallenge(codeVerifier), code_challenge_method: 'S256',
    state, nonce, max_age: '300', ...(options.freshLogin ? { prompt: 'login' } : {}) }).toString()
  if (options.dpopKey) url.searchParams.set('dpop_jkt', await calculateJwkThumbprint(await crypto.subtle.exportKey('jwk', options.dpopKey.publicKey)))
  return { authorizationUrl: url.href, state, nonce, codeVerifier }
}
export interface AuthorizationCallback {
  callbackUrl: string; state: string; nonce: string; codeVerifier: string
}
export async function exchangeAuthorizationCode(config: OAuthClientConfig, callback: AuthorizationCallback,
  dpopKey?: DPoPKeyPair): Promise<oauth.TokenEndpointResponse> {
  const server = await serverMetadata(config)
  const client: oauth.Client = { client_id: config.clientId }
  const callbackUrl = new URL(callback.callbackUrl)
  const redirect = new URL(config.redirectUri)
  if (callbackUrl.origin !== redirect.origin || callbackUrl.pathname !== redirect.pathname)
    throw new Error('Unexpected OAuth callback URL')
  const parameters = oauth.validateAuthResponse(server, client, callbackUrl, callback.state)
  const DPoP = dpopKey ? oauth.DPoP(client, dpopKey) : undefined
  const authenticate = config.clientSecret ? oauth.ClientSecretBasic(config.clientSecret) : oauth.None()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await oauth.authorizationCodeGrantRequest(server, client, authenticate, parameters,
        config.redirectUri, callback.codeVerifier, { ...requestOptions(config), ...(DPoP ? { DPoP } : {}) })
      const tokens = await oauth.processAuthorizationCodeResponse(server, client, response,
        { expectedNonce: callback.nonce, maxAge: 300, requireIdToken: true })
      if (dpopKey && tokens.token_type.toLowerCase() !== 'dpop') throw new Error('Server did not issue DPoP tokens')
      // Explicit signature validation in addition to oauth4webapi's claim/nonce/auth_time checks.
      await jwtVerify(tokens.id_token!, createRemoteJWKSet(new URL(server.jwks_uri!),
        { timeoutDuration: 2000, [customFetch]: config.fetch ?? fetch }),
      { issuer: config.issuer, audience: config.clientId, algorithms: ['RS256', 'PS256', 'ES256'] })
      return tokens
    } catch (error) {
      if (attempt === 0 && DPoP && oauth.isDPoPNonceError(error)) continue
      throw error
    }
  }
  throw new Error('OAuth exchange failed')
}
export async function completeBrowserLogin(config: OAuthClientConfig, callback: AuthorizationCallback): Promise<BrowserIdentity> {
  const tokens = await exchangeAuthorizationCode(config, callback)
  const claims = oauth.getValidatedIdTokenClaims(tokens)
  if (!claims || typeof claims.auth_time !== 'number') throw new Error('Missing verified browser identity')
  return BrowserIdentitySchema.parse({ iss: claims.iss, sub: claims.sub, auth_time: claims.auth_time,
    ...(typeof claims.name === 'string' ? { display_name: claims.name } : {}),
    ...(claims.email_verified === true && typeof claims.email === 'string' ? { verified_email: claims.email } : {}) })
}
export async function refreshDPoPTokens(config: OAuthClientConfig, options: {
  refreshToken: string; key: DPoPKeyPair
}): Promise<oauth.TokenEndpointResponse> {
  const server = await serverMetadata(config)
  const client: oauth.Client = { client_id: config.clientId }
  const DPoP = oauth.DPoP(client, options.key)
  const authenticate = config.clientSecret ? oauth.ClientSecretBasic(config.clientSecret) : oauth.None()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await oauth.refreshTokenGrantRequest(server, client, authenticate, options.refreshToken,
        { ...requestOptions(config), DPoP })
      const tokens = await oauth.processRefreshTokenResponse(server, client, response)
      if (tokens.token_type.toLowerCase() !== 'dpop') throw new Error('Refresh lost DPoP binding')
      return tokens
    } catch (error) {
      if (attempt === 0 && oauth.isDPoPNonceError(error)) continue
      throw error
    }
  }
  throw new Error('Token refresh failed')
}
/** Fresh proof for every attempt; RS nonces are independent from AS token-endpoint nonces. */
export async function authenticatedAgentFetch(url: string, options: {
  accessToken: string; key: DPoPKeyPair; method?: string; body?: string
  headers?: HeadersInit; fetch?: typeof fetch
}): Promise<Response> {
  const fetcher = options.fetch ?? fetch
  const method = options.method ?? 'GET'
  let nonce: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `DPoP ${options.accessToken}`)
    headers.set('DPoP', await createDPoPProof({ url, method, key: options.key, accessToken: options.accessToken, ...(nonce ? { nonce } : {}) }))
    const response = await fetcher(url, { method, headers, body: options.body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const challenge = response.headers.get('DPoP-Nonce')
    if (attempt === 0 && response.status === 401 && challenge) { nonce = challenge; await response.body?.cancel(); continue }
    return response
  }
  throw new Error('DPoP request failed')
}
