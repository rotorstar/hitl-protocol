export type AgentAccessErrorCode =
  | 'unauthorized' | 'invalid_token' | 'invalid_dpop' | 'use_dpop_nonce'
  | 'proof_replayed' | 'proof_store_unavailable' | 'authorization_server_unavailable' | 'invalid_signature' | 'directory_unavailable'

/** Messages are intentionally generic: no credentials or raw proofs are attached. */
export class AgentAccessError extends Error {
  constructor(public readonly code: AgentAccessErrorCode, public readonly status: 401 | 403 | 503,
    public readonly headers: Readonly<Record<string, string>> = {}) {
    super(code)
    this.name = 'AgentAccessError'
  }
}
