import { describe, it, expect, afterEach, vi } from 'vitest'
import { validatePollResponse } from '@hitl-protocol/schemas/v0.8'
import { completeCase, expireCase, parseSubmission, pollCase, serializeReviewData, hashToken, ReviewError } from '../index.js'
import type { ReviewCase } from '../index.js'

function makeCase(): ReviewCase {
  return { case_id: 'case_1', type: 'confirmation', status: 'pending', prompt: 'Confirm?', token_hash: hashToken('review'), submit_token_hash: hashToken('submit'), inline_actions: ['confirm', 'cancel'], context: {}, created_at: '2026-10-06T00:00:00Z', expires_at: '2026-10-07T00:00:00Z', default_action: 'abort', version: 1, etag: '"v1-pending"', result: null, responded_by: null }
}

describe('Atomic local completion and request-time expiry', () => {
  afterEach(() => vi.useRealTimers())
  it('completes an unopened inline case and records claims as audit metadata only', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T01:00:00Z')
    const rc = makeCase()
    const submission = parseSubmission({ action: 'confirm', submitted_via: 'x-cli', submitted_by: { platform: 'x-cli', platform_user_id: 'claimed-user' } }, rc, 'inline_submit')
    const emitted: unknown[] = []
    completeCase(rc, submission, (record) => emitted.push(structuredClone(pollCase(record))))
    expect(rc.status).toBe('completed')
    expect(rc.responded_by).toBeNull()
    expect(rc.submission_context?.submitted_by?.platform_user_id).toBe('claimed-user')
    expect(validatePollResponse(pollCase(rc))).toBe(true)
    expect(emitted).toEqual([pollCase(rc)])
  })
  it('losing completion cannot change the winning decision, version or etag', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T01:00:00Z')
    const rc = makeCase()
    const confirm = parseSubmission({ action: 'confirm' }, rc, 'browser_submit')
    const cancel = parseSubmission({ action: 'cancel' }, rc, 'browser_submit')
    completeCase(rc, confirm)
    const winner = structuredClone(rc)
    expect(() => completeCase(rc, cancel)).toThrow('no longer accepting')
    expect(structuredClone(rc)).toEqual(winner)
  })
  it('checks the deadline again after parsing, at the exact boundary, without a timer', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T23:59:59Z')
    const rc = makeCase()
    const submission = parseSubmission({ action: 'confirm' }, rc, 'browser_submit')
    vi.setSystemTime(rc.expires_at)
    expect(() => completeCase(rc, submission)).toThrow('expired')
    expect(rc.result).toBeNull()
    expect(rc.status).toBe('expired')
    expect(validatePollResponse(pollCase(rc))).toBe(true)
  })
  it('never expires an existing terminal decision', () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-10-06T01:00:00Z')
    const rc = makeCase(); completeCase(rc, parseSubmission({ action: 'confirm' }, rc, 'browser_submit'))
    const winner = structuredClone(rc)
    expect(expireCase(rc, undefined, Date.parse('2026-10-08T00:00:00Z'))).toBe(false)
    expect(structuredClone(rc)).toEqual(winner)
  })
  it.each([null, [], { action: 1 }, { action: 'confirm', data: 'bad' }, { action: 'unknown' }, { action: 'confirm', submitted_by: { name: 'forged' } }].map((body) => [body]))('rejects malformed browser requests without mutation: %j', (body) => {
    const rc = makeCase(); const before = structuredClone(rc)
    expect(() => parseSubmission(body, rc, 'browser_submit')).toThrow()
    expect(structuredClone(rc)).toEqual(before)
  })
  it('requires canonical channel metadata for inline requests and rejects unavailable inline actions', () => {
    const rc = makeCase()
    expect(() => parseSubmission({ action: 'confirm' }, rc, 'inline_submit')).toThrow('Invalid inline')
    rc.inline_actions = []
    expect(() => parseSubmission({ action: 'confirm', submitted_via: 'x-cli', submitted_by: { platform: 'x-cli', platform_user_id: 'u' } }, rc, 'inline_submit')).toThrow('original HITL')
  })
  it('rejects selections that the producer did not offer', () => {
    const rc = makeCase(); rc.type = 'selection'; rc.context = { items: [{ id: 'valid' }] }
    expect(() => parseSubmission({ action: 'select', data: { selected: ['missing'] } }, rc, 'browser_submit')).toThrow('available')
    expect(() => parseSubmission({ action: 'select', data: { selected: ['valid', 'valid'] } }, rc, 'browser_submit')).toThrow('distinct')
  })
  it('validates required and constrained input fields on the server', () => {
    const rc = makeCase(); rc.type = 'input'; rc.context = { form: { fields: [{ key: 'salary', type: 'number', required: true, validation: { min: 1, max: 5 } }] } }
    for (const data of [{}, { salary: '3' }, { salary: 10 }, { salary: 3, unknown: true }]) expect(() => parseSubmission({ action: 'submit', data }, rc, 'browser_submit')).toThrow()
    expect(parseSubmission({ action: 'submit', data: { salary: 3 } }, rc, 'browser_submit').result.data).toEqual({ salary: 3 })
  })
  it('preserves hostile text without an HTML script-data breakout', () => {
    const data = { prompt: '</script><script>alert(1)</script>' }
    const encoded = serializeReviewData(data)
    expect(encoded).not.toContain('<')
    expect(JSON.parse(encoded)).toEqual(data)
  })
  it.each([['email', 'not-email', 'user@example.com'], ['url', 'not-url', 'https://example.com/path'], ['date', '2026-02-30', '2026-02-28']])('validates %s input formats on the server', (type, invalid, valid) => {
    const rc = makeCase(); rc.type = 'input'; rc.context = { form: { fields: [{ key: 'value', type, required: true }] } }
    expect(() => parseSubmission({ action: 'submit', data: { value: invalid } }, rc, 'browser_submit')).toThrow()
    expect(parseSubmission({ action: 'submit', data: { value: valid } }, rc, 'browser_submit').result.data).toEqual({ value: valid })
  })
  it('reports an invalid producer pattern as a server configuration error', () => {
    const rc = makeCase(); rc.type = 'input'; rc.context = { form: { fields: [{ key: 'value', type: 'text', validation: { pattern: '[' } }] } }
    try {
      parseSubmission({ action: 'submit', data: { value: 'text' } }, rc, 'browser_submit')
      throw new Error('Expected a configuration error')
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewError)
      expect(error).toMatchObject({ status: 500, code: 'invalid_form' })
    }
  })
})
