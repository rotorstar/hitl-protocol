import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateHitlObject,
  validatePollResponse,
  validateFormField,
  validateSubmitRequest,
  hitlObjectSchema,
  pollResponseSchema,
  formFieldSchema,
  submitRequestSchema,
} from './index.js'

import type {
  HitlObject,
  PollResponse,
  FormField,
  SubmitRequest,
  ReviewStatus,
  ReviewType,
} from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXAMPLES_DIR = join(__dirname, '..', '..', '..', 'examples')

// ---------------------------------------------------------------------------
// Schema Exports
// ---------------------------------------------------------------------------

describe('Schema exports', () => {
  it('exports hitlObjectSchema with correct $id', () => {
    expect(hitlObjectSchema.$id).toContain('hitl-object')
    expect(hitlObjectSchema.title).toBe('HITL Object')
  })

  it('exports pollResponseSchema with correct $id', () => {
    expect(pollResponseSchema.$id).toContain('poll-response')
    expect(pollResponseSchema.title).toBe('HITL Poll Response')
  })

  it('exports formFieldSchema with correct $id', () => {
    expect(formFieldSchema.$id).toContain('form-field')
    expect(formFieldSchema.title).toBe('HITL Form Field')
  })

  it('exports submitRequestSchema with correct $id', () => {
    expect(submitRequestSchema.$id).toContain('submit-request')
    expect(submitRequestSchema.title).toBe('Inline Submit Request')
  })
})

// ---------------------------------------------------------------------------
// Validator: HitlObject
// ---------------------------------------------------------------------------

