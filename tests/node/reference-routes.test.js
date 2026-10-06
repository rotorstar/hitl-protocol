import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { validateHitlObject, validatePollResponse, validateDiscoveryResponse } from '@hitl-protocol/schemas/v0.8';

process.env.HITL_DEMO_TEST = '1';
process.env.BASE_URL = 'http://localhost';
let hono;
let express;
let expressServer;
let expressBase;

beforeAll(async () => {
  hono = await import('../../implementations/reference-service/hono/server.js');
  express = await import('../../implementations/reference-service/express/server.js');
  expressServer = express.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { expressServer.once('listening', resolve); expressServer.once('error', reject); });
  expressBase = `http://127.0.0.1:${expressServer.address().port}`;
});
afterEach(() => {
  for (const runtime of [hono, express]) if (runtime) {
    for (const rc of runtime.store.values()) clearTimeout(rc._expirationTimer);
    runtime.store.clear();
  }
});
afterAll(async () => { if (expressServer) await new Promise((resolve) => expressServer.close(resolve)); });

const adapters = [
  { name: 'Hono', runtime: () => hono, request: (path, init) => hono.app.request(path, init) },
  { name: 'Express', runtime: () => express, request: (path, init) => fetch(expressBase + path, init) },
];
const inlineBody = (action = 'confirm') => ({ action, submitted_via: 'x-cli', submitted_by: { platform: 'x-cli', platform_user_id: 'claimed-user' } });

for (const adapter of adapters) describe(`${adapter.name} actual local endpoints`, () => {
  async function create(type = 'confirmation') {
    const response = await adapter.request(`/api/demo?type=${type}`, { method: 'POST' });
    expect(response.status).toBe(202);
    const { hitl } = await response.json();
    expect(validateHitlObject(hitl), JSON.stringify(validateHitlObject.errors)).toBe(true);
    return hitl;
  }
  function submit(hitl, body = inlineBody()) {
    return adapter.request(new URL(hitl.submit_url).pathname, { method: 'POST', headers: { authorization: `Bearer ${hitl.submit_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  it.each(['constructor', '__proto__', 'toString', 'unknown'])('rejects undeclared review type %s without storing a case', async (type) => {
    const response = await adapter.request(`/api/demo?type=${type}`, { method: 'POST' });
    expect(response.status).toBe(400);
    expect(adapter.runtime().store.size).toBe(0);
  });
  it('advertises v0.8 and emits a schema-valid unopened inline decision', async () => {
    const discovery = await (await adapter.request('/.well-known/hitl.json')).json();
    expect(validateDiscoveryResponse(discovery), JSON.stringify(validateDiscoveryResponse.errors)).toBe(true);
    expect(discovery.hitl_protocol.spec_version).toBe('0.8');
    const hitl = await create();
    expect((await submit(hitl)).status).toBe(200);
    const poll = await (await adapter.request(new URL(hitl.poll_url).pathname)).json();
    expect(validatePollResponse(poll)).toBe(true);
    expect(poll).not.toHaveProperty('responded_by');
    expect(poll.submission_context).toMatchObject({ mode: 'inline_submit', submitted_by: { platform_user_id: 'claimed-user' } });
  });
  it('rejects duplicate decisions without changing result or etag', async () => {
    const hitl = await create();
    expect((await submit(hitl)).status).toBe(200);
    const rc = adapter.runtime().store.get(hitl.case_id);
    const result = structuredClone(rc.result); const etag = rc.etag;
    expect((await submit(hitl, inlineBody('cancel'))).status).toBe(409);
    expect(rc.result).toEqual(result); expect(rc.etag).toBe(etag);
  });
  it('rejects expired submits and expires stale polling before ETag matching', async () => {
    const hitl = await create(); const rc = adapter.runtime().store.get(hitl.case_id);
    const oldEtag = rc.etag; rc.expires_at = '2000-01-01T00:00:00Z';
    expect((await submit(hitl)).status).toBe(410);
    expect(rc.result).toBeNull();
    const response = await adapter.request(new URL(hitl.poll_url).pathname, { headers: { 'if-none-match': oldEtag } });
    expect(response.status).toBe(200);
    const poll = await response.json(); expect(poll.status).toBe('expired'); expect(validatePollResponse(poll)).toBe(true);
  });
  it.each([null, [], { action: 4 }, { action: 'confirm', data: 'bad' }, { action: 'unknown' }].map((body) => [body]))('rejects invalid inline bodies without a decision: %j', async (body) => {
    const hitl = await create();
    expect((await submit(hitl, body)).status).toBe(400);
    expect(adapter.runtime().store.get(hitl.case_id).result).toBeNull();
  });
  it('separately accepts browser action/data and rejects forged browser identity', async () => {
    const hitl = await create(); const review = new URL(hitl.review_url);
    const target = `/reviews/${hitl.case_id}/respond${review.search}`;
    const request = (body) => adapter.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await request({ action: 'confirm', submitted_by: { name: 'forged' } })).status).toBe(400);
    expect((await request({ action: 'confirm', data: {} })).status).toBe(200);
    expect(adapter.runtime().store.get(hitl.case_id).submission_context).toEqual({ mode: 'browser_submit' });
  });
  it('preserves script-like prompt text safely in the browser data contract', async () => {
    const hitl = await create(); const rc = adapter.runtime().store.get(hitl.case_id);
    rc.prompt = "$& $` $' {{hitl_data_json}} {{prompt}} </script><script>alert(1)</script>";
    rc.context = { description: "$& $` $' {{hitl_data_json}} {{prompt}} </script><script>alert(2)</script>" };
    const review = new URL(hitl.review_url);
    const html = await (await adapter.request(review.pathname + review.search)).text();
    expect(html).not.toContain('</script><script>alert(1)</script>');
    const raw = html.match(/id="hitl-data">([\s\S]*?)<\/script>/)[1];
    expect(JSON.parse(raw).prompt).toBe(rc.prompt);
    expect(JSON.parse(raw).context).toEqual(rc.context);
  });
  it('enforces both token purposes and allowed inline actions without mutation', async () => {
    const hitl = await create(); const reviewToken = new URL(hitl.review_url).searchParams.get('token');
    const target = new URL(hitl.submit_url).pathname;
    expect((await adapter.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(inlineBody()) })).status).toBe(401);
    expect((await adapter.request(target, { method: 'POST', headers: { authorization: `Bearer ${reviewToken}`, 'content-type': 'application/json' }, body: JSON.stringify(inlineBody()) })).status).toBe(401);
    expect((await adapter.request(`/review/${hitl.case_id}?token=${hitl.submit_token}`)).status).toBe(401);
    expect(adapter.runtime().store.get(hitl.case_id).result).toBeNull();
    const approval = await create('approval');
    expect((await submit(approval, inlineBody('edit'))).status).toBe(403);
    expect(adapter.runtime().store.get(approval.case_id).result).toBeNull();
  });
  it('validates the actual input producer contract before completing a browser decision', async () => {
    const hitl = await create('input'); const review = new URL(hitl.review_url);
    const target = `/reviews/${hitl.case_id}/respond${review.search}`;
    const request = (data) => adapter.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit', data }) });
    const valid = { salary_expectation: 65000, start_date: '2026-10-20', work_auth: 'citizen' };
    for (const data of [{ ...valid, salary_expectation: '65000' }, { ...valid, start_date: '2026-02-30' }, { ...valid, work_auth: 'unknown' }]) expect((await request(data)).status).toBe(400);
    expect((await request(valid)).status).toBe(200);
    expect(adapter.runtime().store.get(hitl.case_id).result.data).toEqual(valid);
  });
  it('rejects invalid selection IDs and malformed JSON on the actual browser endpoint', async () => {
    const hitl = await create('selection'); const review = new URL(hitl.review_url);
    const target = `/reviews/${hitl.case_id}/respond${review.search}`;
    expect((await adapter.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' })).status).toBe(400);
    const request = (selected) => adapter.request(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'select', data: { selected } }) });
    expect((await request(['missing'])).status).toBe(400);
    expect((await request(['job_001'])).status).toBe(200);
  });
});

