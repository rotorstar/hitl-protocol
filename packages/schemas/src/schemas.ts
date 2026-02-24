/**
 * Raw JSON Schema objects for HITL Protocol v0.7.
 *
 * These are re-exported from the canonical schema files in schemas/.
 * Use these when you need the raw schema for custom AJV configuration
 * or other JSON Schema tooling.
 */

import hitlObjectSchema from '../schemas/hitl-object.schema.json'
import pollResponseSchema from '../schemas/poll-response.schema.json'
import formFieldSchema from '../schemas/form-field.schema.json'
import submitRequestSchema from '../schemas/submit-request.schema.json'

export {
  hitlObjectSchema,
  pollResponseSchema,
  formFieldSchema,
  submitRequestSchema,
}
