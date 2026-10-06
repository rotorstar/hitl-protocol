import rawHitlObjectSchema from '../schemas/v0.8/hitl-object.schema.json' with { type: 'json' }
import rawPollResponseSchema from '../schemas/v0.8/poll-response.schema.json' with { type: 'json' }
import rawFormFieldSchema from '../schemas/v0.8/form-field.schema.json' with { type: 'json' }
import rawSubmitRequestSchema from '../schemas/v0.8/submit-request.schema.json' with { type: 'json' }
import rawDiscoveryResponseSchema from '../schemas/v0.8/discovery-response.schema.json' with { type: 'json' }
import rawVerificationPolicySchema from '../schemas/v0.8/verification-policy.schema.json' with { type: 'json' }
import rawVerificationResultSchema from '../schemas/v0.8/verification-result.schema.json' with { type: 'json' }
import rawSubmissionContextSchema from '../schemas/v0.8/submission-context.schema.json' with { type: 'json' }

/** Export values so declaration emission derives each raw schema without runtime JSON imports. */
export const hitlObjectSchema = rawHitlObjectSchema
export const pollResponseSchema = rawPollResponseSchema
export const formFieldSchema = rawFormFieldSchema
export const submitRequestSchema = rawSubmitRequestSchema
export const discoveryResponseSchema = rawDiscoveryResponseSchema
export const verificationPolicySchema = rawVerificationPolicySchema
export const verificationResultSchema = rawVerificationResultSchema
export const submissionContextSchema = rawSubmissionContextSchema
