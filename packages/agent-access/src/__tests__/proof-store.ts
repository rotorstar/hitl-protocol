import type { NonceLookup, NonceRecord, PersistentProofStore, ReplayRecord } from '../proof-store.js'
/** Test fixture only: runtime adapters must persist these records across workers. */
export class TestProofStore implements PersistentProofStore {
  constructor(private readonly clock: () => Date = () => new Date()) {}
  async now(): Promise<Date> { return this.clock() }
  readonly nonces = new Map<string, Date>()
  readonly replay = new Map<string, Date>()
  async saveNonce(record: NonceRecord): Promise<void> { this.nonces.set(`${record.jkt}:${record.nonce}`, record.expiresAt) }
  async hasNonce(record: NonceLookup): Promise<boolean> {
    const deadline = this.nonces.get(`${record.jkt}:${record.nonce}`)
    return !!deadline && deadline > record.now
  }
  async consumeReplay(record: ReplayRecord): Promise<boolean> {
    const key = `${record.namespace}:${record.key}:${record.id}`
    const existing = this.replay.get(key)
    if (existing && existing > record.now) return false
    this.replay.set(key, record.expiresAt)
    return true
  }
}
