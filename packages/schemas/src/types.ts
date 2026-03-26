/**
 * TypeScript type definitions for HITL Protocol v0.8.
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
// Verification Types (v0.8)
// ---------------------------------------------------------------------------

export type ProofType = 'proof_of_human' | `x-${string}`
export type AssuranceLevel = 'low' | 'medium' | 'high'
export type VerificationMode = 'optional' | 'required' | 'step_up'
export type VerificationPath = 'inline_submit' | 'browser_submit'
export type SubmissionMode = 'inline_submit' | 'browser_submit'
export type EvidenceFormat =
  | 'provider_opaque'
  | 'jwt'
  | 'zkp'
  | 'attestation'
  | `x-${string}`

export interface VerificationRequirement {
  proof_type: ProofType
  provider?: string
  min_assurance?: AssuranceLevel
  presentation_formats?: EvidenceFormat[]
}

export interface VerificationRequirementBranch {
  all_of: VerificationRequirement[]
}

export interface VerificationPolicyRequirements {
  any_of: VerificationRequirementBranch[]
}

export interface VerificationBinding {
  case_id: boolean
  action: boolean
  challenge?: string
  freshness_seconds: number
  expires_at?: string
  single_use: boolean
}

export interface VerificationFallback {
  on_missing: 'browser_review' | 'reject'
  on_invalid: 'browser_review' | 'reject'
}

export interface VerificationPolicy {
  mode: VerificationMode
  required_for: VerificationPath[]
  requirements: VerificationPolicyRequirements
  binding: VerificationBinding
  fallback: VerificationFallback
}

export interface VerificationEvidence {
  proof_type: ProofType
  provider: string
  format: EvidenceFormat
  presentation: string | Record<string, unknown>
  binding: Record<string, unknown>
}

export interface VerifiedEvidence {
  proof_type: string
  provider: string
  assurance_level?: AssuranceLevel
  bound_to_case?: boolean
  bound_to_action?: boolean
  fresh?: boolean
  single_use_enforced?: boolean
  verified_at?: string
}

export interface VerificationResult {
  satisfied: boolean
  verified_evidence?: VerifiedEvidence[]
  missing_requirements?: string[]
}

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
 * Defined by HITL Protocol v0.8.
 */
export interface HitlObject {
  spec_version: '0.8'
  case_id: string
  review_url: string
  poll_url: string
  type: AnyReviewType
  prompt: string
  created_at: string
  expires_at: string
  callback_url?: string | null
  events_url?: string
  timeout?: string
  default_action?: DefaultAction
  context?: HitlContext
  reminder_at?: string | string[]
  previous_case_id?: string
  surface?: Surface
  submit_url?: string
  submit_token?: string
  inline_actions?: string[]
  verification_policy?: VerificationPolicy
}

// ---------------------------------------------------------------------------
// Discovery Response
// ---------------------------------------------------------------------------

export interface DiscoveryServiceInfo {
  name?: string
  description?: string
  url?: string
  logo_url?: string
  contact?: string
}

export interface DiscoveryCapabilities {
  review_types?: string[]
  transports?: Array<'polling' | 'sse' | 'callback'>
  max_timeout?: string
  default_timeout?: string
  supports_reminders?: boolean
  supports_multi_round?: boolean
  supports_signatures?: boolean
  supports_inline_submit?: boolean
  supports_agent_binding?: boolean
  supports_surface?: boolean
  surface_formats?: string[]
  surface_profiles?: string[]
}

export interface DiscoveryEndpoints {
  reviews_base?: string
  review_page_base?: string
  events_base?: string
  well_known?: string
}

export interface DiscoveryAuthentication {
  type?: string
  token_url?: string
  scopes?: string[]
  profiles?: string[]
  well_known?: string
  documentation?: string
}

export interface DiscoveryRateLimits {
  poll_min_interval_seconds?: number
  poll_recommended_interval_seconds?: number
  max_active_cases_per_agent?: number
  max_requests_per_minute?: number
}

export interface DiscoveryPolicies {
  data_retention_days?: number
  expired_case_retention_days?: number
  privacy_policy?: string
  terms_of_service?: string
}

export interface DiscoveryExamples {
  documentation?: string
  openapi?: string
}

export interface DiscoveryResponse {
  hitl_protocol: {
    spec_version: '0.8'
    service?: DiscoveryServiceInfo
    capabilities?: DiscoveryCapabilities
    endpoints?: DiscoveryEndpoints
    authentication?: DiscoveryAuthentication
    rate_limits?: DiscoveryRateLimits
    policies?: DiscoveryPolicies
    examples?: DiscoveryExamples
  }
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

/** Submission metadata for completed review responses. */
export interface SubmissionContext {
  mode: SubmissionMode
  submitted_via?: string
  submitted_by?: SubmittedBy
  verification_result?: VerificationResult
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
  submission_context?: SubmissionContext
  progress?: ReviewProgress
  reminder_sent_at?: string
  next_case_id?: string
  default_action?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Inline Submit Request (v0.8)
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
  verification_evidence?: VerificationEvidence[]
}
