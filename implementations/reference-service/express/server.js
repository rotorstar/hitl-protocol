/**
 * HITL Protocol v0.6 — Reference Implementation (Express 5)
 *
 * Demonstrates all HITL features:
 *   - 5 review types (approval, selection, input, confirmation, escalation)
 *   - 3 transports (polling, SSE, callback placeholder)
 *   - Token security (randomBytes + SHA-256 + timingSafeEqual)
 *   - Channel-native inline submit (v0.6: submit_url, submit_token, inline_actions)
 *   - State machine with valid transitions
 *   - ETag / If-None-Match for efficient polling
 *   - Rate limiting (429)
 *   - One-time response guarantee (409)
 *   - Discovery endpoint (/.well-known/hitl.json)
 *
 * Usage:
 *   npm install && npm start
 *   # Create a review:   curl -X POST http://localhost:3456/api/demo?type=selection
 *   # Poll status:        curl http://localhost:3456/api/reviews/{caseId}/status
 *   # Open review page:   open http://localhost:3456/review/{caseId}?token={token}
 */

import express from 'express';
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

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3456;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ============================================================
// In-Memory Store (swap with your DB in production)
// ============================================================

const store = new Map();

// ============================================================
// SSE Connections (framework-specific: Express res.write)
// ============================================================

const sseClients = new Map(); // caseId → Set<res>

