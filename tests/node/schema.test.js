/**
 * HITL Protocol v0.8 — Schema Validation Tests
 *
 * Validates examples and core payloads against JSON Schema definitions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const EXAMPLES_DIR = join(ROOT, 'examples');
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith('.json'));

function loadJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf-8'));
}

function loadExample(file) {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf-8'));
}

function collectSubmitRequests(example) {
  const requests = [];

  for (const step of example.steps ?? []) {
    if (typeof step.request?.url === 'string' && step.request.url.includes('/submit')) {
      requests.push(step.request.body);
    }

    if (
      typeof step.alternative_request?.url === 'string' &&
      step.alternative_request.url.includes('/submit')
    ) {
      requests.push(step.alternative_request.body);
    }
  }

  return requests.filter(Boolean);
}

let validateHitl;
let validatePoll;
let validateSubmit;
let validateDiscovery;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const formFieldSchema = loadJson('schemas/form-field.schema.json');
  ajv.addSchema(formFieldSchema, 'form-field.json');

  const verificationPolicySchema = loadJson('schemas/verification-policy.schema.json');
  ajv.addSchema(verificationPolicySchema, 'verification-policy.schema.json');

  const verificationResultSchema = loadJson('schemas/verification-result.schema.json');
  ajv.addSchema(verificationResultSchema, 'verification-result.schema.json');

  const submissionContextSchema = loadJson('schemas/submission-context.schema.json');
  ajv.addSchema(submissionContextSchema, 'submission-context.schema.json');

  validateHitl = ajv.compile(loadJson('schemas/hitl-object.schema.json'));
  validatePoll = ajv.compile(loadJson('schemas/poll-response.schema.json'));
  validateSubmit = ajv.compile(loadJson('schemas/submit-request.schema.json'));
  validateDiscovery = ajv.compile(loadJson('schemas/discovery-response.schema.json'));
});

describe('hitl-object.schema.json', () => {
  for (const file of EXAMPLE_FILES.filter((name) => name !== '07-well-known-hitl.json')) {
    it(`validates hitl payloads in ${file}`, () => {
      const example = loadExample(file);
      const hitlObjects = (example.steps ?? [])
        .filter((step) => step.response?.body?.hitl)
        .map((step) => step.response.body.hitl);

      if (hitlObjects.length === 0) {
        return;
      }

      for (const hitl of hitlObjects) {
        const valid = validateHitl(hitl);
        if (!valid) {
          console.error(`Validation errors for ${file}:`, validateHitl.errors);
        }
        expect(valid).toBe(true);
      }
    });
  }

  it('rejects missing required fields', () => {
    expect(validateHitl({})).toBe(false);
    expect(validateHitl({ spec_version: '0.8' })).toBe(false);
  });

  it('rejects invalid spec_version', () => {
    expect(validateHitl({
      spec_version: '1.0',
      case_id: 'test',
      review_url: 'https://example.com/review',
      poll_url: 'https://example.com/poll',
      type: 'confirmation',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(false);
  });

  it('accepts a minimal v0.8 hitl object', () => {
    expect(validateHitl({
      spec_version: '0.8',
      case_id: 'review_123',
      review_url: 'https://example.com/review/123?token=abc',
      poll_url: 'https://example.com/reviews/123/status',
      type: 'confirmation',
      prompt: 'Confirm action',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(true);
  });

  it('accepts verification_policy with OR-of-AND requirements', () => {
    expect(validateHitl({
      spec_version: '0.8',
      case_id: 'review_proof',
      review_url: 'https://example.com/review/proof?token=abc',
      poll_url: 'https://example.com/reviews/proof/status',
      type: 'confirmation',
      prompt: 'Confirm high-signal action',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
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
    })).toBe(true);
  });

  it('rejects non-HTTPS URLs for non-local hosts', () => {
    expect(validateHitl({
      spec_version: '0.8',
      case_id: 'review_http',
      review_url: 'http://example.com/review/http?token=abc',
      poll_url: 'http://api.example.com/reviews/http/status',
      type: 'selection',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(false);
  });
});

describe('submit-request.schema.json', () => {
  it('validates a standard inline submit', () => {
    expect(validateSubmit({
      action: 'confirm',
      submitted_via: 'telegram_inline_button',
      submitted_by: {
        platform: 'telegram',
        platform_user_id: '12345',
        display_name: 'Alice',
      },
    })).toBe(true);
  });

  it('validates inline submit with proof_of_human evidence', () => {
    expect(validateSubmit({
      action: 'confirm',
      data: {},
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
          presentation: {
            proof: '<opaque-provider-payload>',
          },
          binding: {
            case_id: 'review_123',
            action: 'confirm',
            challenge: 'opaque-nonce',
          },
        },
      ],
    })).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(validateSubmit({ action: 'confirm' })).toBe(false);
  });

  for (const file of EXAMPLE_FILES.filter((name) => name !== '07-well-known-hitl.json')) {
    it(`validates inline submit requests in ${file}`, () => {
      const example = loadExample(file);
      const submitRequests = collectSubmitRequests(example);

      for (const requestBody of submitRequests) {
        const valid = validateSubmit(requestBody);
        if (!valid) {
          console.error(`Submit validation errors in ${file}:`, validateSubmit.errors);
        }
        expect(valid).toBe(true);
      }
    });
  }
});

describe('poll-response.schema.json', () => {
  it('validates pending status', () => {
    expect(validatePoll({
      status: 'pending',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(true);
  });

  it('validates completed status with normalized submission_context', () => {
    expect(validatePoll({
      status: 'completed',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
      completed_at: '2026-01-01T12:00:00Z',
      result: {
        action: 'confirm',
        data: {},
      },
      responded_by: {
        name: 'Alice',
        email: 'alice@example.com',
      },
      submission_context: {
        mode: 'inline_submit',
        submitted_via: 'telegram_inline_button',
        submitted_by: {
          platform: 'telegram',
          platform_user_id: '12345',
          display_name: 'Alice',
        },
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
    })).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(validatePoll({
      status: 'unknown',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(false);
  });

  it('rejects cancelled without cancelled_at', () => {
    expect(validatePoll({
      status: 'cancelled',
      case_id: 'review_123',
    })).toBe(false);
  });

  for (const file of EXAMPLE_FILES.filter((name) => name !== '07-well-known-hitl.json')) {
    it(`validates poll responses in ${file}`, () => {
      const example = loadExample(file);
      const pollResponses = (example.steps ?? [])
        .filter((step) => step.request?.url?.includes('/status') && step.response?.body?.status && step.response.body.case_id)
        .map((step) => step.response.body);

      for (const responseBody of pollResponses) {
        const valid = validatePoll(responseBody);
        if (!valid) {
          console.error(`Poll validation errors in ${file}:`, validatePoll.errors);
        }
        expect(valid).toBe(true);
      }
    });
  }
});

describe('discovery-response.schema.json', () => {
  it('validates the well-known discovery example', () => {
    const example = loadJson('examples/07-well-known-hitl.json');
    const valid = validateDiscovery(example.response.body);
    if (!valid) {
      console.error('Validation errors for well-known discovery:', validateDiscovery.errors);
    }
    expect(valid).toBe(true);
  });

  it('validates discovery metadata for external auth composition', () => {
    expect(validateDiscovery({
      hitl_protocol: {
        spec_version: '0.8',
        capabilities: {
          supports_inline_submit: true,
          supports_agent_binding: true,
        },
        authentication: {
          type: 'bearer',
          documentation: 'https://example.com/docs/agent-auth',
          well_known: 'https://example.com/.well-known/agent-configuration',
          profiles: ['agent-auth/external'],
        },
      },
    })).toBe(true);
  });

  it('rejects invalid discovery spec_version', () => {
    expect(validateDiscovery({
      hitl_protocol: {
        spec_version: '1.0',
      },
    })).toBe(false);
  });
});