describe('Actual Hono parsing interleavings', () => {
  function delayedRequest(hitl) {
    let controller;
    const body = new ReadableStream({ start(value) { controller = value; } });
    const request = new Request(`http://localhost/reviews/${hitl.case_id}/respond`, { method: 'POST', headers: { authorization: `Bearer ${hitl.submit_token}`, 'content-type': 'application/json' }, body, duplex: 'half' });
    return { response: hono.app.fetch(request), finish: (action) => { controller.enqueue(new TextEncoder().encode(JSON.stringify(inlineBody(action)))); controller.close(); } };
  }
  async function create() { return (await (await hono.app.request('/api/demo?type=confirmation', { method: 'POST' })).json()).hitl; }
  it('allows exactly one of two concurrent opposing decisions', async () => {
    const hitl = await create(); const first = delayedRequest(hitl); const second = delayedRequest(hitl);
    first.finish('confirm'); second.finish('cancel');
    const responses = await Promise.all([first.response, second.response]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningAction = responses[0].status === 200 ? 'confirm' : 'cancel';
    expect(hono.store.get(hitl.case_id).result.action).toBe(winningAction);
  });
  it('cannot complete when the deadline passes while request body parsing waits', async () => {
    const hitl = await create(); const pending = delayedRequest(hitl); const rc = hono.store.get(hitl.case_id);
    rc.expires_at = '2000-01-01T00:00:00Z'; pending.finish('confirm');
    expect((await pending.response).status).toBe(410); expect(rc.result).toBeNull();
  });
});