function notifySSE(reviewCase) {
  const clients = sseClients.get(reviewCase.case_id);
  if (!clients) return;
  const event = `review.${reviewCase.status}`;
  const payload = { case_id: reviewCase.case_id, status: reviewCase.status };
  if (reviewCase.result) payload.result = reviewCase.result;
  const id = `evt_${Date.now()}`;
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\nid: ${id}\n\n`;
  clients.forEach((res) => { try { res.write(msg); } catch { clients.delete(res); } });
  if (clients.size === 0) sseClients.delete(reviewCase.case_id);
}

// Framework-specific side effects after state transition
function handleTransition(rc) {
  if (TERMINAL_STATES.includes(rc.status)) {
    clearRateLimit(rc.case_id);
    if (rc._expirationTimer) { clearTimeout(rc._expirationTimer); delete rc._expirationTimer; }
  }
  notifySSE(rc);
}

// ============================================================
// Template Map
// ============================================================

const TEMPLATE_MAP = {
  selection: 'selection.html',
  approval: 'approval.html',
  input: 'input.html',
  confirmation: 'confirmation.html',
  escalation: 'escalation.html'
};

// ============================================================
// Routes
// ============================================================

// POST /api/demo?type=selection — Create a HITL review case
app.post('/api/demo', (req, res) => {
  const type = req.query.type || 'selection';
  if (!SAMPLE_CONTEXTS[type]) {
    return res.status(400).json({ error: 'invalid_type', message: `Unknown type: ${type}. Use: ${Object.keys(SAMPLE_CONTEXTS).join(', ')}` });
  }

  const caseId = 'review_' + randomBytes(8).toString('hex');
  const token = generateToken();           // review URL token
  const submitToken = generateToken();     // v0.6: separate inline submit token
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const reviewCase = {
    case_id: caseId,
    type,
    status: 'pending',
    prompt: PROMPTS[type],
    token_hash: hashToken(token),
    submit_token_hash: hashToken(submitToken),  // v0.6
    inline_actions: INLINE_ACTIONS[type] || [],  // v0.6
    context: SAMPLE_CONTEXTS[type],
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    default_action: 'skip',
    version: 1,
    etag: '"v1-pending"',
    result: null,
    responded_by: null,
  };

  store.set(caseId, reviewCase);

  // Auto-expire after timeout (store timer so it can be cleared on early completion)
  reviewCase._expirationTimer = setTimeout(() => {
    if (['pending', 'opened', 'in_progress'].includes(reviewCase.status)) {
      try { transition(reviewCase, 'expired', handleTransition); } catch {}
    }
  }, 24 * 60 * 60 * 1000);

  res.status(202)
    .set('Retry-After', '30')
    .json({
      status: 'human_input_required',
      message: reviewCase.prompt,
      hitl: {
        spec_version: '0.6',
        case_id: caseId,
        review_url: `${BASE_URL}/review/${caseId}?token=${token}`,
        poll_url: `${BASE_URL}/api/reviews/${caseId}/status`,
        // v0.6: Inline submit (only for types that support it)
        ...(INLINE_ACTIONS[type]?.length > 0 ? {
          submit_url: `${BASE_URL}/reviews/${caseId}/respond`,
          submit_token: submitToken,
          inline_actions: INLINE_ACTIONS[type],
        } : {}),
        type,
        prompt: reviewCase.prompt,
        timeout: '24h',
        default_action: 'skip',
        created_at: reviewCase.created_at,
        expires_at: reviewCase.expires_at,
        context: reviewCase.context,
      }
    });
});

// GET /review/:caseId?token=... — Serve review page
app.get('/review/:caseId', (req, res) => {
  const reviewCase = store.get(req.params.caseId);
  if (!reviewCase) return res.status(404).json({ error: 'not_found', message: 'Review case not found.' });

  const token = req.query.token;
  if (!token || !verifyTokenForPurpose(token, reviewCase, 'review')) {
    return res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired review token.' });
  }

  // Mark as opened on first visit
  if (reviewCase.status === 'pending') {
    try { transition(reviewCase, 'opened', handleTransition); } catch {}
  }

  const templateFile = TEMPLATE_MAP[reviewCase.type];
  if (!templateFile) return res.status(500).json({ error: 'no_template', message: 'No template for this review type.' });

  let html;
  try {
    html = readFileSync(join(TEMPLATES_DIR, templateFile), 'utf-8');
  } catch {
    return res.status(500).json({ error: 'template_error', message: 'Template file not found. Run from the repository root.' });
  }

  const hitlData = {
    case_id: reviewCase.case_id,
    prompt: reviewCase.prompt,
    type: reviewCase.type,
    status: reviewCase.status,
    token,
    respond_url: `${BASE_URL}/reviews/${reviewCase.case_id}/respond`,
    expires_at: reviewCase.expires_at,
    context: reviewCase.context,
  };

  html = html
    .replace(/\{\{prompt\}\}/g, reviewCase.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace('{{hitl_data_json}}', JSON.stringify(hitlData));

  res.type('html').send(html);
});

// POST /reviews/:caseId/respond — Submit response (v0.6: dual auth paths)
app.post('/reviews/:caseId/respond', (req, res) => {
  const reviewCase = store.get(req.params.caseId);
  if (!reviewCase) return res.status(404).json({ error: 'not_found', message: 'Review case not found.' });

  // v0.6: Determine auth path — Bearer header (inline) vs query param (review page)
  const authHeader = req.get('Authorization');
  let isInlineSubmit = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Inline submit path: verify against submit_token_hash
    const bearerToken = authHeader.slice(7);
    if (!verifyTokenForPurpose(bearerToken, reviewCase, 'submit')) {
      return res.status(401).json({ error: 'invalid_token', message: 'Invalid submit token.' });
    }
    isInlineSubmit = true;
  } else {
    // Review page path: verify against review token_hash (query param)
    const token = req.query.token;
    if (!token || !verifyTokenForPurpose(token, reviewCase, 'review')) {
      return res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired review token.' });
    }
  }

  // Check expired
  if (reviewCase.status === 'expired') {
    return res.status(410).json({ error: 'case_expired', message: `This review case expired on ${reviewCase.expires_at}.` });
  }

  // One-time response (409)
  if (reviewCase.status === 'completed') {
    return res.status(409).json({ error: 'duplicate_submission', message: 'This review case has already been responded to.' });
  }

  const { action, data, submitted_via, submitted_by } = req.body;
  if (!action) return res.status(400).json({ error: 'missing_action', message: 'Request body must include "action".' });

  // v0.6: Validate inline_actions for Bearer path
  if (isInlineSubmit && reviewCase.inline_actions?.length > 0 && !reviewCase.inline_actions.includes(action)) {
    return res.status(403).json({
      error: 'action_not_inline',
      message: `Action '${action}' is not allowed via inline submit. Allowed: ${reviewCase.inline_actions.join(', ')}`,
      review_url: `${BASE_URL}/review/${reviewCase.case_id}`,
    });
  }

  reviewCase.result = { action, data: data || {} };
  reviewCase.responded_by = submitted_by || { name: 'Demo User', email: 'demo@example.com' };
  if (submitted_via) reviewCase.submitted_via = submitted_via;
  transition(reviewCase, 'completed', handleTransition);

  res.json({
    status: 'completed',
    case_id: reviewCase.case_id,
    completed_at: reviewCase.completed_at,
  });
});

// GET /api/reviews/:caseId/status — Poll with ETag + Retry-After + Rate Limit
app.get('/api/reviews/:caseId/status', (req, res) => {
  const reviewCase = store.get(req.params.caseId);
  if (!reviewCase) return res.status(404).json({ error: 'not_found', message: 'Review case not found.' });

  // Rate limiting
  const rl = checkRateLimit(reviewCase.case_id);
  res.set('X-RateLimit-Limit', String(RATE_LIMIT));
  res.set('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    return res.status(429).set('Retry-After', '30').json({ error: 'rate_limited', message: 'Too many requests. Please wait 30 seconds.' });
  }

  // ETag / If-None-Match
  const ifNoneMatch = req.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === reviewCase.etag) {
    return res.status(304).set('ETag', reviewCase.etag).end();
  }

  const response = {
    status: reviewCase.status,
    case_id: reviewCase.case_id,
    created_at: reviewCase.created_at,
    expires_at: reviewCase.expires_at,
  };

  if (reviewCase.opened_at) response.opened_at = reviewCase.opened_at;
  if (reviewCase.completed_at) response.completed_at = reviewCase.completed_at;
  if (reviewCase.expired_at) response.expired_at = reviewCase.expired_at;
  if (reviewCase.cancelled_at) response.cancelled_at = reviewCase.cancelled_at;
  if (reviewCase.result) response.result = reviewCase.result;
  if (reviewCase.responded_by) response.responded_by = reviewCase.responded_by;
  if (reviewCase.status === 'expired') response.default_action = reviewCase.default_action;
  if (reviewCase.progress) response.progress = reviewCase.progress;

  res.set('ETag', reviewCase.etag).set('Retry-After', '30').json(response);
});

// GET /api/reviews/:caseId/events — SSE
app.get('/api/reviews/:caseId/events', (req, res) => {
  const reviewCase = store.get(req.params.caseId);
  if (!reviewCase) return res.status(404).json({ error: 'not_found', message: 'Review case not found.' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send current status
  const initial = { case_id: reviewCase.case_id, status: reviewCase.status };
  res.write(`event: review.${reviewCase.status}\ndata: ${JSON.stringify(initial)}\nid: evt_init\n\n`);

  // Register client
  if (!sseClients.has(reviewCase.case_id)) sseClients.set(reviewCase.case_id, new Set());
  sseClients.get(reviewCase.case_id).add(res);

  // Heartbeat
  const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(reviewCase.case_id);
    if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(reviewCase.case_id); }
  });
});

// GET /.well-known/hitl.json — Discovery
app.get('/.well-known/hitl.json', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').json({
    hitl_protocol: {
      spec_version: '0.6',
      service: { name: 'HITL Reference Service (Express)', description: 'Reference implementation for testing', url: BASE_URL },
      capabilities: {
        review_types: ['approval', 'selection', 'input', 'confirmation', 'escalation'],
        transports: ['polling', 'sse'],
        supports_inline_submit: true,  // v0.6
        default_timeout: 'PT24H',
        supports_reminders: false,
        supports_multi_round: false,
        supports_signatures: false,
      },
      endpoints: {
        reviews_base: `${BASE_URL}/api/reviews`,
        review_page_base: `${BASE_URL}/review`,
      },
      rate_limits: { poll_recommended_interval_seconds: 30, max_requests_per_minute: 60 },
    }
  });
});

// ============================================================
// Start
// ============================================================

app.listen(PORT, () => {
  console.log(`HITL Reference Service (Express) running at ${BASE_URL}`);
  console.log(`\nTry it:`);
  console.log(`  curl -X POST ${BASE_URL}/api/demo?type=selection`);
  console.log(`  curl -X POST ${BASE_URL}/api/demo?type=approval`);
  console.log(`  curl -X POST ${BASE_URL}/api/demo?type=input`);
  console.log(`  curl -X POST ${BASE_URL}/api/demo?type=confirmation`);
  console.log(`  curl -X POST ${BASE_URL}/api/demo?type=escalation`);
});
