import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as current from './index.js'
import * as v08 from './v0.8.js'
import * as v09 from './v0.9.js'

const minimal = (version: '0.8' | '0.9') => ({
  spec_version: version, case_id: 'review_1', type: 'confirmation', prompt: 'Confirm?',
  review_url: 'https://service.example/review/review_1?token=opaque',
  poll_url: 'https://service.example/reviews/review_1',
  created_at: '2026-10-06T10:00:00Z', expires_at: '2026-10-06T10:30:00Z',
})

describe('explicit version contracts', () => {
  it('defaults exclusively to v0.9', () => {
    expect(current.validateHitlObject(minimal('0.9'))).toBe(true)
    expect(current.validateHitlObject(minimal('0.8'))).toBe(false)
    expect(v08.validateHitlObject(minimal('0.8'))).toBe(true)
    expect(v08.validateHitlObject(minimal('0.9'))).toBe(false)
    expect(v09.hitlObjectSchema).toEqual(current.hitlObjectSchema)
  })
  it('supported validators preserve both versions and reject unknown versions', () => {
    for (const version of ['0.8', '0.9'] as const) {
      expect(current.validateSupportedHitlObject(minimal(version))).toBe(true)
      expect(current.validateSupportedDiscoveryResponse({ hitl_protocol: { spec_version: version } })).toBe(true)
    }
    expect(current.validateSupportedHitlObject({ ...minimal('0.9'), spec_version: '1.0' })).toBe(false)
    expect(current.validateSupportedHitlObject.errors?.[0]?.keyword).toBe('supportedVersion')
    expect(current.validateSupportedHitlObject({ spec_version: '0.9' })).toBe(false)
    expect(current.validateSupportedHitlObject.errors?.length).toBeGreaterThan(0)
    expect(current.validateSupportedHitlObject(minimal('0.9'))).toBe(true)
    expect(current.validateSupportedHitlObject.errors).toBeNull()
    expect(current.validateSupportedDiscoveryResponse({ hitl_protocol: { spec_version: '1.0' } })).toBe(false)
  })
  it('protects the unchanged historical closure against its recorded checksums', () => {
    const directory = new URL('../../../schemas/v0.8/', import.meta.url)
    const manifest: Record<string, string> = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
    for (const [file, digest] of Object.entries(manifest)) {
      expect(createHash('sha256').update(readFileSync(new URL(file, directory))).digest('hex')).toBe(digest)
    }
  })
})

describe('v0.9 terminal, context, and form invariants', () => {
  it.each([
    ['completed', { result: { action: 'confirm' }, completed_at: '2026-10-06T10:10:00Z' }],
    ['expired', { expired_at: '2026-10-06T10:30:00Z', default_action: 'abort' }],
    ['cancelled', { cancelled_at: '2026-10-06T10:10:00Z' }],
  ])('requires the fields guaranteed by %s', (status, fields) => {
    expect(current.validatePollResponse({ status, case_id: 'review_1' })).toBe(false)
    expect(current.validatePollResponse({ status, case_id: 'review_1', ...fields })).toBe(true)
    for (const key of Object.keys(fields)) {
      const invalid: Record<string, unknown> = { status, case_id: 'review_1', ...fields }
      delete invalid[key]
      expect(current.validatePollResponse(invalid)).toBe(false)
    }
  })
  it('does not expose decisions before completion', () => {
    expect(current.validatePollResponse({ status: 'pending', case_id: 'review_1', result: { action: 'confirm' } })).toBe(false)
  })
  it('uses the initiating HITL default-action vocabulary for expired polls', () => {
    const expired = { status: 'expired', case_id: 'review_1', expired_at: '2026-10-06T10:30:00Z' }
    for (const default_action of current.hitlObjectSchema.properties.default_action.enum) {
      expect(current.validatePollResponse({ ...expired, default_action })).toBe(true)
    }
    expect(current.validatePollResponse({ ...expired, default_action: 'cancel' })).toBe(false)
    expect(v08.validatePollResponse({ ...expired, default_action: 'cancel' })).toBe(true)
  })
  it('requires actual inline-origin metadata while basic browser context stays valid', () => {
    expect(current.validateSubmissionContext({ mode: 'browser_submit' })).toBe(true)
    expect(current.validateSubmissionContext({ mode: 'inline_submit' })).toBe(false)
    expect(current.validateSubmissionContext({ mode: 'inline_submit', submitted_via: 'x-test', submitted_by: { platform: 'x-test', platform_user_id: '1' } })).toBe(true)
  })
  it('permits exactly one form layout', () => {
    for (const form of [{ fields: [] }, { steps: [] }]) expect(current.validateHitlObject({ ...minimal('0.9'), context: { form } })).toBe(true)
    for (const form of [{}, { fields: [], steps: [] }]) expect(current.validateHitlObject({ ...minimal('0.9'), context: { form } })).toBe(false)
  })
})
