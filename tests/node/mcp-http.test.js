import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { validatePollResponse } from '@hitl-protocol/schemas/v0.8';

process.env.HITL_DEMO_TEST = '1';
process.env.BASE_URL = 'http://localhost';
let demo;
let base;
beforeAll(async () => {
  demo = await import('../../implementations/mcp-server/server.js');
  demo.httpServer.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { demo.httpServer.once('listening', resolve); demo.httpServer.once('error', reject); });
  base = `http://127.0.0.1:${demo.httpServer.address().port}`;
});
afterEach(() => { if (demo) { for (const rc of demo.cases.values()) clearTimeout(rc.expirationTimer); demo.cases.clear(); } });
afterAll(async () => { if (demo) await new Promise((resolve) => demo.httpServer.close(resolve)); });

describe('MCP embedded real HTTP consumer', () => {
  function create(summary = 'Review the operation') { return demo.createCase({ prompt: 'Confirm', summary }); }
  async function respond(hitl, action) {
    const token = new URL(hitl.review_url).searchParams.get('token');
    return fetch(`${base}/review/${hitl.case_id}/respond`, { method: 'POST', body: new URLSearchParams({ token, action }) });
  }
  async function poll(hitl) { return (await fetch(`${base}/api/reviews/${hitl.case_id}/status`)).json(); }
  it.each(['confirm', 'cancel'])('emits a valid completed decision for %s and rejects duplicates', async (action) => {
    const { hitl } = create(); expect((await respond(hitl, action)).status).toBe(200);
    const result = await poll(hitl); expect(result.status).toBe('completed'); expect(result.result.action).toBe(action); expect(validatePollResponse(result)).toBe(true);
    expect((await respond(hitl, action === 'confirm' ? 'cancel' : 'confirm')).status).toBe(409);
    expect(await poll(hitl)).toEqual(result);
  });
  it('emits valid expiration and transport-cancellation shapes', async () => {
    const expired = create(); expired.reviewCase.expires_at = '2000-01-01T00:00:00Z';
    expect((await respond(expired.hitl, 'confirm')).status).toBe(410);
    expect(validatePollResponse(await poll(expired.hitl))).toBe(true);
    const cancelled = create(); demo.cancelCase(cancelled.reviewCase);
    const result = await poll(cancelled.hitl); expect(result.status).toBe('cancelled'); expect(result).not.toHaveProperty('result'); expect(validatePollResponse(result)).toBe(true);
  });
  it('escapes agent-controlled review text and uses full UUIDs', async () => {
    const { hitl } = create('</div><script>alert(1)</script>');
    expect(hitl.case_id).toMatch(/^review_[0-9a-f-]{36}$/);
    const url = new URL(hitl.review_url); const html = await (await fetch(base + url.pathname + url.search)).text();
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;');
  });
});
