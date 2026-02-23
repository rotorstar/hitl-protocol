/**
 * HITL Protocol v0.5 — Reference Implementation (Hono)
 *
 * Same features as Express variant. Hono runs on Node.js, Deno, Bun, and Cloudflare Workers.
 *
 * Usage:
 *   npm install && npm start
 *   curl -X POST http://localhost:3457/api/demo?type=selection
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'templates');

const app = new Hono();
const PORT = Number(process.env.PORT) || 3457;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ============================================================
// Token Utilities
// ============================================================

function generateToken() { return randomBytes(32).toString('base64url'); }
function hashToken(token) { return createHash('sha256').update(token).digest(); }
function verifyToken(token, storedHash) {
  const h = hashToken(token);
  return h.length === storedHash.length && timingSafeEqual(h, storedHash);
}

// ============================================================
// Store + State Machine
// ============================================================

const store = new Map();
const sseClients = new Map();
const rateLimits = new Map();
const RATE_LIMIT = 60;

const VALID_TRANSITIONS = {
  pending: ['opened', 'expired', 'cancelled'],
  opened: ['in_progress', 'completed', 'expired', 'cancelled'],
  in_progress: ['completed', 'expired', 'cancelled'],
  completed: [], expired: [], cancelled: [],
};

function transition(rc, newStatus) {
  if (!VALID_TRANSITIONS[rc.status]?.includes(newStatus)) throw new Error(`Invalid: ${rc.status} → ${newStatus}`);
  rc.status = newStatus;
  rc[newStatus + '_at'] = new Date().toISOString();
  rc.etag = `"v${++rc.version}-${newStatus}"`;
  // Clean up resources on terminal state
  if (['completed', 'expired', 'cancelled'].includes(newStatus)) {
    if (rc._expirationTimer) { clearTimeout(rc._expirationTimer); delete rc._expirationTimer; }
    rateLimits.delete(rc.case_id);
  }
  const clients = sseClients.get(rc.case_id);
  if (clients) {
    const payload = JSON.stringify({ case_id: rc.case_id, status: rc.status, ...(rc.result && { result: rc.result }) });
    const msg = `event: review.${rc.status}\ndata: ${payload}\nid: evt_${Date.now()}\n\n`;
    clients.forEach((w) => { try { w(msg); } catch {} });
  }
}

function checkRateLimit(caseId) {
  const now = Date.now();
  let e = rateLimits.get(caseId);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; rateLimits.set(caseId, e); }
  e.count++;
  return { allowed: e.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - e.count) };
}

// ============================================================
// Sample Data
// ============================================================

const SAMPLE_CONTEXTS = {
  selection: { items: [
    { id: 'job_001', title: 'Senior Frontend Engineer', description: 'React/Next.js at TechCorp, Berlin.', metadata: { salary: '85-110k EUR', remote: 'Hybrid' } },
    { id: 'job_002', title: 'Full-Stack Developer', description: 'Node.js + React at StartupXYZ, Munich.', metadata: { salary: '70-95k EUR', remote: 'Fully remote' } },
    { id: 'job_003', title: 'Tech Lead', description: 'Team of 8, microservices.', metadata: { salary: '110-140k EUR', remote: 'On-site' } },
  ] },
  approval: { artifact: { title: 'Production Deployment v2.4.0', content: 'Changes:\n- Updated auth\n- Fixed rate limiter\n- Added HITL support\n\nRisk: Medium\nRollback: Automated', metadata: { environment: 'production', commit: 'a1b2c3d' } } },
  input: { form: { fields: [
    { key: 'salary_expectation', label: 'Salary Expectation (EUR)', type: 'number', required: true, validation: { min: 30000, max: 300000 } },
    { key: 'start_date', label: 'Earliest Start Date', type: 'date', required: true },
    { key: 'work_auth', label: 'Work Authorization', type: 'select', required: true, options: [{ value: 'citizen', label: 'EU Citizen' }, { value: 'blue_card', label: 'Blue Card' }, { value: 'visa_required', label: 'Visa Required' }] }
  ] } },
  confirmation: { description: 'The following emails will be sent:', items: [{ id: 'email_1', label: 'Application to TechCorp' }, { id: 'email_2', label: 'Application to StartupXYZ' }] },
  escalation: { error: { title: 'Deployment Failed', summary: 'Container OOMKilled', details: 'Error: OOMKilled\nMemory: 2.1GB / 2GB\nPod: web-api-7b8c9d-xk4m2' }, params: { memory: '2GB', replicas: '3' } },
};

const PROMPTS = { selection: 'Select which jobs to apply for', approval: 'Approve production deployment v2.4.0', input: 'Provide application details', confirmation: 'Confirm sending 2 emails', escalation: 'Deployment failed — decide how to proceed' };
const TEMPLATE_MAP = { selection: 'selection.html', approval: 'approval.html', input: 'input.html', confirmation: 'confirmation.html', escalation: 'escalation.html' };

// ============================================================
// Routes
// ============================================================

app.post('/api/demo', (c) => {
  const type = c.req.query('type') || 'selection';
  if (!SAMPLE_CONTEXTS[type]) return c.json({ error: 'invalid_type', message: `Unknown type. Use: ${Object.keys(SAMPLE_CONTEXTS).join(', ')}` }, 400);

  const caseId = 'review_' + randomBytes(8).toString('hex');
  const token = generateToken();
  const now = new Date();

  const rc = {
    case_id: caseId, type, status: 'pending', prompt: PROMPTS[type],
    token_hash: hashToken(token), context: SAMPLE_CONTEXTS[type],
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString(),
    default_action: 'skip', version: 1, etag: '"v1-pending"', result: null, responded_by: null,
  };
  store.set(caseId, rc);

  rc._expirationTimer = setTimeout(() => { if (['pending', 'opened', 'in_progress'].includes(rc.status)) try { transition(rc, 'expired'); } catch {} }, 86400000);

  return c.json({
    status: 'human_input_required', message: rc.prompt,
    hitl: { spec_version: '0.5', case_id: caseId, review_url: `${BASE_URL}/review/${caseId}?token=${token}`, poll_url: `${BASE_URL}/api/reviews/${caseId}/status`, type, prompt: rc.prompt, timeout: '24h', default_action: 'skip', created_at: rc.created_at, expires_at: rc.expires_at, context: rc.context },
  }, 202, { 'Retry-After': '30' });
});

app.get('/review/:caseId', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found', message: 'Not found.' }, 404);
  const token = c.req.query('token');
  if (!token || !verifyToken(token, rc.token_hash)) return c.json({ error: 'invalid_token', message: 'Invalid token.' }, 401);
  if (rc.status === 'pending') try { transition(rc, 'opened'); } catch {}

  let html;
  try { html = readFileSync(join(TEMPLATES_DIR, TEMPLATE_MAP[rc.type]), 'utf-8'); } catch { return c.json({ error: 'template_error' }, 500); }

  const hitlData = { case_id: rc.case_id, prompt: rc.prompt, type: rc.type, status: rc.status, token, respond_url: `${BASE_URL}/reviews/${rc.case_id}/respond`, expires_at: rc.expires_at, context: rc.context };
  html = html.replace(/\{\{prompt\}\}/g, rc.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).replace('{{hitl_data_json}}', JSON.stringify(hitlData));
  return c.html(html);
});

app.post('/reviews/:caseId/respond', async (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found' }, 404);
  const token = c.req.query('token');
  if (!token || !verifyToken(token, rc.token_hash)) return c.json({ error: 'invalid_token' }, 401);
  if (rc.status === 'expired') return c.json({ error: 'case_expired', message: `Expired on ${rc.expires_at}.` }, 410);
  if (rc.status === 'completed') return c.json({ error: 'duplicate_submission', message: 'Already responded.' }, 409);

  const { action, data } = await c.req.json();
  if (!action) return c.json({ error: 'missing_action' }, 400);
  rc.result = { action, data: data || {} };
  rc.responded_by = { name: 'Demo User', email: 'demo@example.com' };
  transition(rc, 'completed');
  return c.json({ status: 'completed', case_id: rc.case_id, completed_at: rc.completed_at });
});

app.get('/api/reviews/:caseId/status', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found' }, 404);

  const rl = checkRateLimit(rc.case_id);
  c.header('X-RateLimit-Limit', String(RATE_LIMIT));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) return c.json({ error: 'rate_limited', message: 'Wait 30 seconds.' }, 429, { 'Retry-After': '30' });

  const inm = c.req.header('If-None-Match');
  if (inm && inm === rc.etag) { c.header('ETag', rc.etag); return c.body(null, 304); }

  const resp = { status: rc.status, case_id: rc.case_id, created_at: rc.created_at, expires_at: rc.expires_at };
  if (rc.opened_at) resp.opened_at = rc.opened_at;
  if (rc.completed_at) resp.completed_at = rc.completed_at;
  if (rc.expired_at) resp.expired_at = rc.expired_at;
  if (rc.cancelled_at) resp.cancelled_at = rc.cancelled_at;
  if (rc.result) resp.result = rc.result;
  if (rc.responded_by) resp.responded_by = rc.responded_by;
  if (rc.status === 'expired') resp.default_action = rc.default_action;

  c.header('ETag', rc.etag);
  c.header('Retry-After', '30');
  return c.json(resp);
});

app.get('/api/reviews/:caseId/events', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found' }, 404);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: `review.${rc.status}`, data: JSON.stringify({ case_id: rc.case_id, status: rc.status }), id: 'evt_init' });

    if (!sseClients.has(rc.case_id)) sseClients.set(rc.case_id, new Set());
    const writer = (msg) => stream.write(msg);
    sseClients.get(rc.case_id).add(writer);

    const heartbeat = setInterval(() => { try { stream.write(': heartbeat\n\n'); } catch {} }, 30000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      const clients = sseClients.get(rc.case_id);
      if (clients) { clients.delete(writer); if (clients.size === 0) sseClients.delete(rc.case_id); }
    });

    // Keep stream open
    await new Promise(() => {});
  });
});

app.get('/.well-known/hitl.json', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({
    hitl_protocol: {
      spec_version: '0.5',
      service: { name: 'HITL Reference Service (Hono)', url: BASE_URL },
      capabilities: { review_types: ['approval', 'selection', 'input', 'confirmation', 'escalation'], transports: ['polling', 'sse'], default_timeout: 'PT24H', supports_reminders: false, supports_multi_round: false, supports_signatures: false },
      endpoints: { reviews_base: `${BASE_URL}/api/reviews`, review_page_base: `${BASE_URL}/review` },
      rate_limits: { poll_recommended_interval_seconds: 30, max_requests_per_minute: 60 },
    }
  });
});

// ============================================================
// Start
// ============================================================

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`HITL Reference Service (Hono) running at ${BASE_URL}`);
  console.log(`\nTry: curl -X POST ${BASE_URL}/api/demo?type=selection`);
});
