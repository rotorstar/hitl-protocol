/**
 * HITL Protocol v0.7 — Schema Validation Tests
 *
 * Validates all examples against JSON Schema definitions.
 * Framework-agnostic: only tests schema compliance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function loadJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf-8'));
}

let validateHitl;
let validatePoll;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const formFieldSchema = loadJson('schemas/form-field.schema.json');
  // Ajv2020 auto-registers by $id; add short alias for local $ref resolution
  ajv.addSchema(formFieldSchema, 'form-field.json');

  const hitlSchema = loadJson('schemas/hitl-object.schema.json');
  validateHitl = ajv.compile(hitlSchema);

  const pollSchema = loadJson('schemas/poll-response.schema.json');
  validatePoll = ajv.compile(pollSchema);
});

// ============================================================
// HITL Object Schema
// ============================================================

describe('hitl-object.schema.json', () => {
  const examples = [
    { file: 'examples/01-job-search-selection.json', name: 'Job search selection' },
    { file: 'examples/02-deployment-approval.json', name: 'Deployment approval' },
    { file: 'examples/03-content-review-edit.json', name: 'Content review edit' },
    { file: 'examples/04-input-form.json', name: 'Input form' },
    { file: 'examples/05-confirmation-gate.json', name: 'Confirmation gate' },
    { file: 'examples/06-escalation-error.json', name: 'Escalation error' },
    { file: 'examples/08-multi-step-input.json', name: 'Multi-step input' },
    { file: 'examples/09-inline-confirmation.json', name: 'Inline confirmation' },
    { file: 'examples/10-inline-escalation.json', name: 'Inline escalation' },
    { file: 'examples/11-hybrid-approval.json', name: 'Hybrid approval' },
    { file: 'examples/12-embedded-selection.json', name: 'Embedded selection' },
  ];

  examples.forEach(({ file, name }) => {
    it(`validates example: ${name}`, () => {
      const example = loadJson(file);
      const hitlObjects = example.steps
        .filter((s) => s.response?.body?.hitl)
        .map((s) => s.response.body.hitl);

      expect(hitlObjects.length).toBeGreaterThan(0);

      hitlObjects.forEach((hitl) => {
        const valid = validateHitl(hitl);
        if (!valid) {
          console.error(`Validation errors for ${name}:`, validateHitl.errors);
        }
        expect(valid).toBe(true);
      });
    });
  });

  it('rejects missing required fields', () => {
    expect(validateHitl({})).toBe(false);
    expect(validateHitl({ spec_version: '0.7' })).toBe(false);
  });

  it('rejects invalid spec_version', () => {
    const invalid = {
      spec_version: '1.0',
      case_id: 'test',
      review_url: 'https://example.com/review',
      poll_url: 'https://example.com/poll',
      type: 'selection',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(invalid)).toBe(false);
  });

  it('rejects invalid review type', () => {
    const invalid = {
      spec_version: '0.7',
      case_id: 'test',
      review_url: 'https://example.com/review',
      poll_url: 'https://example.com/poll',
      type: 'unknown',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(invalid)).toBe(false);
  });

  it('accepts custom review type with x- prefix', () => {
    const custom = {
      spec_version: '0.7',
      case_id: 'test',
      review_url: 'https://example.com/review',
      poll_url: 'https://example.com/poll',
      type: 'x-custom-review',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(custom)).toBe(true);
  });

  it('validates minimal hitl object', () => {
    const minimal = {
      spec_version: '0.7',
      case_id: 'review_123',
      review_url: 'https://example.com/review/123?token=abc',
      poll_url: 'https://example.com/reviews/123/status',
      type: 'confirmation',
      prompt: 'Confirm action',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(minimal)).toBe(true);
  });

  it('rejects non-HTTPS URLs for non-local hosts', () => {
    const invalid = {
      spec_version: '0.7',
      case_id: 'review_http',
      review_url: 'http://example.com/review/http?token=abc',
      poll_url: 'http://api.example.com/reviews/http/status',
      type: 'selection',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(invalid)).toBe(false);
  });

  it('allows http://localhost for local development', () => {
    const validLocal = {
      spec_version: '0.7',
      case_id: 'review_local',
      review_url: 'http://localhost:3456/review/local?token=abc',
      poll_url: 'http://localhost:3456/api/reviews/local/status',
      type: 'selection',
      prompt: 'Test',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    };
    expect(validateHitl(validLocal)).toBe(true);
  });
});

// ============================================================
// Poll Response Schema
// ============================================================

describe('poll-response.schema.json', () => {
  it('validates pending status', () => {
    expect(validatePoll({
      status: 'pending',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
    })).toBe(true);
  });

  it('validates completed status with result', () => {
    expect(validatePoll({
      status: 'completed',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
      completed_at: '2026-01-01T12:00:00Z',
      result: {
        action: 'select',
        data: { selected: ['item_1', 'item_2'] },
      },
      responded_by: { name: 'Alice', email: 'alice@example.com' },
    })).toBe(true);
  });

  it('validates in_progress with progress', () => {
    expect(validatePoll({
      status: 'in_progress',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
      progress: { current_step: 2, total_steps: 3 },
    })).toBe(true);
  });

  it('validates expired with default_action', () => {
    expect(validatePoll({
      status: 'expired',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-01T12:00:00Z',
      expired_at: '2026-01-01T12:00:00Z',
      default_action: 'skip',
    })).toBe(true);
  });

  it('validates cancelled with reason', () => {
    expect(validatePoll({
      status: 'cancelled',
      case_id: 'review_123',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
      cancelled_at: '2026-01-01T08:00:00Z',
      reason: 'Changed my mind.',
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

  it('rejects missing required fields', () => {
    expect(validatePoll({})).toBe(false);
    expect(validatePoll({ status: 'pending' })).toBe(false);
  });

  it('rejects completed without result/completed_at', () => {
    expect(validatePoll({
      status: 'completed',
      case_id: 'review_123',
    })).toBe(false);
  });

  it('rejects expired without expired_at/default_action', () => {
    expect(validatePoll({
      status: 'expired',
      case_id: 'review_123',
    })).toBe(false);
  });

  it('rejects cancelled without cancelled_at', () => {
    expect(validatePoll({
      status: 'cancelled',
      case_id: 'review_123',
    })).toBe(false);
  });

  it('validates poll responses from examples', () => {
    const examples = [
      'examples/01-job-search-selection.json',
      'examples/02-deployment-approval.json',
      'examples/04-input-form.json',
      'examples/05-confirmation-gate.json',
      'examples/06-escalation-error.json',
      'examples/08-multi-step-input.json',
      'examples/09-inline-confirmation.json',
      'examples/10-inline-escalation.json',
      'examples/11-hybrid-approval.json',
      'examples/12-embedded-selection.json',
    ];

    examples.forEach((file) => {
      const example = loadJson(file);
      const pollResponses = example.steps
        .filter((s) => s.request?.url?.includes('/status') && s.response?.body?.status && s.response.body.case_id)
        .map((s) => s.response.body);

      pollResponses.forEach((resp) => {
        const valid = validatePoll(resp);
        if (!valid) {
          console.error(`Poll validation errors in ${file}:`, validatePoll.errors);
        }
        expect(valid).toBe(true);
      });
    });
  });
});
