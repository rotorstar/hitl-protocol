/** Generated from canonical HITL v0.9 JSON Schemas. Do not edit. */

/**
 * Review type category. One of the five standard types, or a custom type prefixed with 'x-'.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "AnyReviewType".
 */
export type AnyReviewType = AnyReviewType1 & AnyReviewType2
export type AnyReviewType1 = ReviewType | CustomReviewType
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ReviewType".
 */
export type ReviewType = 'approval' | 'selection' | 'input' | 'confirmation' | 'escalation'
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "CustomReviewType".
 */
export type CustomReviewType = `x-${string}`
export type AnyReviewType2 = string
/**
 * Action taken if the review expires without a response.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DefaultAction".
 */
export type DefaultAction = 'skip' | 'approve' | 'reject' | 'abort'
/**
 * Structured form definition for Input-type reviews. Use either 'fields' (single-step) or 'steps' (multi-step), not both.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormDefinition".
 */
export type FormDefinition = SingleStepFormDefinition | MultiStepFormDefinition
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FieldType".
 */
export type FieldType =
  'text' | 'textarea' | 'number' | 'date' | 'email' | 'url' | 'boolean' | 'select' | 'multiselect' | 'range'
/**
 * Comparison operator.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ConditionalOperator".
 */
export type ConditionalOperator = 'eq' | 'neq' | 'in' | 'gt' | 'lt'
/**
 * Whether verification evidence is optional, required, or only required as a step-up.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationMode".
 */
export type VerificationMode = 'optional' | 'required' | 'step_up'
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationPath".
 */
export type VerificationPath = 'inline_submit' | 'browser_submit'
/**
 * Normative core value in v0.9 is proof_of_human. Custom extensions MUST use x- prefixes.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ProofType".
 */
export type ProofType = ProofType1 & ProofType2
export type ProofType1 = 'proof_of_human' | `x-${string}`
export type ProofType2 = string
/**
 * Minimum service-defined assurance level required for this proof.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "AssuranceLevel".
 */
export type AssuranceLevel = 'low' | 'medium' | 'high'
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "EvidenceFormat".
 */
export type EvidenceFormat = EvidenceFormat1 & EvidenceFormat2
export type EvidenceFormat1 = ('provider_opaque' | 'jwt' | 'zkp' | 'attestation') | `x-${string}`
export type EvidenceFormat2 = string
/**
 * Response from the poll endpoint, as defined by HITL Protocol v0.9
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "PollResponse".
 */
export type PollResponse =
  | PendingPollResponse
  | OpenedPollResponse
  | InProgressPollResponse
  | CompletedPollResponse
  | ExpiredPollResponse
  | CancelledPollResponse
export type PendingPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction1
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'pending'
  result?: never
  responded_by?: never
  submission_context?: never
  [k: string]: unknown
}
/**
 * Current status of the review case.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ReviewStatus".
 */
