/**
 * TypeScript type definitions for HITL Protocol v0.7.
 *
 * These types mirror the JSON Schemas in schemas/ and are validated
 * against them in the test suite. The JSON Schemas remain the
 * canonical source of truth.
 */

// ---------------------------------------------------------------------------
// Review Types & Status
// ---------------------------------------------------------------------------

/** Standard review type categories. Services MAY extend with `x-` prefixed custom types. */
export type ReviewType =
  | 'approval'
  | 'selection'
  | 'input'
  | 'confirmation'
  | 'escalation'

/** Custom review type (x- prefixed). */
export type CustomReviewType = `x-${string}`

/** All review types including custom. */
export type AnyReviewType = ReviewType | CustomReviewType

/** Review case lifecycle states. */
export type ReviewStatus =
  | 'pending'
  | 'opened'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'cancelled'

/** Default action taken when a review expires without a response. */
export type DefaultAction = 'skip' | 'approve' | 'reject' | 'abort'

// ---------------------------------------------------------------------------
// Form Fields (Input-type reviews)
// ---------------------------------------------------------------------------

/** Standard form field types. Services MAY extend with `x-` prefixed custom types. */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'email'
  | 'url'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'range'

/** Comparison operators for conditional field visibility. */
export type ConditionalOperator = 'eq' | 'neq' | 'in' | 'gt' | 'lt'

/** Conditional visibility rule for a form field. */
export interface FormFieldConditional {
  field: string
  operator: ConditionalOperator
  value: unknown
}

/** Validation rules for a form field. */
export interface FormFieldValidation {
  minLength?: number
  maxLength?: number
  pattern?: string
  min?: number
  max?: number
}

/** Select/multiselect option. */
export interface FormFieldOption {
  value: string
  label: string
}

/** A single form field definition (Input-type reviews). */
export interface FormField {
  key: string
  label: string
  type: FieldType | `x-${string}`
  required?: boolean
  placeholder?: string
  hint?: string
  default?: unknown
  default_ref?: string
  sensitive?: boolean
  options?: FormFieldOption[]
  validation?: FormFieldValidation
  conditional?: FormFieldConditional
}

/** A step in a multi-step form wizard. */
export interface FormStep {
  title: string
  description?: string
  fields: FormField[]
}

/** Structured form definition for Input-type reviews. */
export interface FormDefinition {
  fields?: FormField[]
  steps?: FormStep[]
  session_id?: string
}

// ---------------------------------------------------------------------------
// Surface (UI format declaration)
// ---------------------------------------------------------------------------

/** Optional declaration of the review page UI format. */
export interface Surface {
  format?: string
  version?: string
}

// ---------------------------------------------------------------------------
// HITL Object (HTTP 202 response body)
// ---------------------------------------------------------------------------

/** Context object — arbitrary key-value pairs for the review page. */
export interface HitlContext {
  form?: FormDefinition
  [key: string]: unknown
}

/**
 * The `hitl` object within an HTTP 202 response.
 * Defined by HITL Protocol v0.7.
 */
export interface HitlObject {
  // Required fields
  spec_version: '0.7'
  case_id: string
  review_url: string
  poll_url: string
  type: AnyReviewType
  prompt: string
  created_at: string
  expires_at: string

  // Optional fields
  callback_url?: string | null
  events_url?: string
  timeout?: string
  default_action?: DefaultAction
  context?: HitlContext
  reminder_at?: string | string[]
  previous_case_id?: string
  surface?: Surface

  // Inline submit (v0.7)
  submit_url?: string
  submit_token?: string
  inline_actions?: string[]
}

// ---------------------------------------------------------------------------
// Poll Response
// ---------------------------------------------------------------------------

/** Cryptographic signature for response integrity. */
export interface ResultSignature {
  algorithm?: string
  value?: string
  signed_at?: string
  signer?: string
}

/** The human's structured response. */
export interface ReviewResult {
  action: string
  data?: Record<string, unknown>
  signature?: ResultSignature
}

/** Identity of the person who submitted the response. */
export interface RespondedBy {
  name?: string
  email?: string
}

/** Progress tracking for multi-step Input forms. */
export interface ReviewProgress {
  current_step?: number
  total_steps?: number
  completed_fields?: number
  total_fields?: number
}

/** Response from the poll endpoint. */
export interface PollResponse {
  status: ReviewStatus
  case_id: string
  created_at?: string
  opened_at?: string
  expires_at?: string
  completed_at?: string
  expired_at?: string
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  progress?: ReviewProgress
  reminder_sent_at?: string
  next_case_id?: string
  default_action?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Inline Submit Request (v0.7)
// ---------------------------------------------------------------------------

/** Standard submission channels for inline submit. */
export type SubmissionChannel =
  | 'telegram_inline_button'
  | 'slack_block_action'
  | 'discord_component'
  | 'whatsapp_reply_button'
  | 'teams_adaptive_card'

/** Standard platforms for inline submit identity. */
export type SubmissionPlatform =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'teams'

/** Identity of the user who submitted via inline button. */
export interface SubmittedBy {
  platform: SubmissionPlatform | `x-${string}`
  platform_user_id: string
  display_name?: string
}

/** Request body for agent-submitted responses via submit_url. */
export interface SubmitRequest {
  action: string
  data?: Record<string, unknown>
  submitted_via: SubmissionChannel | `x-${string}`
  submitted_by: SubmittedBy
}
