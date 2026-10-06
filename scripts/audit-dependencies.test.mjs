import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { assessAudit } from './audit-dependencies.mjs'

const clean = () => ({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } })
test('a complete successful clean audit passes', () => assert.equal(assessAudit(clean(), 0).passed, true))
test('low severity vulnerabilities still fail the gate', () => {
  const report = clean(); report.metadata.vulnerabilities.low = 1
  report.advisories.fixture = { severity: 'low', module_name: 'fixture', github_advisory_id: 'fixture' }
  assert.equal(assessAudit(report, 1).passed, false)
})
test('advisories cannot be hidden by a zero summary', () => {
  const report = clean(); report.advisories.fixture = { severity: 'critical' }
  assert.equal(assessAudit(report, 0).passed, false)
})
test('registry/network errors cannot pass even with exit code zero', () => assert.throws(() => assessAudit({ error: { code: 'ENETUNREACH' } }, 0)))
test('missing severity fields cannot pass as an empty audit', () => {
  const report = clean(); delete report.metadata.vulnerabilities.high
  assert.throws(() => assessAudit(report, 0))
})
test('failed processes cannot pass with a stale clean report', () => {
  for (const status of [1, 2, null]) assert.throws(() => assessAudit(clean(), status))
})
