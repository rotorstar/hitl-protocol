import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateHitlObject,
  validatePollResponse,
  validateFormField,
  validateSubmitRequest,
  validateDiscoveryResponse,
  validateVerificationPolicy,
  validateVerificationResult,
  validateSubmissionContext,
  hitlObjectSchema,
  pollResponseSchema,
  formFieldSchema,
  submitRequestSchema,
  discoveryResponseSchema,
  verificationPolicySchema,
  verificationResultSchema,
  submissionContextSchema,
} from './index.js'

import type {
  HitlObject,
  PollResponse,
  FormField,
  SubmitRequest,
  DiscoveryResponse,
  ReviewStatus,
  ReviewType,
  ProofType,
  VerificationPolicy,
  VerificationResult,
  SubmissionContext,
} from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXAMPLES_DIR = join(__dirname, '..', '..', '..', 'examples')

function collectSubmitRequests(example: Record<string, unknown>) {
  const requests: unknown[] = []

  for (const step of (example.steps as Array<Record<string, unknown>> | undefined) ?? []) {
    const request = step.request as Record<string, unknown> | undefined
    if (typeof request?.url === 'string' && request.url.includes('/submit')) {
      requests.push(request.body)
    }

    const alternativeRequest = step.alternative_request as Record<string, unknown> | undefined
    if (
      typeof alternativeRequest?.url === 'string' &&
      alternativeRequest.url.includes('/submit')
    ) {
      requests.push(alternativeRequest.body)
    }
  }

  return requests.filter(Boolean)
}

describe('Schema exports', () => {
  it('exports all core schemas', () => {
    expect(hitlObjectSchema.$id).toContain('hitl-object')
    expect(pollResponseSchema.$id).toContain('poll-response')
    expect(formFieldSchema.$id).toContain('form-field')
    expect(submitRequestSchema.$id).toContain('submit-request')
    expect(discoveryResponseSchema.$id).toContain('discovery-response')
  })

  it('exports verification-related schemas', () => {
    expect(verificationPolicySchema.title).toBe('Verification Policy')
    expect(verificationResultSchema.title).toBe('Verification Result')
    expect(submissionContextSchema.title).toBe('Submission Context')
  })
})

describe('validateHitlObject', () => {
  it('validates a minimal v0.8 hitl object', () => {
    const obj: HitlObject = {
      spec_version: '0.8',
      case_id: 'review_test123',
      review_url: 'https://example.com/review/test123?token=abc',
      poll_url: 'https://example.com/api/reviews/test123/status',
      type: 'approval',
      prompt: 'Review this deployment',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
    }
    expect(validateHitlObject(obj)).toBe(true)
  })

  it('validates hitl object with verification_policy', () => {
    const obj: HitlObject = {
      spec_version: '0.8',
      case_id: 'review_inline',
      review_url: 'https://example.com/review/inline?token=abc',
      poll_url: 'https://example.com/api/reviews/inline/status',
      type: 'confirmation',
      prompt: 'Confirm sending emails',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
      submit_url: 'https://example.com/reviews/inline/respond',
      submit_token: 'abcdefghijklmnopqrstuvwxyz012345678',
      inline_actions: ['confirm', 'cancel'],
      verification_policy: {
        mode: 'required',
        required_for: ['inline_submit'],
        requirements: {
          any_of: [
            {
              all_of: [
                {
                  proof_type: 'proof_of_human',
                  provider: 'world_id',
                  min_assurance: 'high',
                },
              ],
            },
          ],
        },
        binding: {
          case_id: true,
          action: true,
          challenge: 'opaque-nonce',
          freshness_seconds: 300,
          single_use: true,
        },
        fallback: {
          on_missing: 'browser_review',
          on_invalid: 'browser_review',
        },
      },
    }
    expect(validateHitlObject(obj)).toBe(true)
  })

  it('rejects invalid spec_version', () => {
    expect(
      validateHitlObject({
        spec_version: '1.0',
        case_id: 'review_old',
        review_url: 'https://example.com/review/old?token=abc',
        poll_url: 'https://example.com/api/reviews/old/status',
        type: 'approval',
        prompt: 'Test',
        created_at: '2026-02-23T10:00:00Z',
        expires_at: '2026-02-24T10:00:00Z',
      })
    ).toBe(false)
  })
})

describe('validatePollResponse', () => {
  it('validates a completed poll response with submission_context', () => {
    const res: PollResponse = {
      status: 'completed',
      case_id: 'review_test123',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
      result: {
        action: 'approve',
        data: { comment: 'Looks good' },
      },
      responded_by: { name: 'Alice', email: 'alice@example.com' },
      submission_context: {
        mode: 'browser_submit',
        verification_result: {
          satisfied: true,
          verified_evidence: [
            {
              proof_type: 'proof_of_human',
              provider: 'world_id',
              assurance_level: 'high',
              bound_to_case: true,
              bound_to_action: true,
              fresh: true,
              single_use_enforced: true,
            },
          ],
          missing_requirements: [],
        },
      },
      completed_at: '2026-02-23T11:00:00Z',
    }
    expect(validatePollResponse(res)).toBe(true)
  })

  it('rejects completed without result/completed_at', () => {
    expect(validatePollResponse({ status: 'completed', case_id: 'test' })).toBe(false)
  })
})

