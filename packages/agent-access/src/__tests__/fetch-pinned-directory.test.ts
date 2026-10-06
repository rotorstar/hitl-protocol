/** Exercise the production HTTPS fetcher while controlling only Node DNS/socket boundaries. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { LookupAddress } from 'node:dns'
import type { ClientRequest, IncomingMessage, IncomingHttpHeaders } from 'node:http'
import type { RequestOptions } from 'node:https'
import { exportJWK, generateKeyPair } from 'jose'
import { fetchPinnedDirectory, SafeDirectoryResolver, DIRECTORY_MEDIA_TYPE } from '../public-web.js'

const seams = vi.hoisted(() => ({
  lookup: vi.fn<(hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>>(),
  request: vi.fn<(url: URL, options: RequestOptions, response: (message: IncomingMessage) => void) => ClientRequest>(),
}))
vi.mock('node:dns/promises', () => ({ lookup: seams.lookup }))
vi.mock('node:https', () => ({ request: seams.request }))

const path = '/.well-known/http-message-signatures-directory'
const url = new URL(`https://agent.example${path}`)
class SocketRequest extends EventEmitter {
  readonly end = vi.fn()
  readonly destroy = vi.fn((error?: Error) => {
    // ClientRequest errors are asynchronous; an immediate incoming end must not override a size failure.
    if (error) queueMicrotask(() => this.emit('error', error))
    return this
  })
}
class SocketResponse extends EventEmitter {
  readonly destroy = vi.fn(() => this)
  constructor(readonly statusCode = 200, readonly headers: IncomingHttpHeaders = {
    'content-type': DIRECTORY_MEDIA_TYPE, 'cache-control': 'public, max-age=120',
  }) { super() }
}
interface PendingSocket {
  request: SocketRequest
  options: RequestOptions
  respond: (response: SocketResponse) => void
}
let deadline: AbortController
let created: Promise<PendingSocket>

beforeEach(() => {
  deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  seams.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  seams.request.mockReset()
  let deliver: (socket: PendingSocket) => void = () => { throw new Error('Socket promise not initialized') }
  created = new Promise((resolve) => { deliver = resolve })
  seams.request.mockImplementation((_url, options, callback) => {
    const request = new SocketRequest()
    // Model the actual Node HTTPS signal behavior, rather than a second timeout implementation.
    options.signal?.addEventListener('abort', () => request.destroy(new Error('Socket deadline exceeded')), { once: true })
    deliver({ request, options, respond: (response) => callback(response as unknown as IncomingMessage) })
    // These test emitters implement only the Node event surface exercised by the production fetcher.
    return request as unknown as ClientRequest
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('E6 production pinned HTTPS directory transport', () => {
  it.each([
    'http://agent.example', 'https://user:pass@agent.example', 'https://agent.example:444',
    'https://127.0.0.1', 'https://[::1]', 'https://[2606:4700:4700::1111]',
  ])('rejects unsafe/literal origin before any DNS or socket access: %s', async (origin) => {
    seams.request.mockImplementation(() => { throw new Error('Unexpected socket access') })
    await expect(fetchPinnedDirectory(new URL(`${origin}${path}`))).rejects.toThrow('Unsafe key directory URL')
    expect(seams.lookup).not.toHaveBeenCalled()
    expect(seams.request).not.toHaveBeenCalled()
  })
  it.each([`https://agent.example/keys`, `https://agent.example${path}?key=1`, `https://agent.example${path}#fragment`])(
    'rejects altered discovery URL %s before DNS', async (address) => {
      await expect(fetchPinnedDirectory(new URL(address))).rejects.toThrow('Unsafe key directory URL')
      expect(seams.lookup).not.toHaveBeenCalled()
    },
  )
  it.each([
    { answers: [] }, { answers: [{ address: '169.254.169.254', family: 4 }] },
    { answers: [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] },
    { answers: [{ address: '2606:4700:4700::1111', family: 6 }, { address: '::ffff:127.0.0.1', family: 6 }] },
  ])('rejects empty or mixed private DNS results before TLS', async ({ answers }) => {
    seams.lookup.mockResolvedValue(answers)
    await expect(fetchPinnedDirectory(url)).rejects.toThrow('Unsafe DNS answer')
    expect(seams.request).not.toHaveBeenCalled()
  })
  it('propagates DNS failure without opening a socket', async () => {
    seams.lookup.mockRejectedValue(new Error('DNS unavailable'))
    await expect(fetchPinnedDirectory(url)).rejects.toThrow('DNS unavailable')
    expect(seams.request).not.toHaveBeenCalled()
  })
  it('pins both lookup callback forms to the validated address despite a later private DNS answer', async () => {
    const pending = fetchPinnedDirectory(url)
    const socket = await created
    seams.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const callback = vi.fn()
    socket.options.lookup?.('agent.example', { all: false }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4)
    socket.options.lookup?.('agent.example', { all: true }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
    expect(seams.lookup).toHaveBeenCalledTimes(1)
    expect(seams.lookup).toHaveBeenCalledWith('agent.example', { all: true, verbatim: true })
    expect(seams.request.mock.calls[0]?.[0].hostname).toBe('agent.example')
    expect(socket.options).toMatchObject({ method: 'GET', agent: false,
      headers: { Accept: DIRECTORY_MEDIA_TYPE, 'Accept-Encoding': 'identity' }, signal: deadline.signal })
    expect(socket.options.rejectUnauthorized).not.toBe(false)
    const response = new SocketResponse()
    socket.respond(response); response.emit('data', Buffer.from('{"keys":[]}')); response.emit('end')
    await expect(pending).resolves.toEqual({ body: '{"keys":[]}', contentType: DIRECTORY_MEDIA_TYPE, maxAgeSeconds: 120 })
  })
  it('uses the same 2000ms abort budget for stalled DNS and does not create a TLS request', async () => {
    seams.lookup.mockReturnValue(new Promise(() => {}))
    const pending = fetchPinnedDirectory(url)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(2000)
    deadline.abort()
    await expect(pending).rejects.toThrow('Directory timeout')
    expect(seams.request).not.toHaveBeenCalled()
  })
  it('uses the remaining shared deadline for stalled TLS/body delivery', async () => {
    const pending = fetchPinnedDirectory(url)
    const socket = await created
    expect(AbortSignal.timeout).toHaveBeenCalledTimes(1)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(2000)
    expect(socket.options.signal).toBe(deadline.signal)
    deadline.abort()
    await expect(pending).rejects.toThrow('Socket deadline exceeded')
    expect(socket.request.destroy).toHaveBeenCalledTimes(1)
  })
  it.each([301, 302, 303, 307, 308])('rejects redirect %s without following even a public Location', async (status) => {
    const pending = fetchPinnedDirectory(url); const socket = await created
    const response = new SocketResponse(status, { location: 'https://another.example/keys' })
    socket.respond(response)
    await expect(pending).rejects.toThrow('Directory response rejected')
    expect(response.destroy).toHaveBeenCalledOnce()
    expect(seams.request).toHaveBeenCalledTimes(1)
    expect(seams.lookup).toHaveBeenCalledTimes(1)
  })
  it.each([404, 500])('rejects non-success %s before accepting a body', async (status) => {
    const pending = fetchPinnedDirectory(url); const socket = await created
    socket.respond(new SocketResponse(status))
    await expect(pending).rejects.toThrow('Directory response rejected')
  })
  it('rejects compressed bodies despite advertised identity encoding', async () => {
    const pending = fetchPinnedDirectory(url); const socket = await created
    const response = new SocketResponse(200, { 'content-encoding': 'gzip', 'content-type': DIRECTORY_MEDIA_TYPE })
    socket.respond(response)
    await expect(pending).rejects.toThrow('Directory response rejected')
    expect(response.destroy).toHaveBeenCalledOnce()
  })
  it('permits exactly 64KiB across streamed chunks', async () => {
    const pending = fetchPinnedDirectory(url); const socket = await created; const response = new SocketResponse()
    socket.respond(response)
    response.emit('data', Buffer.alloc(32768, 'a')); response.emit('data', Buffer.alloc(32768, 'b')); response.emit('end')
    expect(Buffer.byteLength((await pending).body)).toBe(65536)
    expect(socket.request.destroy).not.toHaveBeenCalled()
  })
  it('rejects 64KiB plus one byte even if end races the asynchronous socket error', async () => {
    const pending = fetchPinnedDirectory(url); const socket = await created; const response = new SocketResponse()
    socket.respond(response)
    response.emit('data', Buffer.alloc(65536, 'a')); response.emit('data', Buffer.from('b')); response.emit('end')
    await expect(pending).rejects.toThrow('Directory response oversized')
    expect(socket.request.destroy).toHaveBeenCalledOnce()
  })
  it('propagates TLS and truncated response errors', async () => {
    const pending = fetchPinnedDirectory(url); const socket = await created; const response = new SocketResponse()
    socket.respond(response)
    response.emit('error', new Error('Truncated HTTPS response'))
    await expect(pending).rejects.toThrow('Truncated HTTPS response')
  })
  it('accepts exactly 32 actual Ed25519 public keys and rejects a 33rd key', async () => {
    const keys = await Promise.all(Array.from({ length: 33 }, async () => exportJWK((await generateKeyPair('EdDSA', { extractable: true })).publicKey)))
    for (const [count, accepted] of [[32, true], [33, false]] as const) {
      const resolver = new SafeDirectoryResolver({ transport: async () => ({
        body: JSON.stringify({ keys: keys.slice(0, count) }), contentType: DIRECTORY_MEDIA_TYPE,
      }) })
      const pending = resolver.resolve('https://agent.example')
      if (accepted) expect((await pending).keys).toHaveLength(32)
      else await expect(pending).rejects.toThrow()
    }
  })
})
