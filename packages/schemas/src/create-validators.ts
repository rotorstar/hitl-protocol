import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export interface WireTypes {
  HitlObject: unknown
  PollResponse: unknown
  FormField: unknown
  SubmitRequest: unknown
  DiscoveryResponse: unknown
  VerificationPolicy: unknown
  VerificationResult: unknown
  SubmissionContext: unknown
}
type SchemaName = 'hitlObjectSchema' | 'pollResponseSchema' | 'formFieldSchema' | 'submitRequestSchema' | 'discoveryResponseSchema' | 'verificationPolicySchema' | 'verificationResultSchema' | 'submissionContextSchema'

/** Each wire version owns its AJV registry, avoiding historical alias collisions. */
export function createValidators<T extends WireTypes>(schemas: Record<SchemaName, object>) {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  for (const schema of Object.values(schemas)) ajv.addSchema(schema)
  return {
    validateHitlObject: ajv.compile<T['HitlObject']>(schemas.hitlObjectSchema),
    validatePollResponse: ajv.compile<T['PollResponse']>(schemas.pollResponseSchema),
    validateFormField: ajv.compile<T['FormField']>(schemas.formFieldSchema),
    validateSubmitRequest: ajv.compile<T['SubmitRequest']>(schemas.submitRequestSchema),
    validateDiscoveryResponse: ajv.compile<T['DiscoveryResponse']>(schemas.discoveryResponseSchema),
    validateVerificationPolicy: ajv.compile<T['VerificationPolicy']>(schemas.verificationPolicySchema),
    validateVerificationResult: ajv.compile<T['VerificationResult']>(schemas.verificationResultSchema),
    validateSubmissionContext: ajv.compile<T['SubmissionContext']>(schemas.submissionContextSchema),
  }
}
