import { describe, expect, it } from 'vitest'
import { AGENT_ACCESS_JSON_SCHEMAS, CommitInputSchema, EnrollmentInputSchema, OfferSnapshotSchema,
  PrepareInputSchema, evaluatePolicy, snapshotDigest, prepareFingerprint, type OfferSnapshot } from '../contracts.js'
const snapshot: OfferSnapshot = { offer_id: 'offer_1', offer_version: 1, title: 'Operator offer', unit_price_cents: 10_000,
  fee_cents: 0, quantity: 1, total_cents: 10_000, currency: 'EUR', refundable: true,
  terms: 'Refundable until day before booking', policy_version: 1, grant_version: 1 }
describe('canonical business contracts', () => {
  it('computes policy from total including fees, quantity and grant limit', () => {
    expect(evaluatePolicy(snapshot, { max_total_cents: 50_000 })).toBe('allow')
    expect(evaluatePolicy({ ...snapshot, fee_cents: 1, total_cents: 10_001 }, { max_total_cents: 50_000 })).toBe('review')
    expect(evaluatePolicy({ ...snapshot, refundable: false }, { max_total_cents: 50_000 })).toBe('review')
    expect(evaluatePolicy({ ...snapshot, quantity: 6, total_cents: 60_000 }, { max_total_cents: 50_000 })).toBe('deny')
    expect(evaluatePolicy(snapshot, { max_total_cents: 9999 })).toBe('deny')
  })
  it('rejects manipulated and unsafe integer totals', () => {
    expect(OfferSnapshotSchema.safeParse({ ...snapshot, total_cents: 1 }).success).toBe(false)
    expect(OfferSnapshotSchema.safeParse({ ...snapshot, quantity: Number.MAX_SAFE_INTEGER }).success).toBe(false)
  })
  it('never expands authority as grant limit decreases over the whole EUR range', () => {
    const rank = { deny: 0, review: 1, allow: 2 }
    for (let cents = 0; cents <= 50_500; cents += 101) {
      const example = { ...snapshot, unit_price_cents: cents, total_cents: cents }
      expect(rank[evaluatePolicy(example, { max_total_cents: 5000 })]).toBeLessThanOrEqual(rank[evaluatePolicy(example, { max_total_cents: 50_000 })])
    }
  })
  it('has deterministic snapshot digest independent of property insertion order', () => {
    expect(snapshotDigest(snapshot)).toMatch(/^[a-f0-9]{64}$/)
    const { grant_version, ...otherFields } = snapshot
    expect(snapshotDigest(snapshot)).toBe(snapshotDigest({ grant_version, ...otherFields }))
    expect(snapshotDigest({ ...snapshot, terms: 'Non-refundable' })).not.toBe(snapshotDigest(snapshot))
  })
  it('idempotency is based on normalized complete input and forbids asserted identity', () => {
    const input = { grant_id: 'grant1', offer_id: 'offer1', offer_version: 1, quantity: 2 }
    expect(prepareFingerprint(input)).toBe(prepareFingerprint({ quantity: 2, offer_version: 1, offer_id: 'offer1', grant_id: 'grant1' }))
    expect(prepareFingerprint({ ...input, quantity: 3 })).not.toBe(prepareFingerprint(input))
    expect(PrepareInputSchema.safeParse({ ...input, agent_id: 'forged' }).success).toBe(false)
    expect(CommitInputSchema.safeParse({ expected_version: 1, snapshot_digest: 'a'.repeat(64), price: 1 }).success).toBe(false)
  })
  it('exports request JSON Schema with defaults optional, matching runtime normalization', () => {
    expect(EnrollmentInputSchema.parse({})).toEqual({ max_total_cents: 50_000 })
    expect(AGENT_ACCESS_JSON_SCHEMAS.EnrollmentInput.required ?? []).not.toContain('max_total_cents')
  })
})
