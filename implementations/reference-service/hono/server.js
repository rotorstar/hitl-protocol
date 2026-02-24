/**
 * HITL Protocol v0.7 — Reference Implementation (Hono)
 *
 * Same features as Express variant. Hono runs on Node.js, Deno, Bun, and Cloudflare Workers.
 *
 * Demonstrates all HITL features:
 *   - 5 review types (approval, selection, input, confirmation, escalation)
 *   - 3 transports (polling, SSE, callback placeholder)
 *   - Token security (randomBytes + SHA-256 + timingSafeEqual)
 *   - Channel-native inline submit (v0.7: submit_url, submit_token, inline_actions)
 *   - State machine with valid transitions
 *   - ETag / If-None-Match for efficient polling
 *   - Rate limiting (429)
 *   - One-time response guarantee (409)
 *   - Discovery endpoint (/.well-known/hitl.json)
 *
 * Usage:
 *   npm install && npm start
 *   curl -X POST http://localhost:3457/api/demo?type=selection
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateToken, hashToken, verifyTokenForPurpose,
  transition, TERMINAL_STATES,
  checkRateLimit, clearRateLimit, RATE_LIMIT,
  INLINE_ACTIONS, PROMPTS, SAMPLE_CONTEXTS,
} from '@hitl-protocol/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'templates');

const app = new Hono();
const PORT = Number(process.env.PORT) || 3457;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ============================================================
// In-Memory Store + SSE (framework-specific: Hono writer functions)
// ============================================================

const store = new Map();
const sseClients = new Map(); // caseId → Set<(msg) => void>

function notifySSE(rc) {
  const clients = sseClients.get(rc.case_id);
  if (!clients) return;
  const payload = JSON.stringify({ case_id: rc.case_id, status: rc.status, ...(rc.result && { result: rc.result }) });
  const msg = `event: review.${rc.status}\ndata: ${payload}\nid: evt_${Date.now()}\n\n`;
  clients.forEach((w) => { try { w(msg); } catch {} });
}

// Framework-specific side effects after state transition
function handleTransition(rc) {
  if (TERMINAL_STATES.includes(rc.status)) {
    clearRateLimit(rc.case_id);
    if (rc._expirationTimer) { clearTimeout(rc._expirationTimer); delete rc._expirationTimer; }
  }
  notifySSE(rc);
}

const TEMPLATE_MAP = { selection: 'selection.html', approval: 'approval.html', input: 'input.html', confirmation: 'confirmation.html', escalation: 'escalation.html' };

// ============================================================
// Routes
// ============================================================

app.post('/api/demo', (c) => {
  const type = c.req.query('type') || 'selection';
  if (!SAMPLE_CONTEXTS[type]) return c.json({ error: 'invalid_type', message: `Unknown type. Use: ${Object.keys(SAMPLE_CONTEXTS).join(', ')}` }, 400);

  const caseId = 'review_' + randomBytes(8).toString('hex');
  const token = generateToken();           // review URL token
  const submitToken = generateToken();     // v0.7: separate inline submit token
  const now = new Date();

  const rc = {
    case_id: caseId, type, status: 'pending', prompt: PROMPTS[type],
    token_hash: hashToken(token),
    submit_token_hash: hashToken(submitToken),  // v0.7
    inline_actions: INLINE_ACTIONS[type] || [],  // v0.7
    context: SAMPLE_CONTEXTS[type],
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString(),
    default_action: 'skip', version: 1, etag: '"v1-pending"', result: null, responded_by: null,
  };
  store.set(caseId, rc);

  rc._expirationTimer = setTimeout(() => { if (['pending', 'opened', 'in_progress'].includes(rc.status)) try { transition(rc, 'expired', handleTransition); } catch {} }, 86400000);

  return c.json({
    status: 'human_input_required', message: rc.prompt,
    hitl: {
      spec_version: '0.7',
      case_id: caseId,
      review_url: `${BASE_URL}/review/${caseId}?token=${token}`,
      poll_url: `${BASE_URL}/api/reviews/${caseId}/status`,
      // v0.7: Inline submit (only for types that support it)
      ...(INLINE_ACTIONS[type]?.length > 0 ? {
        submit_url: `${BASE_URL}/reviews/${caseId}/respond`,
        submit_token: submitToken,
        inline_actions: INLINE_ACTIONS[type],
      } : {}),
      type, prompt: rc.prompt, timeout: '24h', default_action: 'skip',
      created_at: rc.created_at, expires_at: rc.expires_at, context: rc.context,
    },
  }, 202, { 'Retry-After': '30' });
});

app.get('/review/:caseId', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found', message: 'Not found.' }, 404);
  const token = c.req.query('token');
  if (!token || !verifyTokenForPurpose(token, rc, 'review')) return c.json({ error: 'invalid_token', message: 'Invalid or expired review token.' }, 401);
  if (rc.status === 'pending') try { transition(rc, 'opened', handleTransition); } catch {}

  let html;
  try { html = readFileSync(join(TEMPLATES_DIR, TEMPLATE_MAP[rc.type]), 'utf-8'); } catch { return c.json({ error: 'template_error' }, 500); }

  const hitlData = { case_id: rc.case_id, prompt: rc.prompt, type: rc.type, status: rc.status, token, respond_url: `${BASE_URL}/reviews/${rc.case_id}/respond`, expires_at: rc.expires_at, context: rc.context };
  html = html.replace(/\{\{prompt\}\}/g, rc.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).replace('{{hitl_data_json}}', JSON.stringify(hitlData));
  return c.html(html);
});

// POST /reviews/:caseId/respond — Submit response (v0.7: dual auth paths)
app.post('/reviews/:caseId/respond', async (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found', message: 'Review case not found.' }, 404);

  // v0.7: Determine auth path — Bearer header (inline) vs query param (review page)
  const authHeader = c.req.header('Authorization');
  let isInlineSubmit = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Inline submit path: verify against submit_token_hash
    const bearerToken = authHeader.slice(7);
    if (!verifyTokenForPurpose(bearerToken, rc, 'submit')) {
      return c.json({ error: 'invalid_token', message: 'Invalid submit token.' }, 401);
    }
    isInlineSubmit = true;
  } else {
    // Review page path: verify against review token_hash (query param)
    const token = c.req.query('token');
    if (!token || !verifyTokenForPurpose(token, rc, 'review')) {
      return c.json({ error: 'invalid_token', message: 'Invalid or expired review token.' }, 401);
    }
  }

  // Check expired
  if (rc.status === 'expired') return c.json({ error: 'case_expired', message: `This review case expired on ${rc.expires_at}.` }, 410);
  // One-time response (409)
  if (rc.status === 'completed') return c.json({ error: 'duplicate_submission', message: 'This review case has already been responded to.' }, 409);

  const { action, data, submitted_via, submitted_by } = await c.req.json();
  if (!action) return c.json({ error: 'missing_action', message: 'Request body must include "action".' }, 400);

  // v0.7: Validate inline_actions for Bearer path
  if (isInlineSubmit && rc.inline_actions?.length > 0 && !rc.inline_actions.includes(action)) {
    return c.json({
      error: 'action_not_inline',
      message: `Action '${action}' is not allowed via inline submit. Allowed: ${rc.inline_actions.join(', ')}`,
      review_url: `${BASE_URL}/review/${rc.case_id}`,
    }, 403);
  }

  rc.result = { action, data: data || {} };
  rc.responded_by = submitted_by || { name: 'Demo User', email: 'demo@example.com' };
  if (submitted_via) rc.submitted_via = submitted_via;
  transition(rc, 'completed', handleTransition);
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
      spec_version: '0.7',
      service: { name: 'HITL Reference Service (Hono)', description: 'Reference implementation for testing', url: BASE_URL },
      capabilities: {
        review_types: ['approval', 'selection', 'input', 'confirmation', 'escalation'],
        transports: ['polling', 'sse'],
        supports_inline_submit: true,  // v0.7
        default_timeout: 'PT24H',
        supports_reminders: false,
        supports_multi_round: false,
        supports_signatures: false,
      },
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
