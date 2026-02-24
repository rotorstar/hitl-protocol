/**
 * HITL Protocol v0.7 — Shared utilities for Next.js reference implementation.
 *
 * Core logic (tokens, state machine, rate limiting, constants) is imported
 * from @hitl-protocol/core. This file provides framework-specific SSE,
 * in-memory store, and re-exports.
 */

// Re-export core utilities for use by route handlers
export {
  generateToken, hashToken, verifyToken, verifyTokenForPurpose,
  transition, canTransition, VALID_TRANSITIONS, TERMINAL_STATES,
  checkRateLimit, clearRateLimit, RATE_LIMIT,
  INLINE_ACTIONS, PROMPTS, SAMPLE_CONTEXTS,
} from '@hitl-protocol/core';
export type { ReviewCase, ReviewStatus, ReviewType } from '@hitl-protocol/core';

import type { ReviewCase } from '@hitl-protocol/core';
import { clearRateLimit, TERMINAL_STATES } from '@hitl-protocol/core';

// ============================================================
// In-Memory Store
// ============================================================

const store = new Map<string, ReviewCase>();

export function getCase(caseId: string): ReviewCase | undefined {
  return store.get(caseId);
}

export function setCase(caseId: string, rc: ReviewCase): void {
  store.set(caseId, rc);
}

// ============================================================
// SSE (Next.js ReadableStreamDefaultController)
// ============================================================

const sseControllers = new Map<string, Set<ReadableStreamDefaultController>>();

export function registerSSE(caseId: string, controller: ReadableStreamDefaultController): () => void {
  if (!sseControllers.has(caseId)) sseControllers.set(caseId, new Set());
  sseControllers.get(caseId)!.add(controller);
  return () => {
    const s = sseControllers.get(caseId);
    if (s) { s.delete(controller); if (s.size === 0) sseControllers.delete(caseId); }
  };
}

function notifySSE(rc: ReviewCase): void {
  const controllers = sseControllers.get(rc.case_id);
  if (!controllers) return;
  const payload = JSON.stringify({ case_id: rc.case_id, status: rc.status, ...(rc.result && { result: rc.result }) });
  const msg = `event: review.${rc.status}\ndata: ${payload}\nid: evt_${Date.now()}\n\n`;
  const encoder = new TextEncoder();
  controllers.forEach((c) => { try { c.enqueue(encoder.encode(msg)); } catch {} });
}

/** Callback for transition() — handles SSE + cleanup on terminal state. */
export function handleTransition(rc: ReviewCase): void {
  if (TERMINAL_STATES.includes(rc.status)) {
    clearRateLimit(rc.case_id);
  }
  notifySSE(rc);
}

// ============================================================
// Base URL
// ============================================================

export function getBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
