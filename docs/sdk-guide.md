# HITL Protocol — SDK Guide

> A good HITL SDK is 200 lines of code or less.

## Design Principle

HITL Protocol is intentionally simple — HTTP 202 + URL + polling. An SDK should make this easier, not more complex. The best SDKs are thin wrappers that handle the repetitive parts and get out of the way.

## What a Client SDK Should Do

An **agent-side** SDK helps agents detect and handle HITL responses:

1. **Detect HTTP 202** with a `hitl` object in the response body
2. **Parse the `hitl` object** and expose `review_url`, `poll_url`, `type`, `prompt`
3. **Forward the URL** to the human via the agent's messaging channel
4. **Poll loop** — respect `Retry-After`, use `ETag/If-None-Match`, handle 304
5. **Return structured result** when status reaches `completed`, `expired`, or `cancelled`

## What a Client SDK Should NOT Do

- **Render UI** — That's the service's job (review page)
- **Generate tokens** — That's the service's job
- **Mandate a framework** — Work with any HTTP client
- **Add dependencies** — Zero or near-zero deps
- **Be large** — If your SDK is >500 LOC, you're doing too much

## What a Server SDK Should Do

A **service-side** SDK helps services implement HITL endpoints:

1. **Token utilities** — `generateToken()`, `hashToken()`, `verifyToken()`
2. **HITL object builder** — Construct valid `hitl` objects with defaults
3. **State machine** — Validate status transitions
4. **Schema validation** — Validate against JSON Schema (optional)

## Example: Agent-Side SDK (TypeScript, ~80 LOC)

```typescript
interface HitlResponse {
  review_url: string;
  poll_url: string;
  type: string;
  prompt: string;
  case_id: string;
  timeout: string;
}

interface PollResult {
  status: 'completed' | 'expired' | 'cancelled';
  result?: { action: string; data: Record<string, unknown> };
}

export async function handleHitl(
  response: Response,
  onUrl: (url: string, prompt: string) => void,
  options?: { pollInterval?: number; maxWait?: number }
): Promise<PollResult | null> {
  if (response.status !== 202) return null;

  const body = await response.json();
  if (!body.hitl) return null;

  const hitl: HitlResponse = body.hitl;
  onUrl(hitl.review_url, hitl.prompt);

  const interval = options?.pollInterval ?? 30000;
  const maxWait = options?.maxWait ?? 24 * 60 * 60 * 1000;
  const deadline = Date.now() + maxWait;
  let etag = '';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;

    const poll = await fetch(hitl.poll_url, { headers });

    if (poll.status === 304) continue;
    if (poll.status === 429) {
      const retry = Number(poll.headers.get('Retry-After')) || 60;
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }

    const data = await poll.json();
    etag = poll.headers.get('ETag') || '';

    if (['completed', 'expired', 'cancelled'].includes(data.status)) {
      return data as PollResult;
    }
  }
  return { status: 'expired' };
}
```

## Community SDK Registry

| Language | Package | Maintainer | Status |
|----------|---------|------------|--------|
| — | — | — | *Be the first to build one!* |

## Contributing an SDK

1. Keep it under 500 LOC
2. Zero or minimal dependencies
3. Support at least: detect 202, parse hitl, poll with ETag
4. Include tests
5. [Open an issue](https://github.com/rotorstar/hitl-protocol/issues/new?template=implementation-report.md) to list it here
