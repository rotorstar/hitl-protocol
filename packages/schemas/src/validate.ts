/**
 * Pre-compiled AJV validators for HITL Protocol v0.7 schemas.
 *
 * Each validator returns true/false and exposes errors via .errors property.
 *
 * @example
 * ```typescript
 * import { validateHitlObject } from '@hitl-protocol/schemas'
 *
 * const data = { spec_version: '0.7', case_id: 'review_abc', ... }
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

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)

// Register form-field schema so $ref resolution works for hitl-object
ajv.addSchema(formFieldSchema)

/** Validate a HITL object (HTTP 202 response body). */
export const validateHitlObject = ajv.compile(hitlObjectSchema)

/** Validate a poll response. */
export const validatePollResponse = ajv.compile(pollResponseSchema)

/** Validate a form field definition. */
export const validateFormField = ajv.compile(formFieldSchema)

/** Validate an inline submit request body. */
export const validateSubmitRequest = ajv.compile(submitRequestSchema)
