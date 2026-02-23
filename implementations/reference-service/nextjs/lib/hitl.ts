/**
 * HITL Protocol v0.5 — Shared utilities for Next.js reference implementation.
 * Token generation/verification, in-memory store, state machine.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// ============================================================
// Token Utilities
// ============================================================

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function verifyToken(token: string, storedHash: Buffer): boolean {
  const candidate = hashToken(token);
  if (candidate.length !== storedHash.length) return false;
  return timingSafeEqual(candidate, storedHash);
}

// ============================================================
// Types
// ============================================================

export type ReviewStatus = 'pending' | 'opened' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
export type ReviewType = 'approval' | 'selection' | 'input' | 'confirmation' | 'escalation';

export interface ReviewCase {
  case_id: string;
  type: ReviewType;
  status: ReviewStatus;
  prompt: string;
  token_hash: Buffer;
  context: Record<string, unknown>;
  created_at: string;
  expires_at: string;
  default_action: string;
  version: number;
  etag: string;
  result: { action: string; data: Record<string, unknown> } | null;
  responded_by: { name: string; email: string } | null;
  opened_at?: string;
  completed_at?: string;
  expired_at?: string;
  cancelled_at?: string;
}

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
// SSE
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

// ============================================================
// State Machine
// ============================================================

const VALID_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  pending: ['opened', 'expired', 'cancelled'],
  opened: ['in_progress', 'completed', 'expired', 'cancelled'],
  in_progress: ['completed', 'expired', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
};

export function transition(rc: ReviewCase, newStatus: ReviewStatus): void {
  const allowed = VALID_TRANSITIONS[rc.status];
  if (!allowed.includes(newStatus)) throw new Error(`Invalid: ${rc.status} → ${newStatus}`);
  rc.status = newStatus;
  (rc as Record<string, unknown>)[`${newStatus}_at`] = new Date().toISOString();
  rc.version++;
  rc.etag = `"v${rc.version}-${newStatus}"`;
  // Clean up resources on terminal state
  if (['completed', 'expired', 'cancelled'].includes(newStatus)) {
    rateLimits.delete(rc.case_id);
  }
  notifySSE(rc);
}

// ============================================================
// Rate Limiting
// ============================================================

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;

export function checkRateLimit(caseId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let entry = rateLimits.get(caseId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    rateLimits.set(caseId, entry);
  }
  entry.count++;
  return { allowed: entry.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - entry.count) };
}

// ============================================================
// Sample Data
// ============================================================

export const SAMPLE_CONTEXTS: Record<ReviewType, Record<string, unknown>> = {
  selection: { items: [
    { id: 'job_001', title: 'Senior Frontend Engineer', description: 'React/Next.js at TechCorp, Berlin.', metadata: { salary: '85-110k EUR', remote: 'Hybrid' } },
    { id: 'job_002', title: 'Full-Stack Developer', description: 'Node.js + React at StartupXYZ.', metadata: { salary: '70-95k EUR', remote: 'Fully remote' } },
    { id: 'job_003', title: 'Tech Lead', description: 'Team of 8, microservices.', metadata: { salary: '110-140k EUR', remote: 'On-site' } },
  ] },
  approval: { artifact: { title: 'Production Deployment v2.4.0', content: 'Changes:\n- Updated auth\n- Fixed rate limiter\n\nRisk: Medium\nRollback: Automated', metadata: { environment: 'production', commit: 'a1b2c3d' } } },
  input: { form: { fields: [
    { key: 'salary_expectation', label: 'Salary Expectation (EUR)', type: 'number', required: true, validation: { min: 30000, max: 300000 } },
    { key: 'start_date', label: 'Earliest Start Date', type: 'date', required: true },
    { key: 'work_auth', label: 'Work Authorization', type: 'select', required: true, options: [{ value: 'citizen', label: 'EU Citizen' }, { value: 'blue_card', label: 'Blue Card' }, { value: 'visa_required', label: 'Visa Required' }] },
  ] } },
  confirmation: { description: 'The following emails will be sent:', items: [{ id: 'email_1', label: 'Application to TechCorp' }, { id: 'email_2', label: 'Application to StartupXYZ' }] },
  escalation: { error: { title: 'Deployment Failed', summary: 'Container OOMKilled', details: 'Error: OOMKilled\nMemory: 2.1GB / 2GB' }, params: { memory: '2GB', replicas: '3' } },
};

export const PROMPTS: Record<ReviewType, string> = {
  selection: 'Select which jobs to apply for',
  approval: 'Approve production deployment v2.4.0',
  input: 'Provide application details',
  confirmation: 'Confirm sending 2 emails',
  escalation: 'Deployment failed — decide how to proceed',
};

export function getBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
