# HITL v0.9 / Agent Access — implementation and eval report

**Initial implementation baseline.** The subsequent [security re-audit](security-review.md)
contains additional fixes, updated dependencies and the final verification results.
The versions, 637-case count and performance measurements below describe the initial
06:45 UTC run, not the current post-audit checkout.

Date: 2026-10-06. Full service eval run completed at 06:45 UTC. Technical draft gate: **passed**. Stable Agent Access profile gate: **pending external interoperability and threat-model review**.

## Implemented outcome

HITL v0.9 is the default wire/type/validator contract. Explicit `/v0.8` and `/v0.9` exports include their complete offline schema graphs and generated public types. The v0.8 specification, canonical schema files, aliases and archived OpenAPI remain byte-identical to the original `655eba84932669af057e3cd9cacb1c94ae51ae65` baseline.

The optional `hitl-agent-access/0.1` profile has separate Public Web and delegated API bindings. Its framework-independent package derives types and published schemas from Zod. The Hono reference uses a new PostgreSQL store, a real Keycloak public code/PKCE/DPoP client, separate browser/introspection clients, explicit owner enrollment, hash-only review capabilities, immutable operation snapshots, policy-controlled prepare, browser decisions and explicit atomic commit. Public URL identity confers no delegated rights or proof-of-humanity claim.

The operation binds the initiator, grant, offer, prices, terms and policy revisions. `reviews` is the sole decision source. A confirmation produces no booking; `bookings` and the stored operation result establish execution. Material offer/grant changes revise automatically. Shared policy promotion fences older workers. Composite foreign keys and immutable-binding/terminal triggers enforce the corresponding database invariants.

All implementation waves T0–T10 are represented in the source and verification below. The scope remains one namespace, EUR and local persisted bookings. External payment/booking adapters, cumulative budgets, subdelegation and tenant management are outside this reference.

## Baseline and versions

The original HEAD was archived separately and built with its frozen dependencies: 54 schema tests and 71 core tests passed. This separates the initial environment/dependency setup from actual baseline failures; no failing original test was normalized into a new expected result.

| Runtime / new dependency | Verified version |
|---|---|
| Node / pnpm / Python | 24.18.1 / 10.27.0 / 3.12.14 |
| PostgreSQL / Keycloak | 18.6 / 26.8.0 |
| TypeScript for new contracts/reference | 7.0.2 |
| Hono / Node server | 4.13.13 / 2.1.3 |
| pg / jose / oauth4webapi | 8.23.1 / 6.2.12 / 3.8.8 |
| Zod / canonicalize | 4.6.5 / 5.1.0 |
| http-message-sig / structured-headers | 0.3.0 / 2.1.0 |
| json-schema-to-typescript | 16.0.0 |
| Vitest for new packages / Playwright | 5.0.3 / 1.63.0 |
| pytest / jsonschema / referencing | 9.1.1 / 4.26.0 / 0.37.0 |
| FastAPI / httpx | 0.142.2 / 0.28.1 |

