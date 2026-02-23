/**
 * Simple per-case rate limiter for poll endpoints.
 * 60 requests per minute per case_id with sliding window.
 */

/** Default rate limit: requests per minute. */
export const RATE_LIMIT = 60

/** Internal rate limit state store. */
const rateLimits = new Map<string, { count: number; resetAt: number }>()

/** Check (and count) a request against the rate limit for a case. */
export function checkRateLimit(caseId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  let entry = rateLimits.get(caseId)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 }
    rateLimits.set(caseId, entry)
  }
  entry.count++
  return { allowed: entry.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - entry.count) }
}

/** Remove rate limit tracking for a case (call on terminal state). */
export function clearRateLimit(caseId: string): void {
  rateLimits.delete(caseId)
}

/** Reset all rate limit state (for testing). */
export function resetRateLimits(): void {
  rateLimits.clear()
}
