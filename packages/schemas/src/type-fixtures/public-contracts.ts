/** tsc checks these observable public contracts; this file is never published. */
import type { HitlObject, PollResponse, SubmissionContext, FormDefinition, CustomReviewType, ProofType, EvidenceFormat } from '../index.js'
import type { HitlObject as HistoricalHitlObject } from '../v0.8.js'
import { validateHitlObject, validateSupportedHitlObject } from '../index.js'

const completed: PollResponse = { status: 'completed', case_id: '1', completed_at: '2026-10-06T00:00:00Z', result: { action: 'confirm' } }
// @ts-expect-error default actions use the same canonical vocabulary as HITL objects
const invalidDefault: PollResponse = { status: 'expired', case_id: '1', expired_at: '2026-10-06T00:00:00Z', default_action: 'cancel' }
const browser: SubmissionContext = { mode: 'browser_submit' }
const inline: SubmissionContext = { mode: 'inline_submit', submitted_via: 'x-browser', submitted_by: { platform: 'x-browser', platform_user_id: '1' } }
const fields: FormDefinition = { fields: [] }
const steps: FormDefinition = { steps: [] }
const custom: CustomReviewType = 'x-custom'
const proof: ProofType = 'x-reviewer-session'
const format: EvidenceFormat = 'x-service-session'
// @ts-expect-error completed responses guarantee both result and completed_at
const missingResult: PollResponse = { status: 'completed', case_id: '1', completed_at: '2026-10-06T00:00:00Z' }
// @ts-expect-error inline context guarantees submission origin
const missingOrigin: SubmissionContext = { mode: 'inline_submit' }
// @ts-expect-error form layouts are exclusive
const bothLayouts: FormDefinition = { fields: [], steps: [] }
// @ts-expect-error an empty form has no chosen layout
const noLayout: FormDefinition = {}
// @ts-expect-error extensions must have the canonical x-prefix
const invalidCustom: CustomReviewType = 'custom'
// @ts-expect-error proof extensions must have the canonical x-prefix
const invalidProof: ProofType = 'custom'
// @ts-expect-error evidence format extensions must have the canonical x-prefix
const invalidFormat: EvidenceFormat = 'custom'

export function checkNarrowing(data: unknown) {
  if (validateHitlObject(data)) {
    const current: HitlObject = data
    const version: '0.9' = current.spec_version
    void version
  }
  if (validateSupportedHitlObject(data)) {
    if (data.spec_version === '0.8') {
      const historical: HistoricalHitlObject = data
      void historical
    }
    // @ts-expect-error supported validation does not guarantee v0.9
    const current: HitlObject = data
    void current
  }
  if (completed.status === 'completed') completed.result.action.toUpperCase()
}
void [completed, invalidDefault, browser, inline, fields, steps, custom, proof, format, missingResult, missingOrigin, bothLayouts, noLayout, invalidCustom, invalidProof, invalidFormat]
