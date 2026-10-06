/**
 * Core runtime types for HITL Protocol implementations.
 * Re-exports schema types and adds server-side types (ReviewCase).
 */

export type { ReviewType, ReviewStatus, DefaultAction } from '@hitl-protocol/schemas/v0.8'

import type { ReviewType, ReviewStatus, ReviewResult, SubmissionContext, RespondedBy, DefaultAction } from '@hitl-protocol/schemas/v0.8'

/** In-memory representation of a review case. */
export interface ReviewCase {
  case_id: string
  type: ReviewType
  status: ReviewStatus
  prompt: string
  token_hash: Buffer
  submit_token_hash?: Buffer
  inline_actions: string[]
  context: Record<string, unknown>
  created_at: string
  expires_at: string
  default_action: DefaultAction
  version: number
  etag: string
  result: ReviewResult | null
  responded_by: RespondedBy | null
  submission_context?: SubmissionContext
  opened_at?: string
  completed_at?: string
  expired_at?: string
  cancelled_at?: string
}
