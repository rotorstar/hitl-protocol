export interface NonceRecord { jkt: string; nonce: string; expiresAt: Date }
export interface NonceLookup { jkt: string; nonce: string; now: Date }
export interface ReplayRecord {
  namespace: 'dpop' | 'public-web'; key: string; id: string; expiresAt: Date; now: Date
}
/** State and time must be shared across workers, including expiration cleanup. */
export interface PersistentProofStore {
  /** Authoritative persistence clock; never substitute an independently skewed worker clock. */
  now(): Promise<Date>
  saveNonce(record: NonceRecord): Promise<void>
  hasNonce(record: NonceLookup): Promise<boolean>
  /** Atomic insert-if-absent. Retain the record until its exclusive expiresAt deadline. */
  consumeReplay(record: ReplayRecord): Promise<boolean>
}