New versions and provider behavior were checked against primary documentation and published APIs. Relevant contracts: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html), [Web Bot Auth draft 00](https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol-00), [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html), [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers), [signature package](https://github.com/cloudflare/web-bot-auth/tree/main/packages/http-message-sig), [generator limitations](https://github.com/bcherny/json-schema-to-typescript#json-schema-draft-support), [OpenAPI 3.2.1](https://spec.openapis.org/oas/v3.2.1.html).

The fixture imports the official `basic` mappers for `sub` and `auth_time` explicitly and retains global audience checking. Introspection requires both the public resource and confidential introspection-client audience. The public agent receives no service secret. Existing demo framework/tooling versions are retained where an upgrade is unrelated to this contract change.

## Consumer and source-of-truth inventory

| Consumer | Wire contract / acceptance scope |
|---|---|
| Core package | Shared completion/deadline command, canonical transition graph, immutable final result |
| Schema package default | v0.9 types, guards, raw schemas, generated disjoint terminal/submission/form variants |
| Schema package `/v0.8`, `/v0.9` | Explicit isolated versions; supported-version guards reject unknown versions |
| Express, Hono, Next.js, FastAPI demos | v0.8; validated inline/browser input, direct completion, concurrent response and lazy-expiry handling |
| MCP demo | v0.8 review contract; versioned URL-elicitation transport, safe rendering/defaults/timestamps; no Agent Access binding |
| Templates and Playground | Explicit v0.8 local demo; terminal interaction disabled; retained input wizard |
| Active SDK/checklist/integration documentation | Default v0.9 and explicit historical imports; identity, expiry and execution boundaries corrected |
| Public Web reference | DB catalogue; anonymous and verified URL identity; common replay/cache/quota store |
| Delegated reference and CLI | v0.9 confirmation/polling plus optional delegated profile; real OAuth through explicit commit |
| Profile context and OpenAPI | Generated from runtime contracts; operation-specific authentication and errors |

Historical specifications and the archived skills-upload bundle are not active consumers and were preserved. This is a newly introduced reference database; no migration from the old in-memory demos is asserted.

## Final automated results

| Verification | Result |
|---|---|
| Frozen dependency installation | Passed; lockfile current |
| Workspace build, including Next.js production build | Passed |
| Strict typecheck, including reference/eval sources and compiler-negative schema fixtures | Passed |
| Schema / core / Agent Access / reference package tests | 192 / 89 / 65 / 2 passed |
| Node consumer/compliance suite | 97 passed |
| Python contract/compliance/reference suite | 150 passed |
| Real reference HTTP/OAuth/PostgreSQL evals | 39 passed; 0 failed |
| Real Chromium browser evals | 3 passed; 0 skipped, unexpected or flaky |
| Generated profile drift and offline `npm pack` consumer | Passed |
| Historical schema/specification byte checks and `git diff --check` | Passed |
| Changesets release-plan API | Public core/schema target 0.9.0; private workspaces excluded from publication |

There are **637 passing automated test/eval cases** across these suites, plus the build, type, archive, generation and packaged-consumer checks. Core/compliance retain their existing Vitest 4 tooling; the new packages use Vitest 5. Tests use controlled fixtures only for verification and failure injection.

The 39 final service cases ran serially against PostgreSQL 18.6 and Keycloak 26.8.0. Competition scenarios used two independently running Node processes sharing PostgreSQL. Public tests used an isolated schema and actual IPv4/IPv6 loopback peers. Production authentication, HTTP handlers, storage and transactions ran unchanged. The external directory upstream used controlled response fixtures; the actual production HTTPS/DNS transport was additionally checked by 29 deterministic transport tests without live external DNS/network dependencies.

Express/Hono/MCP regression tests use live endpoints. Next.js route handlers and FastAPI ASGI routes are also exercised directly for deterministic body-parsing/deadline races, alongside the Next.js production build. This does not assert deployment verification of those local demonstration services.

## Requirement-derived eval matrix

| Eval / tasks | Expected HTTP or state result | Observed invariant / result |
|---|---|---|
| E1 — T1–T4 | Versions 0.8/0.9 validate separately; unknown versions fail; illegal v0.9 types fail compilation | Shared 124 Node/Python contract fixtures agree; complete offline references; default v0.9; historical archive unchanged |
| E2 — T1, T4 | Unopened inline submission completes; losing response `409`; deadline `410`; malformed input `400` | No losing result/version overwrite; lazy expiry without timer; valid terminal timestamps and safe HTTP/MCP rendering |
| E3 — T3, T6 | Anonymous/verified `200`; invalid signature `400`; unavailable directory `503` | Correct directory URL/key attribution; same URL survives key rotation; another URL remains a distinct identity even with the same key; forwarding headers confer no identity |
| E4 — T5–T7 | Public replay has one `200`/one `429`; DPoP replay one `200`/one `401`; fresh proof retries | Replay persists across restart/two processes; independent RFC 9421 signer works; wrong PKCE, target, method, token/key and Bearer fallback fail; persistence failure grants no authority |
| E5 — T7 | Foreign owner/key `404`; missing Origin `403`; stale login `401`; expired enrollment `410` | Separate keys yield separate principals; 20 owner confirmations yield one principal/grant; GET creates no connection; original ten-minute deadline enforced; late auth expiry rolls back enrollment |
| E6 — T8, T9 | Refundable 100.00 ready; 100.01 review; non-refundable lower total review; 500.00 allowed; 500.01 `403` | Quantity and fee included in server arithmetic; local grant limit enforced; confirmation does not expand rights |
| E7 — T5, T8 | Identical retries recover one operation; changed input same key `409`; excessive link issue `429` | 20 prepares across processes create one operation/review and at most five links in a minute; older links remain usable; response loss does not create a new operation |
| E8 — T8 | Decision race has one winner and one conflict; expired decision fails; CSRF/foreign owner fail | Confirmation produces zero bookings; decline prevents commit; auth expiry at SQL dispatch returns `401` without expiring proposal; mobile 320px, keyboard and no-JS native flow pass; hostile text stays text; tokens absent from forwarded referrers/logs/OIDC state |
| E9 — T9 | 20 commits succeed with the same persisted result; invalid binding/stock/version conflicts fail | Exactly one booking, one stock reduction and transactional result/audit; SIGKILL before commit leaves no effect; lost response/crash after commit recover; winning revocation prevents effect; composite FKs and terminal/binding triggers reject invalid writes; old policy worker fenced |
| E10 — T7–T9 | AS outage `503`; revoked still-signed token `401`; stale versions `409`; only authorized unchanged status `304` | Zero booking on AS failure; expiry changes ETag before comparison; local scope removal/inactive grant gives `403` even with old ETag; foreign reads never `304`; restored current rights allow historical reads despite newer grant revision |
| E11 — T5, T6 | 100 cold requests use one fetch; warm requests none; quotas `429` + Retry-After | Peak parallel fetch one across processes; 100 IP-blocked requests do not consume global budget; distinct actual peer remains allowed; HTTPS/DNS pinning, private/literal IPs, redirect, timeout, byte/key/MIME bounds and cleanup verified |
| E12 — T3, T10 | SDK-free client discovers and completes the flow; unknown mandatory binding aborts | Independent Node/jose client with its own actual OAuth callback completes catalogue → enrollment → prepare → review/status → commit and one persisted booking; no repository SDK/types imported |

Technical success: **zero unexpected authorization successes, zero duplicate bookings, zero contradictory recorded decisions** in the defined eval corpus.

## Measured resource behavior

Final E11 measurements: local Darwin arm64, Node 24.18.1, PostgreSQL 18.6, two HTTP workers with pool maximum 10 each, controlled 150 ms directory upstream delay. Each phase sends 100 concurrent independently signed requests.

| Phase | p50 | p95 | Maximum | Batch | Directory fetches / peak concurrency |
|---|---|---|---|---|---|
| Cold | 394.74 ms | 426.13 ms | 434.96 ms | 435.03 ms | 1 / 1 |
| Warm | 193.16 ms | 204.07 ms | 205.10 ms | 206.90 ms | 0 additional / 0 additional |

These are observed local eval timings, not production capacity or a latency SLO. Fetch-count and concurrency invariants are acceptance gates.

## Corrections established by failed checks

Failures were investigated and fixed before the final passing run; no failed case was accepted by blind repetition or weakened authorization:

- Real Keycloak flows exposed omitted `sub`/`auth_time` mappers and the introspection audience requirement; the fixture now preserves strict verification.
- Actual cross-site native forms exposed Strict-cookie redirect behavior and `Origin: null` under `no-referrer`. The callback retains its Lax owner session, rotates Strict CSRF and serves clean form pages with `same-origin`; exact Origin checks remain mandatory.
- Public concurrency exposed a lease/cache race; a winner rechecks cache after acquiring its lease. Already IP-limited requests are rejected before charging the global budget.
- Deterministic production transport checks exposed bracketed IPv6 literal handling and a byte-limit/error-event race; literal rejection and immediate oversized-response rejection are enforced.
- Independent review exposed stale-policy workers, missing write-boundary freshness classification and missing local grant-read enforcement. Shared policy fencing, guarded writes and current local read authorization now cover these cases.
- The independent client initially lacked an actual registered callback receiver; it now owns a strict HTTP callback. Browser test helpers now handle Keycloak's password-only reauthentication page. These test-fixture corrections preserve the real provider path.

## Reproduction, artifacts and release gate

Follow [the run instructions](README.md). Start the isolated Compose services, wait for the real provider, install Chromium and build before the service evals. Run:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test
pnpm --filter hitl-tests-node test
python -m pip install -r tests/python/requirements.txt -r implementations/reference-service/python/requirements.txt
python -m pytest tests/python -q
pnpm --filter @hitl-protocol/schemas check:profile
pnpm --filter @hitl-protocol/schemas test:pack
pnpm eval:agent-access
pnpm eval:browser
```

Local machine-readable results are `reference/.eval/http-results.json`, `reference/.eval/browser-results.json` and `reference/.eval/public-performance.json`. CI uploads this directory; missing infrastructure or artifacts fail the job. Evals do not skip unavailable PostgreSQL, Keycloak or Chromium. Browser retries are disabled and CI forbids focused tests.

CI explicitly includes all new workspaces, strict/generated/packed contracts, legacy consumers, the real database/provider service suite and browser suite. Release is unlocked only by successful complete CI on a trusted main-branch push, with the exact evaluated SHA checked against the release checkout. The read-only Changesets plan targets public schemas/core 0.9.0; package metadata remains at the current 0.8.0 until the normal version step. Agent Access packages are private draft workspaces.

The local commands above passed. GitHub-hosted CI execution, publication and production deployment were not performed in this workspace. Stable profile promotion still requires an externally independent interoperability exercise and threat-model review. Web Bot Auth remains a draft, public directory identity does not certify a vendor/user, and external AS revocation can occur after the final uncached introspection observation. Only local revocation/execution are transactionally linearized; the observation age at the commit write is capped at two seconds.
