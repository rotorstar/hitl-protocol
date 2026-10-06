/**
 * HITL Protocol v0.8 — Local, single-process demo (Hono on Node.js).
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
  ReviewError, parseSubmission, completeCase, expireCase, pollCase, serializeReviewData,
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
  clients.forEach((w) => {
    Promise.resolve(w(msg)).catch(() => { clients.delete(w); });
  });
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
  if (!Object.hasOwn(SAMPLE_CONTEXTS, type)) return c.json({ error: 'invalid_type', message: `Unknown type. Use: ${Object.keys(SAMPLE_CONTEXTS).join(', ')}` }, 400);

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
      spec_version: '0.8',
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
  expireCase(rc, handleTransition);
  if (rc.status === 'pending') try { transition(rc, 'opened', handleTransition); } catch {}

  let html;
  try { html = readFileSync(join(TEMPLATES_DIR, TEMPLATE_MAP[rc.type]), 'utf-8'); } catch { return c.json({ error: 'template_error' }, 500); }

  const hitlData = { case_id: rc.case_id, prompt: rc.prompt, type: rc.type, status: rc.status, token, respond_url: `${BASE_URL}/reviews/${rc.case_id}/respond`, expires_at: rc.expires_at, context: rc.context };
  const safePrompt = rc.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeData = serializeReviewData(hitlData);
  html = html.replace(/\{\{(?:prompt|hitl_data_json)\}\}/g, (placeholder) => placeholder === '{{prompt}}' ? safePrompt : safeData);
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

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json', message: 'Expected JSON.' }, 400); }
  try {
    const submission = parseSubmission(body, rc, isInlineSubmit ? 'inline_submit' : 'browser_submit');
    completeCase(rc, submission, handleTransition);
    return c.json({ status: 'completed', case_id: rc.case_id, completed_at: rc.completed_at });
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return c.json({ error: error.code, message: error.message, case_id: rc.case_id }, error.status);
  }
});

app.get('/api/reviews/:caseId/status', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found' }, 404);
  expireCase(rc, handleTransition);

  const rl = checkRateLimit(rc.case_id);
  c.header('X-RateLimit-Limit', String(RATE_LIMIT));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) return c.json({ error: 'rate_limited', message: 'Wait 30 seconds.' }, 429, { 'Retry-After': '30' });

  const inm = c.req.header('If-None-Match');
  if (inm && inm === rc.etag) { c.header('ETag', rc.etag); return c.body(null, 304); }

  const resp = pollCase(rc);

  c.header('ETag', rc.etag);
  c.header('Retry-After', '30');
  return c.json(resp);
});

app.get('/api/reviews/:caseId/events', (c) => {
  const rc = store.get(c.req.param('caseId'));
  if (!rc) return c.json({ error: 'not_found' }, 404);
  expireCase(rc, handleTransition);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: `review.${rc.status}`, data: JSON.stringify({ case_id: rc.case_id, status: rc.status }), id: 'evt_init' });

    if (!sseClients.has(rc.case_id)) sseClients.set(rc.case_id, new Set());
    const writer = (msg) => stream.write(msg);
    sseClients.get(rc.case_id).add(writer);

    const heartbeat = setInterval(() => {
      stream.write(': heartbeat\n\n').catch(() => { clearInterval(heartbeat); });
    }, 30000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      const clients = sseClients.get(rc.case_id);
      if (clients) { clients.delete(writer); if (clients.size === 0) sseClients.delete(rc.case_id); }
    });

    // Resolve on disconnect so the request callback also releases its captured state.
    if (!stream.aborted) await new Promise((resolve) => stream.onAbort(resolve));
  });
});

app.get('/.well-known/hitl.json', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({
    hitl_protocol: {
      spec_version: '0.8',
      service: { name: 'HITL Reference Service (Hono)', description: 'Reference implementation for testing', url: BASE_URL },
      capabilities: {
        review_types: ['approval', 'selection', 'input', 'confirmation', 'escalation'],
        transports: ['polling', 'sse'],
        supports_inline_submit: true,  // v0.7
        supports_surface: false,
        default_timeout: 'PT24H',
        supports_reminders: false,
        supports_multi_round: false,
        supports_signatures: false,
      },
      endpoints: {
        reviews_base: `${BASE_URL}/api/reviews`,
        review_page_base: `${BASE_URL}/review`,
        events_base: `${BASE_URL}/api/reviews`,
        well_known: `${BASE_URL}/.well-known/hitl.json`,
      },
      rate_limits: { poll_recommended_interval_seconds: 30, max_requests_per_minute: 60 },
    }
  });
});

// ============================================================
// Start
// ============================================================

export { app, store };

if (process.env.HITL_DEMO_TEST !== '1') serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`HITL Reference Service (Hono) running at ${BASE_URL}`);
  console.log(`\nTry: curl -X POST ${BASE_URL}/api/demo?type=selection`);
});
