import { describe, it, expect, beforeEach } from 'vitest'

import { checkRateLimit, clearRateLimit, resetRateLimits, RATE_LIMIT } from '../index.js'

describe('Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('allows requests within the limit', () => {
    const result = checkRateLimit('case_001')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(RATE_LIMIT - 1)
  })

  it('counts down remaining correctly', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('case_002')
    }
    const result = checkRateLimit('case_002')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(RATE_LIMIT - 11)
  })

  it('blocks after exceeding the limit', () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      checkRateLimit('case_003')
    }
    const result = checkRateLimit('case_003')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('tracks cases independently', () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      checkRateLimit('case_full')
    }
    const full = checkRateLimit('case_full')
    expect(full.allowed).toBe(false)

    const fresh = checkRateLimit('case_fresh')
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(RATE_LIMIT - 1)
  })

  it('clearRateLimit removes tracking for a case', () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      checkRateLimit('case_clear')
    }
    expect(checkRateLimit('case_clear').allowed).toBe(false)

    clearRateLimit('case_clear')
    const result = checkRateLimit('case_clear')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(RATE_LIMIT - 1)
  })

  it('RATE_LIMIT is 60', () => {
    expect(RATE_LIMIT).toBe(60)
  })
})
