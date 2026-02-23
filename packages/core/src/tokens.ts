/**
 * Token utilities for HITL Protocol.
 * Dual-token model: review_token (browser) + submit_token (agent inline submit).
 * SHA-256 hashed, timing-safe comparison.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

import type { ReviewCase } from './types.js'

/** Generate a cryptographically random base64url token (256 bits). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Hash a token with SHA-256 for storage (never store raw tokens). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

/** Constant-time comparison of a raw token against a stored hash. */
export function verifyToken(token: string, storedHash: Buffer): boolean {
  const candidate = hashToken(token)
  if (candidate.length !== storedHash.length) return false
  return timingSafeEqual(candidate, storedHash)
}

/** Verify a token for a specific purpose (review or submit). */
export function verifyTokenForPurpose(
  token: string,
  rc: ReviewCase,
  purpose: 'review' | 'submit',
): boolean {
  if (purpose === 'review') return verifyToken(token, rc.token_hash)
  if (purpose === 'submit') return rc.submit_token_hash ? verifyToken(token, rc.submit_token_hash) : false
  return false
}
