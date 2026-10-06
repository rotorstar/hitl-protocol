import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const ajv = new Ajv2020({ strict: true })
addFormats(ajv)
const schema = JSON.parse(readFileSync(new URL('../../../profiles/surface-interop/v0.1/surface-interop-profile.schema.json', import.meta.url), 'utf8'))
const validate = ajv.compile(schema)

function surface(fallback_review_url: string) {
  return {
    profile: 'hitl-surface-interop/v0.1', case_id: 'review_123',
    surfaces: [{ id: 'review', format: 'json-render', version: '0.12', fallback_review_url, payload: {} }],
  }
}

describe('Surface fallback transport boundary', () => {
  it.each(['https://service.example/review/123?token=test', 'http://localhost:3456/review/123', 'http://127.0.0.1/review/123'])('accepts supported transport %s', (url) => {
    expect(validate(surface(url))).toBe(true)
  })
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'http://service.example/review/123', 'http://localhost.evil.example/review', 'http://localhost@evil.example/review', 'http://127.0.0.1.evil.example/review', '//service.example/review'])('rejects unsafe fallback %s', (url) => {
    expect(validate(surface(url))).toBe(false)
  })
})
