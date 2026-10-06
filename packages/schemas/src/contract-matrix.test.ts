/** One fixture matrix is consumed unchanged by Node and Python. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as v08 from './v0.8.js'
import * as v09 from './v0.9.js'
import { validateSupportedHitlObject, validateSupportedDiscoveryResponse } from './index.js'

const validators = {
  '0.8': {
    'hitl-object': v08.validateHitlObject, 'poll-response': v08.validatePollResponse,
    'submit-request': v08.validateSubmitRequest, 'discovery-response': v08.validateDiscoveryResponse,
    'form-field': v08.validateFormField, 'verification-policy': v08.validateVerificationPolicy,
    'verification-result': v08.validateVerificationResult, 'submission-context': v08.validateSubmissionContext,
  },
  '0.9': {
    'hitl-object': v09.validateHitlObject, 'poll-response': v09.validatePollResponse,
    'submit-request': v09.validateSubmitRequest, 'discovery-response': v09.validateDiscoveryResponse,
    'form-field': v09.validateFormField, 'verification-policy': v09.validateVerificationPolicy,
    'verification-result': v09.validateVerificationResult, 'submission-context': v09.validateSubmissionContext,
  },
}
type Contract = keyof typeof validators['0.8']
interface ContractCase {
  id: string
  version: keyof typeof validators | 'supported'
  schema: Contract
  input: unknown
  valid: boolean
}
const matrix: { format_version: number; cases: ContractCase[] } = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/contracts.json', import.meta.url), 'utf8'),
)

describe('E1 shared Node/Python canonical contract matrix', () => {
  it('covers both outcomes of all eight schemas in both explicit versions', () => {
    expect(matrix.format_version).toBe(1)
    expect(new Set(matrix.cases.map((entry) => entry.id)).size).toBe(matrix.cases.length)
    for (const version of ['0.8', '0.9'] as const) {
      for (const schema of Object.keys(validators[version])) {
        for (const valid of [true, false]) {
          expect(matrix.cases.some((entry) => entry.version === version && entry.schema === schema && entry.valid === valid),
            `${version}/${schema} lacks an expected ${valid} outcome`).toBe(true)
        }
      }
    }
  })

  it.each(matrix.cases)('$id', ({ version, schema, input, valid }) => {
    const validator = version === 'supported'
      ? schema === 'hitl-object' ? validateSupportedHitlObject
        : schema === 'discovery-response' ? validateSupportedDiscoveryResponse
          : undefined
      : validators[version][schema]
    if (!validator) throw new Error(`No validator for ${version}/${schema}`)
    expect(validator(input), JSON.stringify(validator.errors)).toBe(valid)
  })
})
