import { randomUUID, createHash } from 'node:crypto'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from 'jose'
import { z } from 'zod'
import { AgentAccessError } from './errors.js'

const PublicProofKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string(), y: z.string() }).passthrough()
const ProofSchema = z.object({
  jti: z.string().min(1).max(256), htm: z.string(), htu: z.url(),
  iat: z.int().positive(), ath: z.string(), nonce: z.string().min(1).max(256).optional(),
}).passthrough()
export interface DPoPKeyPair { publicKey: CryptoKey; privateKey: CryptoKey }
export async function generateDPoPKey(): Promise<DPoPKeyPair> { return generateKeyPair('ES256', { extractable: true }) }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('base64url') }
/** RFC 9449 deliberately excludes query and fragment from htu. */
export function normalizeDPoPUrl(value: string): string {
  const url = new URL(value)
  url.search = ''; url.hash = ''
  return url.href
}
export interface CreateDPoPProofOptions {
  url: string; method: string; key: CryptoKey | DPoPKeyPair; accessToken?: string
  nonce?: string; now?: Date; jti?: string
}
export async function createDPoPProof(options: CreateDPoPProofOptions): Promise<string> {
  const pair = 'privateKey' in options.key ? options.key : undefined
  const privateKey = pair?.privateKey ?? options.key as CryptoKey
  const exported = await exportJWK(pair?.publicKey ?? privateKey)
  // Exporting an extractable private key is supported for CLI callers; never transmit its private component.
  const publicKey: JWK = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y }
  return new SignJWT({ htm: options.method.toUpperCase(), htu: normalizeDPoPUrl(options.url),
    ...(options.accessToken ? { ath: tokenHash(options.accessToken) } : {}),
    ...(options.nonce ? { nonce: options.nonce } : {}) })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicKey })
    .setIssuedAt(Math.floor((options.now ?? new Date()).getTime() / 1000))
    .setJti(options.jti ?? randomUUID()).sign(privateKey)
}
export interface ValidatedDPoP { jkt: string; jti: string; nonce?: string; iat: number; expiresAt: Date }
export async function verifyDPoPProof(request: Request, accessToken: string, expectedJkt: string,
  now = new Date(), windowSeconds = 60): Promise<ValidatedDPoP> {
  const encoded = request.headers.get('DPoP')
  if (!encoded || encoded.length > 8192) throw new AgentAccessError('invalid_dpop', 401)
  try {
    const { payload } = await jwtVerify(encoded, async (header) => {
      if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') throw new Error('Invalid DPoP header')
      const jwk = PublicProofKeySchema.parse(header.jwk)
      if ('d' in jwk || 'p' in jwk || 'q' in jwk || 'k' in jwk) throw new Error('Private JWK forbidden')
      if (await calculateJwkThumbprint(jwk, 'sha256') !== expectedJkt) throw new Error('Key mismatch')
      return importJWK(jwk, 'ES256')
    }, { algorithms: ['ES256'], typ: 'dpop+jwt', currentDate: now })
    const proof = ProofSchema.parse(payload)
    const nowSeconds = Math.floor(now.getTime() / 1000)
    // The acceptance deadline and replay-retention deadline are identical and exclusive.
    const expiresAt = new Date(Math.min(proof.iat + windowSeconds + 30,
      typeof payload.exp === 'number' ? payload.exp : Infinity) * 1000)
    if (now >= expiresAt || proof.iat > nowSeconds + 30
      || proof.htm !== request.method || normalizeDPoPUrl(proof.htu) !== normalizeDPoPUrl(request.url)
      || proof.ath !== tokenHash(accessToken)) throw new Error('Invalid DPoP claims')
    return { jkt: expectedJkt, jti: proof.jti, iat: proof.iat, expiresAt, ...(proof.nonce ? { nonce: proof.nonce } : {}) }
  } catch { throw new AgentAccessError('invalid_dpop', 401) }
}
