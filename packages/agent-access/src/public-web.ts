import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import { calculateJwkThumbprint, exportJWK, importJWK, type JWK } from 'jose'
import { appendSignature, component, createSignature, verifySignature, webcrypto, isSignatureError } from 'http-message-sig'
import { parseDictionary, serializeDictionary, Token } from 'structured-headers'
import { z } from 'zod'
import type { PersistentProofStore } from './proof-store.js'
import { AgentAccessError } from './errors.js'

const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory'
export const DIRECTORY_MEDIA_TYPE = 'application/http-message-signatures-directory+json'
const DIRECTORY_TIMEOUT_MS = 2000
const DIRECTORY_BYTES = 65_536
const MAX_DIRECTORY_KEYS = 32
const block = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) block.addSubnet(address, prefix, 'ipv4')
const ipv6Global = new BlockList()
ipv6Global.addSubnet('2000::', 3, 'ipv6')
block.addSubnet('2001::', 23, 'ipv6')
block.addSubnet('2001:db8::', 32, 'ipv6')
block.addSubnet('2002::', 16, 'ipv6')
/** Conservative global-address policy. IPv4-mapped and transition ranges are rejected. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !block.check(address, 'ipv4')
  if (family === 6) return ipv6Global.check(address, 'ipv6') && !block.check(address, 'ipv6')
  return false
}
const PublicKeySchema = z.object({
  kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kid: z.string().optional(), use: z.literal('sig').optional(), alg: z.enum(['ed25519', 'EdDSA']).optional(),
  key_ops: z.array(z.literal('verify')).optional(), nbf: z.int().optional(), exp: z.int().optional(),
}).passthrough()
const DirectorySchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_DIRECTORY_KEYS) })
export type DirectoryKey = JWK & Pick<z.infer<typeof PublicKeySchema>, 'nbf' | 'exp'>
export interface ResolvedDirectory { identifier: string; keys: readonly DirectoryKey[]; expiresAt: Date }
export interface DirectoryResolveOptions { refresh?: boolean }
export interface DirectoryResolver { resolve(origin: string, options?: DirectoryResolveOptions): Promise<ResolvedDirectory> }
export interface DirectoryTransportResult { body: string; contentType: string; maxAgeSeconds?: number }
/** Production uses this transport: one DNS answer is pinned to the actual TLS socket. */
export async function fetchPinnedDirectory(url: URL): Promise<DirectoryTransportResult> {
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || url.pathname !== DIRECTORY_PATH || (url.port && url.port !== '443') || isIP(hostname))
    throw new Error('Unsafe key directory URL')
  const deadline = AbortSignal.timeout(DIRECTORY_TIMEOUT_MS)
  const resolved = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { deadline.addEventListener('abort', () => reject(new Error('Directory timeout')), { once: true }) }),
  ])
  if (!resolved.length || resolved.some((record) => !isPublicAddress(record.address))) throw new Error('Unsafe DNS answer')
  const pinned = resolved[0]!
  return new Promise<DirectoryTransportResult>((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', signal: deadline, agent: false,
      headers: { Accept: DIRECTORY_MEDIA_TYPE, 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
    }, (response) => {
      if (response.statusCode !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(new Error('Directory response rejected')); return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > DIRECTORY_BYTES) {
          const error = new Error('Directory response oversized')
          reject(error)
          req.destroy(error)
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        const cache = /(?:^|,)\s*max-age=(\d+)(?:\s|,|$)/i.exec(response.headers['cache-control'] ?? '')
        resolve({ body: Buffer.concat(chunks).toString('utf8'), contentType: response.headers['content-type'] ?? '',
          ...(cache?.[1] ? { maxAgeSeconds: Number(cache[1]) } : {}) })
      })
    })
    req.on('error', reject)
    req.end()
  })
}
export function directoryUrl(origin: string): URL {
  const url = new URL(origin)
  // Draft directory members must contain an ASCII HTTPS origin, not a path or a credential.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || ![url.origin, `${url.origin}/`].includes(origin)) throw new Error('Not a directory origin')
  return new URL(DIRECTORY_PATH, url.origin)
}
export class SafeDirectoryResolver implements DirectoryResolver {
  private readonly cache = new Map<string, ResolvedDirectory>()
  private readonly pending = new Map<string, Promise<ResolvedDirectory>>()
  private readonly failures = new Map<string, Date>()
  private readonly forcedRefreshes = new Map<string, Date>()
  constructor(private readonly options: { now?: () => Date | Promise<Date>; transport?: (url: URL) => Promise<DirectoryTransportResult> } = {}) {}
  async resolve(origin: string, options: DirectoryResolveOptions = {}): Promise<ResolvedDirectory> {
    const url = directoryUrl(origin)
    const now = await (this.options.now ?? (() => new Date()))()
    const cached = this.cache.get(url.href)
    if (!options.refresh && cached && cached.expiresAt > now) return cached
    const underway = this.pending.get(url.href)
    if (underway) return underway
    const failedUntil = this.failures.get(url.href)
    if (failedUntil && failedUntil > now) throw new Error('Key directory unavailable')
    if (options.refresh) {
      const blockedUntil = this.forcedRefreshes.get(url.href)
      if (blockedUntil && blockedUntil > now) {
        if (cached && cached.expiresAt > now) return cached
        throw new Error('Directory refresh throttled')
      }
      if (this.forcedRefreshes.size >= 128) this.forcedRefreshes.delete(this.forcedRefreshes.keys().next().value!)
      this.forcedRefreshes.set(url.href, new Date(now.getTime() + 30_000))
    }
    if (this.pending.size >= 16) throw new Error('Directory fetch capacity reached')
    const resolving = this.load(url, now)
    this.pending.set(url.href, resolving)
    try {
      const resolved = await resolving
      this.failures.delete(url.href)
      return resolved
    } catch (error) {
      if (this.failures.size >= 128) this.failures.delete(this.failures.keys().next().value!)
      this.failures.set(url.href, new Date(now.getTime() + 30_000))
      throw error
    } finally { this.pending.delete(url.href) }
  }
  private async load(url: URL, now: Date): Promise<ResolvedDirectory> {
    const response = await (this.options.transport ?? fetchPinnedDirectory)(url)
    if (Buffer.byteLength(response.body) > DIRECTORY_BYTES
      || response.contentType.split(';')[0]?.trim().toLowerCase() !== DIRECTORY_MEDIA_TYPE)
      throw new Error('Invalid directory response')
    const directory = DirectorySchema.parse(JSON.parse(response.body))
    const keys: DirectoryKey[] = []
    const seen = new Set<string>()
    for (const candidate of directory.keys) {
      if (['d', 'k', 'p', 'q'].some((field) => field in candidate)) throw new Error('Private directory key')
      // This binding intentionally supports Ed25519; other registered algorithms are ignored.
      if (candidate.kty !== 'OKP' || candidate.crv !== 'Ed25519') continue
      const key = PublicKeySchema.parse(candidate)
      const thumbprint = await calculateJwkThumbprint(key)
      if (key.kid && key.kid !== thumbprint || seen.has(thumbprint)) throw new Error('Invalid directory key ID')
      seen.add(thumbprint)
      keys.push({ ...key, kid: thumbprint })
    }
    const maxAge = Math.max(0, Math.min(300, response.maxAgeSeconds ?? 300))
    const result = { identifier: url.href, keys, expiresAt: new Date(now.getTime() + maxAge * 1000) }
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(url.href, result)
    return result
  }
}
export type PublicWebResult =
  | { status: 'anonymous' }
  | { status: 'invalid'; reason: 'invalid_signature' | 'proof_replayed' }
  | { status: 'unverified'; reason: 'directory_unavailable' | 'unsupported_discovery' }
  | { status: 'verified'; identifier: string; keyid: string; observed_at: string }
