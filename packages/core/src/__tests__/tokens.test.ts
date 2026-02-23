import { describe, it, expect } from 'vitest'

import { generateToken, hashToken, verifyToken, verifyTokenForPurpose } from '../index.js'
import type { ReviewCase } from '../index.js'

describe('Token Utilities', () => {
  describe('generateToken', () => {
    it('returns a base64url string', () => {
      const token = generateToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('generates 256-bit tokens (43 chars base64url)', () => {
      const token = generateToken()
      expect(token.length).toBe(43)
    })

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
      expect(tokens.size).toBe(100)
    })
  })

  describe('hashToken', () => {
    it('returns a 32-byte Buffer (SHA-256)', () => {
      const hash = hashToken('test-token')
      expect(hash).toBeInstanceOf(Buffer)
      expect(hash.length).toBe(32)
    })

    it('is deterministic', () => {
      const a = hashToken('same-token')
      const b = hashToken('same-token')
      expect(a.equals(b)).toBe(true)
    })

    it('produces different hashes for different tokens', () => {
      const a = hashToken('token-a')
      const b = hashToken('token-b')
      expect(a.equals(b)).toBe(false)
    })
  })

  describe('verifyToken', () => {
    it('returns true for matching token', () => {
      const token = generateToken()
      const hash = hashToken(token)
      expect(verifyToken(token, hash)).toBe(true)
    })

    it('returns false for wrong token', () => {
      const hash = hashToken(generateToken())
      expect(verifyToken('wrong-token', hash)).toBe(false)
    })

    it('returns false for truncated hash', () => {
      const token = generateToken()
      const hash = hashToken(token)
      expect(verifyToken(token, hash.subarray(0, 16))).toBe(false)
    })
  })

  describe('verifyTokenForPurpose', () => {
    function makeCase(reviewToken: string, submitToken: string): ReviewCase {
      return {
        case_id: 'test_001',
        type: 'approval',
        status: 'pending',
        prompt: 'Test',
        token_hash: hashToken(reviewToken),
        submit_token_hash: hashToken(submitToken),
        inline_actions: ['approve', 'reject'],
        context: {},
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        default_action: 'skip',
        version: 1,
        etag: '"v1-pending"',
        result: null,
        responded_by: null,
      }
    }

    it('verifies review token for review purpose', () => {
      const reviewToken = generateToken()
      const submitToken = generateToken()
      const rc = makeCase(reviewToken, submitToken)
      expect(verifyTokenForPurpose(reviewToken, rc, 'review')).toBe(true)
    })

    it('rejects submit token for review purpose', () => {
      const reviewToken = generateToken()
      const submitToken = generateToken()
      const rc = makeCase(reviewToken, submitToken)
      expect(verifyTokenForPurpose(submitToken, rc, 'review')).toBe(false)
    })

    it('verifies submit token for submit purpose', () => {
      const reviewToken = generateToken()
      const submitToken = generateToken()
      const rc = makeCase(reviewToken, submitToken)
      expect(verifyTokenForPurpose(submitToken, rc, 'submit')).toBe(true)
    })

    it('rejects review token for submit purpose', () => {
      const reviewToken = generateToken()
      const submitToken = generateToken()
      const rc = makeCase(reviewToken, submitToken)
      expect(verifyTokenForPurpose(reviewToken, rc, 'submit')).toBe(false)
    })
  })
})
