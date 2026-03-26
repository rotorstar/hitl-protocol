/**
 * @hitl-protocol/schemas
 *
 * JSON Schemas, TypeScript types, and validators for HITL Protocol v0.8.
 *
 * @example
 * ```typescript
 * // Import types
 * import type { HitlObject, PollResponse } from '@hitl-protocol/schemas'
 *
 * // Import validators
 * import { validateHitlObject, validatePollResponse } from '@hitl-protocol/schemas'
 *
 * // Import raw JSON schemas
 * import { hitlObjectSchema } from '@hitl-protocol/schemas'
 * ```
 */

// Types
export type {
  // Core types
  ReviewType,
  CustomReviewType,
  AnyReviewType,
  ReviewStatus,
  DefaultAction,
  ProofType,
  AssuranceLevel,
  VerificationMode,
  VerificationPath,
  SubmissionMode,
  EvidenceFormat,

  // HITL Object
  HitlObject,
  HitlContext,
  Surface,
  VerificationRequirement,
  VerificationRequirementBranch,
  VerificationPolicyRequirements,
  VerificationBinding,
  VerificationFallback,
  VerificationPolicy,
  DiscoveryResponse,
  DiscoveryServiceInfo,
  DiscoveryCapabilities,
  DiscoveryEndpoints,
  DiscoveryAuthentication,
  DiscoveryRateLimits,
  DiscoveryPolicies,
  DiscoveryExamples,

  // Poll Response
  PollResponse,
  ReviewResult,
  ResultSignature,
  RespondedBy,
  ReviewProgress,
  VerificationEvidence,
  VerifiedEvidence,
  VerificationResult,
  SubmissionContext,

  // Form Fields
  FormField,
  FormStep,
  FormDefinition,
  FormFieldOption,
  FormFieldValidation,
  FormFieldConditional,
  FieldType,
  ConditionalOperator,

  // Inline Submit
  SubmitRequest,
  SubmittedBy,
  SubmissionChannel,
  SubmissionPlatform,
} from './types.js'

// Raw JSON Schemas
export {
  hitlObjectSchema,
  pollResponseSchema,
  formFieldSchema,
  submitRequestSchema,
  discoveryResponseSchema,
  verificationPolicySchema,
  verificationResultSchema,
  submissionContextSchema,
} from './schemas.js'

// Validators
export {
  validateHitlObject,
  validatePollResponse,
  validateFormField,
  validateSubmitRequest,
  validateDiscoveryResponse,
  validateVerificationPolicy,
  validateVerificationResult,
  validateSubmissionContext,
} from './validate.js'