describe('validateFormField', () => {
  it('validates a simple text field', () => {
    const field: FormField = {
      key: 'name',
      label: 'Full Name',
      type: 'text',
      required: true,
    }
    expect(validateFormField(field)).toBe(true)
  })
})

describe('validation helpers', () => {
  it('validates verification policy', () => {
    const policy: VerificationPolicy = {
      mode: 'required',
      required_for: ['inline_submit'],
      requirements: {
        any_of: [
          {
            all_of: [{ proof_type: 'proof_of_human', provider: 'world_id' }],
          },
        ],
      },
      binding: {
        case_id: true,
        action: true,
        freshness_seconds: 300,
        single_use: true,
      },
      fallback: {
        on_missing: 'browser_review',
        on_invalid: 'browser_review',
      },
    }
    expect(validateVerificationPolicy(policy)).toBe(true)
  })

  it('validates normalized verification result', () => {
    const result: VerificationResult = {
      satisfied: true,
      verified_evidence: [
        {
          proof_type: 'proof_of_human',
          provider: 'world_id',
          assurance_level: 'high',
          bound_to_case: true,
          bound_to_action: true,
          fresh: true,
          single_use_enforced: true,
        },
      ],
      missing_requirements: [],
    }
    expect(validateVerificationResult(result)).toBe(true)
  })

  it('validates submission context', () => {
    const context: SubmissionContext = {
      mode: 'inline_submit',
      submitted_via: 'telegram_inline_button',
      submitted_by: {
        platform: 'telegram',
        platform_user_id: '12345',
      },
    }
    expect(validateSubmissionContext(context)).toBe(true)
  })
})

describe('validateSubmitRequest', () => {
  it('validates a telegram inline submit with proof_of_human evidence', () => {
    const req: SubmitRequest = {
      action: 'confirm',
      submitted_via: 'telegram_inline_button',
      submitted_by: {
        platform: 'telegram',
        platform_user_id: '12345',
        display_name: 'Alice',
      },
      verification_evidence: [
        {
          proof_type: 'proof_of_human',
          provider: 'world_id',
          format: 'provider_opaque',
          presentation: { proof: '<opaque>' },
          binding: {
            case_id: 'review_42',
            action: 'confirm',
            challenge: 'opaque-nonce',
          },
        },
      ],
    }
    expect(validateSubmitRequest(req)).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(validateSubmitRequest({ action: 'confirm' })).toBe(false)
  })
})

describe('validateDiscoveryResponse', () => {
  it('validates a discovery response with external auth composition metadata', () => {
    const res: DiscoveryResponse = {
      hitl_protocol: {
        spec_version: '0.8',
        capabilities: {
          review_types: ['selection', 'approval'],
          transports: ['polling', 'sse'],
          supports_inline_submit: true,
          supports_agent_binding: true,
        },
        authentication: {
          type: 'bearer',
          documentation: 'https://example.com/docs/agent-auth',
          well_known: 'https://example.com/.well-known/agent-configuration',
          profiles: ['agent-auth/external'],
        },
        endpoints: {
          reviews_base: 'https://api.example.com/v1/reviews',
          review_page_base: 'https://service.example.com/review',
        },
      },
    }
    expect(validateDiscoveryResponse(res)).toBe(true)
  })
})

describe('Example file validation', () => {
  let exampleFiles: string[] = []

  try {
    exampleFiles = readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith('.json'))
  } catch {
    exampleFiles = []
  }

  if (exampleFiles.length === 0) {
    it.skip('no example files found', () => {})
    return
  }

  for (const file of exampleFiles) {
    const content = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'))

    if (file === '07-well-known-hitl.json') {
      it(`${file} - discovery response`, () => {
        expect(validateDiscoveryResponse(content.response.body)).toBe(true)
      })
      continue
    }

    const steps = content.steps ?? []

    for (const step of steps) {
      if (step.response?.body?.hitl) {
        it(`${file} — hitl object in ${step.description ?? 'step'}`, () => {
          expect(validateHitlObject(step.response.body.hitl)).toBe(true)
        })
      }

      const isPollStep =
        typeof step.request?.url === 'string' && step.request.url.includes('/status')
      if (isPollStep && step.response?.body?.status && step.response?.body?.case_id) {
        it(`${file} — poll response in ${step.description ?? 'step'}`, () => {
          expect(validatePollResponse(step.response.body)).toBe(true)
        })
      }
    }

    for (const requestBody of collectSubmitRequests(content)) {
      it(`${file} — submit request validates`, () => {
        expect(validateSubmitRequest(requestBody)).toBe(true)
      })
    }
  }
})

describe('Type compatibility', () => {
  it('ReviewType includes all 5 standard types', () => {
    const types: ReviewType[] = [
      'approval',
      'selection',
      'input',
      'confirmation',
      'escalation',
    ]
    expect(types).toHaveLength(5)
  })

  it('ReviewStatus includes all 6 states', () => {
    const statuses: ReviewStatus[] = [
      'pending',
      'opened',
      'in_progress',
      'completed',
      'expired',
      'cancelled',
    ]
    expect(statuses).toHaveLength(6)
  })

  it('ProofType supports the normative core value and extensions', () => {
    const proofs: ProofType[] = ['proof_of_human', 'x-custom-proof']
    expect(proofs).toHaveLength(2)
  })
})
