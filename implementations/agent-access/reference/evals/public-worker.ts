/** Eval-only HTTP worker: production app/storage/verification with a controlled directory transport. */
import { serve } from '@hono/node-server'
import { Pool } from 'pg'
import { z } from 'zod'
import { setTimeout as pause } from 'node:timers/promises'
import { SafeDirectoryResolver, type DirectoryTransportResult } from '@hitl-protocol/agent-access'
import { createApp } from '../src/app.js'
import { readConfig } from '../src/config.js'
import { Store } from '../src/store.js'
import { initializeDatabase } from '../src/db-init.js'
import { PersistentDirectories } from '../src/directories.js'

const config = readConfig()
const store = new Store(config, new Pool({ connectionString: config.DATABASE_URL, max: 10,
  connectionTimeoutMillis: 2000, statement_timeout: 5000 }))
await initializeDatabase(store)
const Fixture = z.object({ body: z.string(), content_type: z.string(),
  max_age: z.number().int(), delay_ms: z.number().int(), unavailable: z.boolean() })
const upstream = new SafeDirectoryResolver({ now:()=>store.now(), transport: async (url): Promise<DirectoryTransportResult> => {
  // Increment and decrement in separate committed statements: no DB lock is held during transport.
  const result = await store.pool.query<Record<string, unknown>>(`
    UPDATE eval_directories SET fetches=fetches+1,active=active+1,peak=greatest(peak,active+1)
    WHERE identifier=$1 RETURNING body,content_type,max_age,delay_ms,unavailable`, [url.href])
  const row = result.rows[0]
  if (!row) throw new Error('No controlled directory fixture for this origin')
  const fixture = Fixture.parse(row)
  try {
    await pause(fixture.delay_ms)
    if (fixture.unavailable) throw new Error('Controlled directory outage')
    return { body: fixture.body, contentType: fixture.content_type, maxAgeSeconds: fixture.max_age }
  } finally {
    await store.pool.query('UPDATE eval_directories SET active=active-1 WHERE identifier=$1', [url.href])
  }
} })
const app = createApp(config, store, { directories: new PersistentDirectories(store, upstream) })
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST })
console.log(`Eval public HTTP worker listening on ${config.PORT}`)
const cleanup = setInterval(() => { store.cleanup().catch(() => console.error('Eval cleanup failed')) }, 60_000)
cleanup.unref()
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('kind' in message) || message.kind !== 'cleanup'
    || !('id' in message) || typeof message.id !== 'string') return
  const id = message.id
  void store.cleanup().then(() => process.send?.({ kind: 'cleaned', id })).catch((error: unknown) => {
    process.send?.({ kind: 'cleanup-error', id, error: error instanceof Error ? error.message : String(error) })
  })
})
async function stop() {
  clearInterval(cleanup)
  server.close()
  await store.close()
  process.disconnect?.()
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })
