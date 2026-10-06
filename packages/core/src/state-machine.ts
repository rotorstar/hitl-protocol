/**
 * HITL Protocol state machine.
 * 6 states, 11 valid transitions, 3 terminal states.
 *
 * The onTransition callback decouples framework-specific side effects
 * (SSE notification, cleanup timers) from the pure state machine logic.
 */

import type { ReviewStatus } from '@hitl-protocol/schemas/v0.8'

import type { ReviewCase } from './types.js'

/** Valid transitions per state. */
export const VALID_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  pending: ['opened', 'completed', 'expired', 'cancelled'],
  opened: ['in_progress', 'completed', 'expired', 'cancelled'],
  in_progress: ['completed', 'expired', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
}

/** Terminal states that cannot transition further. */
export const TERMINAL_STATES: readonly ReviewStatus[] = ['completed', 'expired', 'cancelled']

/** Check if a transition is valid without executing it. */
export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  const allowed = VALID_TRANSITIONS[from]
  return allowed.includes(to)
}

/**
 * Transition a review case to a new status.
 *
 * Updates: status, timestamp (`${newStatus}_at`), version, etag.
 * Calls `onTransition` after state update (e.g. for SSE notification).
 *
 * @throws Error if the transition is invalid.
 */
export function transition(
  rc: ReviewCase,
  newStatus: ReviewStatus,
  onTransition?: (rc: ReviewCase) => void,
): void {
  if (!canTransition(rc.status, newStatus)) {
    throw new Error(`Invalid transition: ${rc.status} → ${newStatus}`)
  }
  rc.status = newStatus
  const key = `${newStatus}_at` as keyof ReviewCase
  ;(rc[key] as string | undefined) = new Date().toISOString()
  rc.version++
  rc.etag = `"v${rc.version}-${newStatus}"`
  onTransition?.(rc)
}