describe('validateHitlObject', () => {
  it('validates a minimal valid hitl object', () => {
    const obj: HitlObject = {
      spec_version: '0.7',
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

  it('validates hitl object with inline submit fields', () => {
    const obj: HitlObject = {
      spec_version: '0.7',
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
    }
    expect(validateHitlObject(obj)).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(validateHitlObject({})).toBe(false)
    expect(validateHitlObject.errors).toBeDefined()
  })

  it('rejects submit_url without submit_token', () => {
    const obj = {
      spec_version: '0.7',
      case_id: 'review_bad',
      review_url: 'https://example.com/review/bad?token=abc',
      poll_url: 'https://example.com/api/reviews/bad/status',
      type: 'confirmation',
      prompt: 'Test',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
      submit_url: 'https://example.com/reviews/bad/respond',
      // submit_token missing — should fail dependentRequired
    }
    expect(validateHitlObject(obj)).toBe(false)
  })

  it('rejects invalid spec_version', () => {
    const obj = {
      spec_version: '1.0',
      case_id: 'review_old',
      review_url: 'https://example.com/review/old?token=abc',
      poll_url: 'https://example.com/api/reviews/old/status',
      type: 'approval',
      prompt: 'Test',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
    }
    expect(validateHitlObject(obj)).toBe(false)
  })

  it('rejects non-HTTPS URLs for non-local hosts', () => {
    const obj = {
      spec_version: '0.7',
      case_id: 'review_http',
      review_url: 'http://example.com/review/http?token=abc',
      poll_url: 'http://api.example.com/reviews/http/status',
      type: 'approval',
      prompt: 'Test',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
    }
    expect(validateHitlObject(obj)).toBe(false)
  })

  it('allows http://localhost for local development', () => {
    const obj: HitlObject = {
      spec_version: '0.7',
      case_id: 'review_local',
      review_url: 'http://localhost:3456/review/local?token=abc',
      poll_url: 'http://localhost:3456/api/reviews/local/status',
      type: 'approval',
      prompt: 'Test',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
    }
    expect(validateHitlObject(obj)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Validator: PollResponse
// ---------------------------------------------------------------------------

describe('validatePollResponse', () => {
  it('validates a pending poll response', () => {
    const res: PollResponse = {
      status: 'pending',
      case_id: 'review_test123',
      created_at: '2026-02-23T10:00:00Z',
      expires_at: '2026-02-24T10:00:00Z',
    }
    expect(validatePollResponse(res)).toBe(true)
  })

  it('validates a completed poll response with result', () => {
    const res: PollResponse = {
      status: 'completed',
      case_id: 'review_test123',
      result: {
        action: 'approve',
        data: { comment: 'Looks good' },
      },
      responded_by: { name: 'Alice', email: 'alice@example.com' },
      completed_at: '2026-02-23T11:00:00Z',
    }
    expect(validatePollResponse(res)).toBe(true)
  })

  it('rejects missing status', () => {
    expect(validatePollResponse({ case_id: 'test' })).toBe(false)
  })

  it('rejects invalid status', () => {
    expect(
      validatePollResponse({ status: 'invalid', case_id: 'test' })
    ).toBe(false)
  })

  it('rejects completed without result/completed_at', () => {
    expect(
      validatePollResponse({ status: 'completed', case_id: 'test' })
    ).toBe(false)
  })

  it('rejects expired without default_action/expired_at', () => {
    expect(
      validatePollResponse({ status: 'expired', case_id: 'test' })
    ).toBe(false)
  })

  it('rejects cancelled without cancelled_at', () => {
    expect(
      validatePollResponse({ status: 'cancelled', case_id: 'test' })
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Validator: FormField
// ---------------------------------------------------------------------------

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

  it('validates a select field with options', () => {
    const field: FormField = {
      key: 'department',
      label: 'Department',
      type: 'select',
      options: [
        { value: 'eng', label: 'Engineering' },
        { value: 'sales', label: 'Sales' },
      ],
    }
    expect(validateFormField(field)).toBe(true)
  })

  it('validates a field with conditional visibility', () => {
    const field: FormField = {
      key: 'visa_details',
      label: 'Visa Details',
      type: 'text',
      conditional: { field: 'work_auth', operator: 'eq', value: 'visa' },
    }
    expect(validateFormField(field)).toBe(true)
  })

  it('rejects missing key', () => {
    expect(validateFormField({ label: 'Test', type: 'text' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Validator: SubmitRequest
// ---------------------------------------------------------------------------

describe('validateSubmitRequest', () => {
  it('validates a telegram inline submit', () => {
    const req: SubmitRequest = {
      action: 'confirm',
      submitted_via: 'telegram_inline_button',
      submitted_by: {
        platform: 'telegram',
        platform_user_id: '12345',
        display_name: 'Alice',
      },
    }
    expect(validateSubmitRequest(req)).toBe(true)
  })

  it('validates a custom platform submit', () => {
    const req: SubmitRequest = {
      action: 'approve',
      submitted_via: 'x-custom-bot',
      submitted_by: {
        platform: 'x-custom',
        platform_user_id: 'user_42',
      },
    }
    expect(validateSubmitRequest(req)).toBe(true)
  })

  it('rejects missing required fields', () => {
    expect(validateSubmitRequest({ action: 'confirm' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Example File Validation
// ---------------------------------------------------------------------------

describe('Example files validation', () => {
  let exampleFiles: string[] = []

  try {
    exampleFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    // Examples dir may not exist in CI
  }

  if (exampleFiles.length === 0) {
    it.skip('no example files found', () => {})
    return
  }

  for (const file of exampleFiles) {
    const content = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'))
    const steps = content.steps ?? []

    for (const step of steps) {
      // Validate HITL objects in responses
      if (step.response?.body?.hitl) {
        it(`${file} — hitl object in ${step.description ?? 'step'}`, () => {
          expect(validateHitlObject(step.response.body.hitl)).toBe(true)
        })
      }

      // Validate poll responses
      const isPollStep =
        typeof step.request?.url === 'string' && step.request.url.includes('/status')
      if (isPollStep && step.response?.body?.status && step.response?.body?.case_id) {
        it(`${file} — poll response in ${step.description ?? 'step'}`, () => {
          expect(validatePollResponse(step.response.body)).toBe(true)
        })
      }
    }
  }
})

// ---------------------------------------------------------------------------
// Type-only tests (compile-time verification)
// ---------------------------------------------------------------------------

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
})
