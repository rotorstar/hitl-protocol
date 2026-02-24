/**
 * @hitl-protocol/schemas
 *
 * JSON Schemas, TypeScript types, and validators for HITL Protocol v0.7.
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

  // HITL Object
  HitlObject,
  HitlContext,
  Surface,

  // Poll Response
  PollResponse,
  ReviewResult,
  ResultSignature,
  RespondedBy,
  ReviewProgress,

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
} from './schemas.js'

// Validators
export {
  validateHitlObject,
  validatePollResponse,
  validateFormField,
  validateSubmitRequest,
} from './validate.js'
