/**
 * @hitl-protocol/core — Shared runtime utilities for HITL Protocol implementations.
 *
 * Extracts common logic (tokens, state machine, rate limiting, constants)
 * from the reference implementations so they can be reused across frameworks.
 */

// Types
export type { ReviewCase } from './types.js'
export type { ReviewType, ReviewStatus, DefaultAction } from './types.js'

// Token utilities
export { generateToken, hashToken, verifyToken, verifyTokenForPurpose } from './tokens.js'

// State machine
export { VALID_TRANSITIONS, TERMINAL_STATES, canTransition, transition } from './state-machine.js'

// Rate limiting
export { RATE_LIMIT, checkRateLimit, clearRateLimit, resetRateLimits } from './rate-limit.js'

// Constants & sample data
export { INLINE_ACTIONS, PROMPTS, SAMPLE_CONTEXTS } from './constants.js'