export type ReviewStatus = 'pending' | 'opened' | 'in_progress' | 'completed' | 'expired' | 'cancelled'
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction1 = 'skip' | 'approve' | 'reject' | 'abort'
export type OpenedPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext1
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction2
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'opened'
  result?: never
  responded_by?: never
  submission_context?: never
  [k: string]: unknown
}
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext1 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction2 = 'skip' | 'approve' | 'reject' | 'abort'
export type InProgressPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext2
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction3
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'in_progress'
  result?: never
  responded_by?: never
  submission_context?: never
  [k: string]: unknown
}
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext2 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction3 = 'skip' | 'approve' | 'reject' | 'abort'
export type CompletedPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext3
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction4
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'completed'
  result: ReviewResult
  /**
   * When the human submitted their response.
   */
  completed_at: string
  [k: string]: unknown
}
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext3 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction4 = 'skip' | 'approve' | 'reject' | 'abort'
export type ExpiredPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext4
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction5
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'expired'
  /**
   * When the case expired.
   */
  expired_at: string
  default_action: DefaultAction6
  result?: never
  responded_by?: never
  submission_context?: never
  [k: string]: unknown
}
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext4 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction5 = 'skip' | 'approve' | 'reject' | 'abort'
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction6 = 'skip' | 'approve' | 'reject' | 'abort'
export type CancelledPollResponse = {
  status: ReviewStatus
  /**
   * The review case identifier.
   */
  case_id: string
  /**
   * When the case was created.
   */
  created_at?: string
  /**
   * When the human first opened the review URL.
   */
  opened_at?: string
  /**
   * When the case will expire.
   */
  expires_at?: string
  /**
   * When the human submitted their response.
   */
  completed_at?: string
  /**
   * When the case expired.
   */
  expired_at?: string
  /**
   * When the human cancelled.
   */
  cancelled_at?: string
  result?: ReviewResult
  responded_by?: RespondedBy
  submission_context?: SubmissionContext5
  progress?: ReviewProgress
  /**
   * When the last reminder was sent.
   */
  reminder_sent_at?: string
  /**
   * If a follow-up case was created, links to the next case in the chain.
   */
  next_case_id?: string
  default_action?: DefaultAction7
  /**
   * Human-readable reason for cancellation. Present when status is 'cancelled'.
   */
  reason?: string
} & {
  status: 'cancelled'
  /**
   * When the human cancelled.
   */
  cancelled_at: string
  result?: never
  responded_by?: never
  submission_context?: never
  [k: string]: unknown
}
/**
 * Normalized information about the submission path and verification outcome.
 */
export type SubmissionContext5 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * Action taken if the review expires without a response.
 */
export type DefaultAction7 = 'skip' | 'approve' | 'reject' | 'abort'
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmissionChannel".
 */
export type SubmissionChannel =
  | 'telegram_inline_button'
  | 'slack_block_action'
  | 'discord_component'
  | 'whatsapp_reply_button'
  | 'teams_adaptive_card'
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmissionPlatform".
 */
export type SubmissionPlatform = 'telegram' | 'slack' | 'discord' | 'whatsapp' | 'teams'
/**
 * Context about how a completed HITL review was submitted in v0.9.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmissionContext".
 */
export type SubmissionContext6 = BrowserSubmissionContext | InlineSubmissionContext
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmissionMode".
 */
export type SubmissionMode = 'browser_submit' | 'inline_submit'

export interface ProtocolTypeCatalog {}
/**
 * The hitl object within an HTTP 202 response, as defined by HITL Protocol v0.9
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "HitlObject".
 */
export interface HitlObject {
  /**
   * Protocol version. MUST be '0.9' for this spec.
   */
  spec_version: '0.9'
  /**
   * Unique, URL-safe identifier for this review case. RECOMMENDED format: review_{random}
   */
  case_id: string
  /**
   * Fully qualified review URL to the review page. MUST be HTTPS in production. For local development, http://localhost and http://127.0.0.1 are allowed.
   */
  review_url: string
  /**
   * Fully qualified URL to the status polling endpoint. MUST be HTTPS in production. For local development, http://localhost and http://127.0.0.1 are allowed.
   */
  poll_url: string
  /**
   * If the agent provided a callback URL in the original request, it is echoed here. Otherwise null.
   */
  callback_url?: string | null
  /**
   * Optional SSE endpoint for real-time status events.
   */
  events_url?: string
  type: AnyReviewType
  /**
   * Short description of what the human needs to decide.
   */
  prompt: string
  /**
   * Duration the review stays open. ISO 8601 duration (PT24H, P7D) or shorthand (24h, 7d). Default: 24h.
   */
  timeout?: string
  default_action?: DefaultAction
  /**
   * Timestamp when the review case was created.
   */
  created_at: string
  /**
   * Timestamp when the review case expires.
   */
  expires_at: string
  context?: HitlContext
  /**
   * When reminder(s) should be sent. Single timestamp or array of timestamps.
   */
  reminder_at?: string | string[]
  /**
   * Links to a prior case in a multi-round review chain.
   */
  previous_case_id?: string
  surface?: Surface
  /**
   * API endpoint where the agent MAY submit simple responses on behalf of the human via native messaging buttons.
   */
  submit_url?: string
  /**
   * Opaque bearer token for authenticating agent submissions via submit_url.
   */
  submit_token?: string
  /**
   * Actions permitted via submit_url without visiting review_url.
   */
  inline_actions?: string[]
  verification_policy?: VerificationPolicy
}
/**
 * Arbitrary key-value pairs providing additional context about the review.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "HitlContext".
 */