class UnknownDirectoryKeyError extends Error {}
export class PublicWebVerifier {
  constructor(private readonly directories: DirectoryResolver, private readonly store: PersistentProofStore,
    /** Test override only; must use the persistence/cleanup clock domain. */
    private readonly clock?: () => Date) {}
  private async now(): Promise<Date> {
    try { return this.clock ? this.clock() : await this.store.now() }
    catch { throw new AgentAccessError('proof_store_unavailable', 503) }
  }
  async verify(request: Request): Promise<PublicWebResult> {
    const agentHeader = request.headers.get('Signature-Agent')
    const signature = request.headers.get('Signature')
    const input = request.headers.get('Signature-Input')
    if (!agentHeader && !signature && !input) return { status: 'anonymous' }
    if (!agentHeader || !signature || !input || agentHeader.length > 4096 || signature.length > 8192 || input.length > 8192
      || !['GET', 'HEAD'].includes(request.method)) return { status: 'invalid', reason: 'invalid_signature' }
    let dictionary: ReturnType<typeof parseDictionary>
    try {
      dictionary = parseDictionary(agentHeader)
      parseDictionary(signature); parseDictionary(input)
      if (!dictionary.size || dictionary.size > 4) throw new Error('Excess signatures')
    } catch { return { status: 'invalid', reason: 'invalid_signature' } }
    let discoveryFailed = false
    let unsupported = false
    for (const [label, member] of dictionary) {
      if (typeof member[0] !== 'string') return { status: 'invalid', reason: 'invalid_signature' }
      const type = member[1].get('type')
      if (type !== undefined && (!(type instanceof Token) || type.toString() !== 'directory')) { unsupported = true; continue }
      let directory: ResolvedDirectory
      try { directory = await this.directories.resolve(member[0]) } catch { discoveryFailed = true; continue }
      for (let attempt = 0; attempt < 2; attempt++) try {
        const now = await this.now()
        const verified = await verifySignature(request, {
          label,
          policy: { algorithms: ['ed25519'], requiredComponents: ['@method', '@authority', '@target-uri', component('signature-agent', { key: label })],
            requiredParameters: ['created', 'expires', 'nonce', 'keyid', 'tag'], maxAge: 60, clockSkew: 30,
            now: Math.floor(now.getTime() / 1000),
            validate: (candidate) => candidate.parameters.tag === 'web-bot-auth'
              && typeof candidate.parameters.created === 'number' && typeof candidate.parameters.expires === 'number'
              && Number.isInteger(candidate.parameters.created) && Number.isInteger(candidate.parameters.expires)
              && candidate.parameters.expires > candidate.parameters.created && candidate.parameters.expires - candidate.parameters.created <= 60
              && now.getTime() < (candidate.parameters.expires + 30) * 1000
              && typeof candidate.parameters.nonce === 'string' && candidate.parameters.nonce.length >= 16 && candidate.parameters.nonce.length <= 256,
          },
          resolveVerifier: async (candidate) => {
            const key = directory.keys.find((candidateKey) => candidateKey.kid === candidate.parameters.keyid)
            const seconds = Math.floor(now.getTime() / 1000)
            if (!key) throw new UnknownDirectoryKeyError('Unknown key')
            if (typeof key.nbf === 'number' && key.nbf > seconds || typeof key.exp === 'number' && key.exp <= seconds)
              throw new Error('Unknown or expired key')
            const imported = await importJWK(key, 'EdDSA')
            if (imported instanceof Uint8Array) throw new Error('Symmetric key forbidden')
            return webcrypto.verifier(imported)
          },
        })
        const keyid = verified.parameters.keyid
        const nonce = verified.parameters.nonce
        const expires = verified.parameters.expires
        if (typeof keyid !== 'string' || typeof nonce !== 'string' || typeof expires !== 'number') throw new Error('Missing parameters')
        const key = directory.keys.find((candidate) => candidate.kid === keyid)
        const expiresAt = new Date((expires + 30) * 1000)
        const requireCurrent = (time: Date) => {
          if (time >= expiresAt || !key || typeof key.exp === 'number' && key.exp * 1000 <= time.getTime())
            throw new Error('Signature or directory key expired')
        }
        const verifiedAt = await this.now()
        requireCurrent(verifiedAt)
        let consumed: boolean
        try { consumed = await this.store.consumeReplay({ namespace: 'public-web', key: `${directory.identifier}:${keyid}`, id: nonce,
          now: verifiedAt, expiresAt }) }
        catch { throw new AgentAccessError('proof_store_unavailable', 503) }
        if (!consumed) return { status: 'invalid', reason: 'proof_replayed' }
        const completedAt = await this.now()
        requireCurrent(completedAt)
        return { status: 'verified', identifier: directory.identifier, keyid, observed_at: completedAt.toISOString() }
      } catch (error) {
        if (error instanceof AgentAccessError) throw error
        if ((error instanceof UnknownDirectoryKeyError || isSignatureError(error) && error.cause instanceof UnknownDirectoryKeyError) && attempt === 0) {
          try { directory = await this.directories.resolve(member[0], { refresh: true }) }
          catch { discoveryFailed = true; break }
          continue
        }
        break // Try another signature. Failed cryptographic evidence never conveys authority.
      }
    }
    return discoveryFailed ? { status: 'unverified', reason: 'directory_unavailable' }
      : unsupported ? { status: 'unverified', reason: 'unsupported_discovery' } : { status: 'invalid', reason: 'invalid_signature' }
  }
}
export async function signPublicWebRequest(request: Request, options: {
  agentOrigin: string; privateKey: CryptoKey; publicKey: CryptoKey; label?: string; now?: Date; nonce?: string
}): Promise<Request> {
  const label = options.label ?? 'sig1'
  directoryUrl(options.agentOrigin)
  if (!['GET', 'HEAD'].includes(request.method)) throw new TypeError('Public Web binding only signs public reads')
  const keyid = await calculateJwkThumbprint(await exportJWK(options.publicKey))
  const headers = new Headers(request.headers)
  headers.set('Signature-Agent', serializeDictionary(new Map([[label, [options.agentOrigin, new Map()]]])))
  const unsigned = new Request(request, { headers })
  const created = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const signed = await createSignature(unsigned, { label,
    components: ['@method', '@authority', '@target-uri', component('signature-agent', { key: label })],
    parameters: { created, expires: created + 60, nonce: options.nonce ?? randomBytes(24).toString('base64url'),
      keyid, tag: 'web-bot-auth', alg: 'ed25519' }, signer: webcrypto.signer(options.privateKey),
  })
  return new Request(unsigned, { headers: appendSignature(headers, signed) })
}
