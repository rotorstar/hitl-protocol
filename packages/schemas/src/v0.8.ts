export type * from './generated/v0.8.js'
export * from './schemas-v0.8.js'

import type { HitlObject, PollResponse, FormField, SubmitRequest, DiscoveryResponse, VerificationPolicy, VerificationResult, SubmissionContext } from './generated/v0.8.js'
import * as schemas from './schemas-v0.8.js'
import { createValidators } from './create-validators.js'

export const { validateHitlObject, validatePollResponse, validateFormField, validateSubmitRequest, validateDiscoveryResponse, validateVerificationPolicy, validateVerificationResult, validateSubmissionContext } = createValidators<{ HitlObject: HitlObject; PollResponse: PollResponse; FormField: FormField; SubmitRequest: SubmitRequest; DiscoveryResponse: DiscoveryResponse; VerificationPolicy: VerificationPolicy; VerificationResult: VerificationResult; SubmissionContext: SubmissionContext }>(schemas)
