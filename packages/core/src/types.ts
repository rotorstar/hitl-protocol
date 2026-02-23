/**
 * Core runtime types for HITL Protocol implementations.
 * Re-exports schema types and adds server-side types (ReviewCase).
 */

export type { ReviewType, ReviewStatus, DefaultAction } from '@hitl-protocol/schemas'

import type { ReviewType, ReviewStatus } from '@hitl-protocol/schemas'

/** In-memory representation of a review case. */
export interface ReviewCase {
  case_id: string
  type: ReviewType
  status: ReviewStatus
  prompt: string
  token_hash: Buffer
  submit_token_hash: Buffer
  inline_actions: string[]
  context: Record<string, unknown>
  created_at: string
  expires_at: string
  default_action: string
  version: number
  etag: string
  result: { action: string; data: Record<string, unknown> } | null
  responded_by: { name: string; email: string } | null
  submitted_via?: string
  opened_at?: string
  completed_at?: string
  expired_at?: string
  cancelled_at?: string
}