export interface HitlContext {
  form?: FormDefinition
  [k: string]: unknown
}
export interface SingleStepFormDefinition {
  /**
   * Array of form field definitions for single-step forms.
   */
  fields: FormField[]
  steps?: never
  /**
   * Optional session identifier for form state persistence. Enables resume after browser close.
   */
  session_id?: string
}
/**
 * A form field definition used in context.form for Input-type reviews, as defined by HITL Protocol v0.9
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormField".
 */
export interface FormField {
  /**
   * Unique identifier for the field. Used as key in result.data.
   */
  key: string
  /**
   * Human-readable label displayed next to the field.
   */
  label: string
  /**
   * Field type. Standard types: text, textarea, number, date, email, url, boolean, select, multiselect, range. Services MAY extend with x-prefixed custom types.
   */
  type: (FieldType | `x-${string}`) & string
  /**
   * Whether the field must be filled before submission.
   */
  required?: boolean
  /**
   * Placeholder text shown when the field is empty.
   */
  placeholder?: string
  /**
   * Help text displayed below or beside the field.
   */
  hint?: string
  /**
   * Pre-filled value. MUST NOT contain sensitive data — use default_ref instead.
   */
  default?: unknown
  /**
   * URL to securely fetch a pre-fill value. Used instead of default for sensitive data. Requires review URL token for access.
   */
  default_ref?: string
  /**
   * If true, the review page SHOULD mask the input and MUST NOT log the value.
   */
  sensitive?: boolean
  /**
   * Available choices. Required for select and multiselect types.
   */
  options?: FormFieldOption[]
  validation?: FormFieldValidation
  conditional?: FormFieldConditional
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormFieldOption".
 */
export interface FormFieldOption {
  /**
   * Machine-readable option value.
   */
  value: string
  /**
   * Human-readable option label.
   */
  label: string
}
/**
 * Validation rules for the field.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormFieldValidation".
 */
export interface FormFieldValidation {
  /**
   * Minimum character length. Applies to: text, textarea, email, url.
   */
  minLength?: number
  /**
   * Maximum character length. Applies to: text, textarea, email, url.
   */
  maxLength?: number
  /**
   * Regular expression the value must match. Applies to: text, email, url.
   */
  pattern?: string
  /**
   * Minimum value or earliest date. Applies to: number, range, date.
   */
  min?: number
  /**
   * Maximum value or latest date. Applies to: number, range, date.
   */
  max?: number
}
/**
 * Conditional visibility. When the condition is not met, the field is hidden and excluded from result.data.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormFieldConditional".
 */
export interface FormFieldConditional {
  /**
   * The key of the field this condition depends on.
   */
  field: string
  operator: ConditionalOperator
  /**
   * The value to compare against. For 'in' operator, an array of values.
   */
  value: unknown
}
export interface MultiStepFormDefinition {
  fields?: never
  /**
   * Array of wizard steps for multi-step forms.
   */
  steps: FormStep[]
  /**
   * Optional session identifier for form state persistence. Enables resume after browser close.
   */
  session_id?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "FormStep".
 */
export interface FormStep {
  /**
   * Step heading displayed in the wizard UI.
   */
  title: string
  /**
   * Subtitle or helper text for the step.
   */
  description?: string
  /**
   * Array of form field definitions for this step.
   */
  fields: FormField[]
}
/**
 * Optional declaration of the review page UI format.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "Surface".
 */
export interface Surface {
  /**
   * UI format identifier (e.g., json-render, a2ui, adaptive-cards)
   */
  format?: string
  /**
   * Version of the UI format
   */
  version?: string
  [k: string]: unknown
}
/**
 * Optional verification requirements. The core standardizes proof_of_human; profiles may define x-prefixed requirements for service-verified identity or authorization.
 */
export interface VerificationPolicy {
  mode: VerificationMode
  /**
   * Submission paths for which verification must be satisfied.
   *
   * @minItems 1
   */
  required_for: [VerificationPath, ...VerificationPath[]]
  requirements: VerificationPolicyRequirements
  binding: VerificationBinding
  fallback: VerificationFallback
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationPolicyRequirements".
 */
export interface VerificationPolicyRequirements {
  /**
   * OR-of-AND policy logic. Any option may satisfy the policy; each option requires all listed evidence requirements.
   *
   * @minItems 1
   */
  any_of: [VerificationRequirementBranch, ...VerificationRequirementBranch[]]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationRequirementBranch".
 */
export interface VerificationRequirementBranch {
  /**
   * @minItems 1
   */
  all_of: [VerificationRequirement, ...VerificationRequirement[]]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationRequirement".
 */
export interface VerificationRequirement {
  proof_type: ProofType
  /**
   * Provider identifier (for example world_id). Omit to accept any provider for the proof type.
   */
  provider?: string
  min_assurance?: AssuranceLevel
  /**
   * Optional allowed presentation formats for provider evidence.
   */
  presentation_formats?: EvidenceFormat[]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationBinding".
 */
export interface VerificationBinding {
  /**
   * Whether accepted evidence must be bound to the HITL case_id.
   */
  case_id: boolean
  /**
   * Whether accepted evidence must be bound to the submitted action.
   */
  action: boolean
  /**
   * Opaque service-generated challenge for provider-specific binding.
   */
  challenge?: string
  /**
   * Maximum age of the accepted evidence at the time of verification.
   */
  freshness_seconds: number
  /**
   * Absolute policy expiry timestamp for the verification challenge.
   */
  expires_at?: string
  /**
   * Whether equivalent evidence can only be used once for the declared case/action binding.
   */
  single_use: boolean
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationFallback".
 */
export interface VerificationFallback {
  /**
   * Fallback behavior when required evidence is missing.
   */
  on_missing: 'browser_review' | 'reject'
  /**
   * Fallback behavior when presented evidence fails verification.
   */
  on_invalid: 'browser_review' | 'reject'
}
/**
 * The human's response. Present only when status is 'completed'.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ReviewResult".
 */
export interface ReviewResult {
  /**
   * The action taken by the human.
   */
  action: string
  /**
   * Structured data from the review. Content depends on the review type.
   */
  data?: {
    [k: string]: unknown
  }
  signature?: ResultSignature
}
/**
 * Optional cryptographic signature for response integrity.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ResultSignature".
 */
export interface ResultSignature {
  /**
   * Signing algorithm (e.g., RS256).
   */
  algorithm?: string
  /**
   * Base64url-encoded signature.
   */
  value?: string
  /**
   * When the signature was created.
   */
  signed_at?: string
  /**
   * URL to the signer's JWKS endpoint.
   */
  signer?: string
}
/**
 * Optional identity of the person who submitted the response.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "RespondedBy".
 */
export interface RespondedBy {
  /**
   * Display name of the respondent.
   */
  name?: string
  /**
   * Verified email of the respondent.
   */
  email?: string
}
export interface BrowserSubmissionContext {
  mode: 'browser_submit'
  /**
   * Audit string describing the submission channel or surface.
   */
  submitted_via?: string
  /**
   * Submission origin metadata for inline-path auditability.
   */
  submitted_by?: {
    /**
     * Platform or surface identifier.
     */
    platform: string
    /**
     * Platform-specific user identifier.
     */
    platform_user_id: string
    /**
     * Human-readable display name if known.
     */
    display_name?: string
  }
  verification_result?: VerificationResult
}
/**
 * Normalized outcome of the service-side verification flow.
 */
export interface VerificationResult {
  /**
   * Whether the declared verification policy was satisfied.
   */
  satisfied: boolean
  /**
   * Normalized accepted evidence only. No provider proof material or secrets.
   */
  verified_evidence?: VerifiedEvidence[]
  /**
   * Human-readable identifiers for requirement branches that were not satisfied.
   */
  missing_requirements?: string[]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerifiedEvidence".
 */
export interface VerifiedEvidence {
  /**
   * Normalized proof type that was accepted.
   */
  proof_type: string
  /**
   * Provider that produced the accepted evidence.
   */
  provider: string
  /**
   * Service-defined assurance level after provider verification.
   */
  assurance_level?: 'low' | 'medium' | 'high'
  /**
   * Whether the service verified binding to the HITL case_id.
   */
  bound_to_case?: boolean
  /**
   * Whether the service verified binding to the submitted action.
   */
  bound_to_action?: boolean
  /**
   * Whether the evidence satisfied the service freshness window.
   */
  fresh?: boolean
  /**
   * Whether the service enforced single-use semantics for the accepted evidence.
   */
  single_use_enforced?: boolean
  /**
   * Timestamp at which the provider verification result was accepted.
   */
  verified_at?: string
}
export interface InlineSubmissionContext {
  mode: 'inline_submit'
  /**
   * Audit string describing the submission channel or surface.
   */
  submitted_via: string
  /**
   * Submission origin metadata for inline-path auditability.
   */
  submitted_by: {
    /**
     * Platform or surface identifier.
     */
    platform: string
    /**
     * Platform-specific user identifier.
     */
    platform_user_id: string
    /**
     * Human-readable display name if known.
     */
    display_name?: string
  }
  verification_result?: VerificationResult1
}
/**
 * Normalized outcome of the service-side verification flow.
 */
export interface VerificationResult1 {
  /**
   * Whether the declared verification policy was satisfied.
   */
  satisfied: boolean
  /**
   * Normalized accepted evidence only. No provider proof material or secrets.
   */
  verified_evidence?: VerifiedEvidence[]
  /**
   * Human-readable identifiers for requirement branches that were not satisfied.
   */
  missing_requirements?: string[]
}
/**
 * Optional progress tracking for multi-step Input forms.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "ReviewProgress".
 */
export interface ReviewProgress {
  /**
   * The step the human is currently on (1-indexed).
   */
  current_step?: number
  /**
   * Total number of steps in the form.
   */
  total_steps?: number
  /**
   * Number of fields the human has filled so far.
   */
  completed_fields?: number
  /**
   * Total number of required fields across all steps.
   */
  total_fields?: number
}
/**
 * Request body for agent-submitted responses via submit_url, as defined by HITL Protocol v0.9
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmitRequest".
 */
export interface SubmitRequest {
  /**
   * The action taken by the human via a native messaging button. MUST be a valid action for the review type and listed in inline_actions if specified.
   */
  action: string
  /**
   * Structured data accompanying the action. For simple inline actions, this is typically empty {}.
   */
  data?: {
    [k: string]: unknown
  }
  /**
   * Identifies the submission channel for audit purposes.
   */
  submitted_via: (SubmissionChannel | `x-${string}`) & string
  submitted_by: SubmittedBy
  /**
   * Optional opaque verification evidence relayed from a human-controlled proof flow. Services must verify it server-side.
   */
  verification_evidence?: VerificationEvidence[]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "SubmittedBy".
 */
export interface SubmittedBy {
  /**
   * Platform identifier.
   */
  platform: (SubmissionPlatform | `x-${string}`) & string
  /**
   * Platform-specific user identifier.
   */
  platform_user_id: string
  /**
   * Human-readable display name of the user who triggered the action.
   */
  display_name?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationEvidence".
 */
export interface VerificationEvidence {
  /**
   * Normative core value in v0.9 is proof_of_human.
   */
  proof_type: ('proof_of_human' | `x-${string}`) & string
  /**
   * Provider identifier for the proof presentation.
   */
  provider: string
  /**
   * Presentation format used by the provider evidence.
   */
  format: (('provider_opaque' | 'jwt' | 'zkp' | 'attestation') | `x-${string}`) & string
  /**
   * Opaque provider payload. Agents must treat this as opaque.
   */
  presentation:
    | string
    | {
        [k: string]: unknown
      }
  /**
   * Provider-agnostic binding hints relayed to the service.
   */
  binding: {
    case_id?: string
    action?: string
    challenge?: string
    [k: string]: unknown
  }
}
/**
 * Response body for GET /.well-known/hitl.json, as defined by HITL Protocol v0.9.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryResponse".
 */
export interface DiscoveryResponse {
  hitl_protocol: {
    /**
     * Protocol version supported by the service discovery document.
     */
    spec_version: '0.9'
    service?: DiscoveryServiceInfo
    capabilities?: DiscoveryCapabilities
    endpoints?: DiscoveryEndpoints
    authentication?: DiscoveryAuthentication
    rate_limits?: DiscoveryRateLimits
    policies?: DiscoveryPolicies
    examples?: DiscoveryExamples
  }
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryServiceInfo".
 */
export interface DiscoveryServiceInfo {
  name?: string
  description?: string
  url?: string
  logo_url?: string
  contact?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryCapabilities".
 */
export interface DiscoveryCapabilities {
  review_types?: string[]
  transports?: ('polling' | 'sse' | 'callback')[]
  max_timeout?: string
  default_timeout?: string
  supports_reminders?: boolean
  supports_multi_round?: boolean
  supports_signatures?: boolean
  supports_inline_submit?: boolean
  /**
   * Whether the service can bind review execution to the initiating agent or host via an external auth/control-plane profile.
   */
  supports_agent_binding?: boolean
  /**
   * Whether the service publishes optional declarative surface payloads via a separate interop profile in addition to the required review_url fallback.
   */
  supports_surface?: boolean
  /**
   * Declarative UI surface formats the service may publish via optional interop profiles.
   */
  surface_formats?: string[]
  /**
   * Optional surface interop profiles supported by the service.
   */
  surface_profiles?: string[]
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryEndpoints".
 */
export interface DiscoveryEndpoints {
  reviews_base?: string
  review_page_base?: string
  events_base?: string
  well_known?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryAuthentication".
 */
export interface DiscoveryAuthentication {
  type?: string
  token_url?: string
  scopes?: string[]
  /**
   * External authentication or agent-binding profiles the service composes with HITL.
   */
  profiles?: string[]
  /**
   * Optional well-known endpoint for an external auth or agent-binding control plane.
   */
  well_known?: string
  /**
   * Documentation for the service's external auth or agent-binding model.
   */
  documentation?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryRateLimits".
 */
export interface DiscoveryRateLimits {
  poll_min_interval_seconds?: number
  poll_recommended_interval_seconds?: number
  max_active_cases_per_agent?: number
  max_requests_per_minute?: number
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryPolicies".
 */
export interface DiscoveryPolicies {
  data_retention_days?: number
  expired_case_retention_days?: number
  privacy_policy?: string
  terms_of_service?: string
}
/**
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "DiscoveryExamples".
 */
export interface DiscoveryExamples {
  documentation?: string
  openapi?: string
}
/**
 * Optional verification policy for HITL Protocol v0.9. Defines when proof_of_human evidence is required and how it must be bound.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationPolicy".
 */
export interface VerificationPolicy1 {
  mode: VerificationMode
  /**
   * Submission paths for which verification must be satisfied.
   *
   * @minItems 1
   */
  required_for: [VerificationPath, ...VerificationPath[]]
  requirements: VerificationPolicyRequirements
  binding: VerificationBinding
  fallback: VerificationFallback
}
/**
 * Normalized verification outcome for HITL Protocol v0.9. Raw provider payloads must not be returned here.
 *
 * This interface was referenced by `ProtocolTypeCatalog`'s JSON-Schema
 * via the `definition` "VerificationResult".
 */
export interface VerificationResult2 {
  /**
   * Whether the declared verification policy was satisfied.
   */
  satisfied: boolean
  /**
   * Normalized accepted evidence only. No provider proof material or secrets.
   */
  verified_evidence?: VerifiedEvidence[]
  /**
   * Human-readable identifiers for requirement branches that were not satisfied.
   */
  missing_requirements?: string[]
}
