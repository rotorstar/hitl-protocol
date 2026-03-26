/**
 * Pre-compiled AJV validators for HITL Protocol v0.8 schemas.
 *
 * Each validator returns true/false and exposes errors via .errors property.
 *
 * @example
 * ```typescript
 * import { validateHitlObject } from '@hitl-protocol/schemas'
 *
 * const data = { spec_version: '0.8', case_id: 'review_abc', ... }
 * if (validateHitlObject(data)) {
 *   // data is valid HitlObject
 * } else {
 *   console.error(validateHitlObject.errors)
 * }
 * ```
 */

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import hitlObjectSchema from '../schemas/hitl-object.schema.json'
import pollResponseSchema from '../schemas/poll-response.schema.json'
import formFieldSchema from '../schemas/form-field.schema.json'
import submitRequestSchema from '../schemas/submit-request.schema.json'
import discoveryResponseSchema from '../schemas/discovery-response.schema.json'
import verificationPolicySchema from '../schemas/verification-policy.schema.json'
import verificationResultSchema from '../schemas/verification-result.schema.json'
import submissionContextSchema from '../schemas/submission-context.schema.json'

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)

// Register referenced schemas so local $ref resolution works for published package consumers.
ajv.addSchema(formFieldSchema)
ajv.addSchema(formFieldSchema, 'form-field.json')
ajv.addSchema(verificationPolicySchema)
ajv.addSchema(verificationPolicySchema, 'verification-policy.schema.json')
ajv.addSchema(verificationResultSchema)
ajv.addSchema(verificationResultSchema, 'verification-result.schema.json')
ajv.addSchema(submissionContextSchema)
ajv.addSchema(submissionContextSchema, 'submission-context.schema.json')

/** Validate a HITL object (HTTP 202 response body). */
export const validateHitlObject = ajv.compile(hitlObjectSchema)

/** Validate a poll response. */
export const validatePollResponse = ajv.compile(pollResponseSchema)

/** Validate a form field definition. */
export const validateFormField = ajv.compile(formFieldSchema)

/** Validate an inline submit request body. */
export const validateSubmitRequest = ajv.compile(submitRequestSchema)

/** Validate a discovery response body (/.well-known/hitl.json). */
export const validateDiscoveryResponse = ajv.compile(discoveryResponseSchema)

/** Validate a verification policy. */
export const validateVerificationPolicy = ajv.compile(verificationPolicySchema)

/** Validate a normalized verification result. */
export const validateVerificationResult = ajv.compile(verificationResultSchema)

/** Validate a completed poll submission context. */
export const validateSubmissionContext = ajv.compile(submissionContextSchema)
