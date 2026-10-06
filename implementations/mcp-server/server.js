/**
 * HITL Protocol — MCP Server Demo (URL Mode Elicitation Binding)
 *
 * Demonstrates the informative MCP Elicitation Binding
 * (docs/mcp-elicitation-binding.md): a single process that
 *
 *   1. runs a minimal HITL service (HTTP) hosting a confirmation review page
 *   2. exposes an MCP tool over stdio that hits a human decision point
 *   3. delivers the HITL review_url to the user via MCP URL mode elicitation
 *      (`elicitation/create`, mode: "url") when the client supports it
 *   4. signals completion via `notifications/elicitation/complete`
 *      instead of agent-side polling
 *   5. falls back to the plain HITL flow (relay review_url + poll_review tool)
 *      for clients without URL elicitation support
 *
 * Requires an MCP client negotiating the 2025-11-25 URL elicitation binding.
 * See docs/mcp-elicitation-binding.md for the versioned transport contract.
 * This local teaching demo records decisions and does not send emails.
 *
 * Usage:
 *   pnpm install
 *   claude mcp add hitl-demo -- node /absolute/path/to/server.js
 *   # then ask: "Send my 3 application emails using the hitl-demo tool"
 *   # -> consent prompt -> browser opens review page -> confirm -> tool resolves
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { generateToken, hashToken, verifyToken, transition, TERMINAL_STATES, parseSubmission, completeCase, expireCase, pollCase, ReviewError } from '@hitl-protocol/core';

const PORT = process.env.PORT || 3789;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CASE_TIMEOUT_MS = 15 * 60 * 1000;

// stdio transport carries JSON-RPC on stdout — log to stderr only
const log = (...args) => console.error('[hitl-mcp-demo]', ...args);

// ============================================================
// Embedded HITL Service (in-memory, confirmation type only)
// ============================================================

const cases = new Map(); // caseId → review case

function createCase({ prompt, summary }) {
  const caseId = `review_${randomUUID()}`;
  const token = generateToken();
  const now = new Date();
  const reviewCase = {
    case_id: caseId,
    status: 'pending',
    type: 'confirmation',
    prompt,
    summary,
    context: { description: summary },
    token_hash: hashToken(token),
    inline_actions: [],
    default_action: 'abort',
    version: 1,
    etag: '"v1-pending"',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CASE_TIMEOUT_MS).toISOString(),
    result: null,
    responded_by: null,
    decided: null, // resolver for the in-process completion promise
  };
  reviewCase.completion = new Promise((resolve) => { reviewCase.decided = resolve; });
  reviewCase.expirationTimer = setTimeout(() => {
    expireCase(reviewCase, finishCase);
  }, CASE_TIMEOUT_MS);
  cases.set(caseId, reviewCase);
  return {
    reviewCase,
    hitl: {
      spec_version: '0.8',
      case_id: caseId,
      review_url: `${BASE_URL}/review/${caseId}?token=${token}`,
      poll_url: `${BASE_URL}/api/reviews/${caseId}/status`,
      type: 'confirmation',
      prompt,
      timeout: '15m',
      default_action: 'abort',
      created_at: reviewCase.created_at,
      expires_at: reviewCase.expires_at,
    },
  };
}

function finishCase(reviewCase) {
  if (TERMINAL_STATES.includes(reviewCase.status)) {
    clearTimeout(reviewCase.expirationTimer);
    reviewCase.decided();
  }
}

function settleCase(reviewCase, action) {
  const submission = parseSubmission({ action }, reviewCase, 'browser_submit');
  completeCase(reviewCase, submission, finishCase);
}

function cancelCase(reviewCase) {
  expireCase(reviewCase, finishCase);
  if (!TERMINAL_STATES.includes(reviewCase.status)) transition(reviewCase, 'cancelled', finishCase);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reviewPage(reviewCase, token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confirm — HITL Protocol Demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; color: #1a1a1a; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 24px; }
    h1 { font-size: 1.2rem; margin-top: 0; }
    .summary { background: #f6f8fa; border-radius: 8px; padding: 12px; margin: 16px 0; white-space: pre-wrap; }
    button { width: 100%; padding: 12px; margin-top: 8px; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .confirm { background: #1f883d; color: #fff; }
    .cancel { background: #eee; }
    footer { margin-top: 24px; font-size: 0.8rem; color: #777; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(reviewCase.prompt)}</h1>
    <div class="summary">${escapeHtml(reviewCase.summary)}</div>
    <form method="POST" action="/review/${reviewCase.case_id}/respond">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button class="confirm" name="action" value="confirm">Confirm</button>
      <button class="cancel" name="action" value="cancel">Cancel</button>
    </form>
  </div>
  <footer>HITL Protocol v0.8 demo — delivered via MCP URL mode elicitation</footer>
</body>
</html>`;
}

function resultPage(reviewCase) {
  const headline = reviewCase.status === 'completed' ? (reviewCase.result?.action === 'confirm' ? 'Confirmation recorded ✓' : 'Cancellation recorded') : reviewCase.status === 'cancelled' ? 'Cancelled' : 'Expired';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${headline}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;text-align:center}</style></head>
<body><h1>${headline}</h1><p>You can close this window and return to your agent.</p></body></html>`;
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  const send = (code, body, type = 'text/html') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(body);
  };

  // GET /review/{caseId}?token=… — the human arrives
  let match = url.pathname.match(/^\/review\/([\w-]+)$/);
  if (req.method === 'GET' && match) {
    const reviewCase = cases.get(match[1]);
    const token = url.searchParams.get('token');
    if (!reviewCase || !token || !verifyToken(token, reviewCase.token_hash)) {
      return send(404, '<h1>Review not found</h1>');
    }
    expireCase(reviewCase, finishCase);
    if (TERMINAL_STATES.includes(reviewCase.status)) return send(200, resultPage(reviewCase));
    if (reviewCase.status === 'pending') transition(reviewCase, 'opened');
    return send(200, reviewPage(reviewCase, token));
  }

  // POST /review/{caseId}/respond — the human decides
  match = url.pathname.match(/^\/review\/([\w-]+)\/respond$/);
  if (req.method === 'POST' && match) {
    const reviewCase = cases.get(match[1]);
    let body = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 16384) { tooLarge = true; body = ''; return; }
      if (!tooLarge) body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return send(413, '<h1>Request too large</h1>');
      const form = new URLSearchParams(body);
      const token = form.get('token');
      const action = form.get('action');
      if (!reviewCase || !token || !verifyToken(token, reviewCase.token_hash)) {
        return send(404, '<h1>Review not found</h1>');
      }
      if (!['confirm', 'cancel'].includes(action)) return send(400, '<h1>Invalid action</h1>');
      try { settleCase(reviewCase, action); } catch (error) {
        if (!(error instanceof ReviewError)) throw error;
        return send(error.status, resultPage(reviewCase));
      }
      send(200, resultPage(reviewCase));
    });
    return;
  }

  // GET /api/reviews/{caseId}/status — poll_url for the fallback path
  match = url.pathname.match(/^\/api\/reviews\/([\w-]+)\/status$/);
  if (req.method === 'GET' && match) {
    const reviewCase = cases.get(match[1]);
    if (!reviewCase) return send(404, JSON.stringify({ error: 'not_found' }), 'application/json');
    expireCase(reviewCase, finishCase);
    const poll = pollCase(reviewCase);
    return send(200, JSON.stringify(poll), 'application/json');
  }

  send(404, '<h1>Not found</h1>');
});

// ============================================================
// MCP Server (stdio) — the binding itself
// ============================================================

const mcpServer = new McpServer({ name: 'hitl-url-elicitation-demo', version: '0.8.0' });

function clientSupportsUrlElicitation() {
  const caps = mcpServer.server.getClientCapabilities();
  // Per MCP spec: an empty elicitation object means form mode only
  return Boolean(caps?.elicitation && 'url' in caps.elicitation);
}

mcpServer.registerTool(
  'send_emails',
  {
    description:
      'Demonstrate reviewing prepared application emails via a HITL Protocol page. ' +
      'Records confirmation only; this local demo never sends emails.',
    inputSchema: {
      count: z.number().int().min(1).max(20).describe('How many prepared emails to send'),
      recipient_hint: z.string().optional().describe('Short description of the recipients'),
    },
  },
  async ({ count, recipient_hint }) => {
    const summary = `Review sending ${count} application email${count === 1 ? '' : 's'}${recipient_hint ? ` to ${recipient_hint}` : ''}.\nThis local demo records the decision and sends no email.`;
    const { reviewCase, hitl } = createCase({ prompt: 'Confirm sending emails', summary });

    if (!clientSupportsUrlElicitation()) {
      // Plain HITL flow: behave like an HTTP 202 — the agent relays the URL and polls
      log(`Case ${hitl.case_id}: client has no URL elicitation support, falling back to poll flow`);
      return {
        content: [{
          type: 'text',
          text:
            'Human confirmation required (HITL Protocol). Forward this review link to the user, ' +
            `then call poll_review with case_id "${hitl.case_id}" until it reaches a terminal state:\n` +
            JSON.stringify({ status: 'human_input_required', hitl }, null, 2),
        }],
      };
    }

    // MCP Elicitation Binding: review_url → URL mode elicitation
    const elicitationId = hitl.case_id;
    const notifyComplete = mcpServer.server.createElicitationCompletionNotifier(elicitationId);
    log(`Case ${hitl.case_id}: sending URL mode elicitation`);

    const consent = await mcpServer.server.elicitInput({
      mode: 'url',
      message: `Confirm sending ${count} email${count === 1 ? '' : 's'} — opens the service's review page.`,
      url: hitl.review_url,
      elicitationId,
    });

    if (consent.action !== 'accept') {
      cancelCase(reviewCase);
      return { content: [{ type: 'text', text: `User ${consent.action}ed the review request. Nothing was sent.` }] };
    }

    // Consent given — the decision happens out of band in the browser
    await reviewCase.completion;
    await notifyComplete().catch((err) => log('completion notification failed:', err.message));

    if (reviewCase.status === 'completed' && reviewCase.result.action === 'confirm') {
      return {
        content: [{
          type: 'text',
          text: `Confirmation recorded for ${count} email${count === 1 ? '' : 's'}. This local demo does not send emails. ` +
            `Structured result: ${JSON.stringify({ case_id: hitl.case_id, ...reviewCase.result })}`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Review ended with status "${reviewCase.status}" — nothing was sent.`,
      }],
    };
  },
);

mcpServer.registerTool(
  'poll_review',
  {
    description: 'Poll the status of a pending HITL review case (fallback transport when URL elicitation is unavailable).',
    inputSchema: { case_id: z.string().describe('The HITL case_id to poll') },
  },
  async ({ case_id }) => {
    const reviewCase = cases.get(case_id);
    if (!reviewCase) return { content: [{ type: 'text', text: `Unknown case_id: ${case_id}` }], isError: true };
    expireCase(reviewCase, finishCase);
    const poll = pollCase(reviewCase);
    return { content: [{ type: 'text', text: JSON.stringify(poll, null, 2) }] };
  },
);

// ============================================================
// Startup
// ============================================================

export { createCase, settleCase, cancelCase, cases, httpServer };

if (process.env.HITL_DEMO_TEST !== '1') httpServer.listen(PORT, '127.0.0.1', async () => {
  log(`HITL review service listening on ${BASE_URL}`);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  log('MCP server connected on stdio');
});
