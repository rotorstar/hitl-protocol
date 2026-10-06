# Security re-audit · 2026-10-06

Status: corrective implementation and final verification completed at 07:45 UTC.
This review supplements the
initial eval report; a passing functional suite did not establish the absence of
security defects. The profile remains a draft pending independent interoperability
and threat-model review.

## Scope and security boundaries

Reviewed the actual core, schemas, four local HTTP demos, MCP demo, optional Surface
Interop profile, Agent Access cryptography/provider adapters, PostgreSQL commands,
Hono browser/API routes, dependencies and release gates. Historical v0.8 artifacts
must remain byte-for-byte intact. The local demonstrators do not acquire the
persistent reference service's authentication guarantees.

The trusted authorization inputs are verified AS facts, current local principals
and grants, immutable operation snapshots, and independently authenticated browser
decisions. Agent-supplied identity metadata, UI payloads, links and callback bodies
are not authority. Public directory identity does not imply delegation. External
AS revocation still has the documented observation window; local revocation and
execution must be serialized by PostgreSQL.

## Corrective tasks and acceptance criteria

| Task / root cause | Correction and dependency | Acceptance criteria / verification | Done check |
|---|---|---|---|
| S1 · Proof validity and replay retention used different boundary/clock semantics | Shared persistent clock; exclusive expiry; recheck after asynchronous operations; retention covers the complete acceptance interval | Same proof cannot be accepted after replay cleanup; delayed crypto/discovery/DB and skewed worker clocks cannot extend validity; clock failure fails closed | Crypto unit regressions, package types/build |
| S2 · Introspection freshness omitted network latency and mixed worker/DB clocks | Observe DB time immediately before introspection; reject future/stale facts after locks and at booking write; stream-limit provider responses | More than two seconds from observation prevents execution with zero effects; response cancellation at 64 KiB; no future timestamp allowance | Crypto and real DB regressions |
| S3 · Privilege transition retained browser session ID | Rotate opaque session and CSRF atomically after OIDC; invalidate old sessions/attempts; retain case bindings only for anonymous or same-owner transition | Old cookies cannot authorize; two callbacks have one winner; identity switch drops bindings; actual browser reauthentication works | DB session tests and real browser flow |
| S4 · Unauthenticated expensive work preceded quotas; invalid review links allocated sessions | Shared pre-auth peer/global admission quotas; validate capabilities before allocation; require existing sessions for browser POST; charge agent before account quota | Rejected requests create no nonce/session/OIDC state; quota applies across both workers and ignores spoofed forwarding headers; legitimate retry works | Real HTTP/database admission regressions |
| S5 · Separate read snapshots and late time sample produced impossible status | One authorized state query with statement timestamp; namespace join on browser capabilities/review; recheck revocation freshness after locks | Concurrent completion is never projected as expiry; foreign namespace cannot read/decide; stale revocation rolls back | Eleven actual PostgreSQL/OIDC scenarios |
| S6 · Template replacement interpreted data as replacement/template syntax | Single callback-based insertion; own-property demo type checks; constrain Surface fallback URL; correct callback/identity/timeout guarantees | Dollar sequences and template delimiters remain literal; script-looking data does not execute; inherited names and executable fallback URLs rejected | Actual HTTP rendering, Python and schema regressions |
| S7 · Old dependency resolutions and missing ongoing security gate | Verify official current releases; update affected packages and transitive resolution; narrowly document any unpatched tooling-only exposure | No unexplained runtime advisories; audit errors cannot pass CI; remaining exceptions have exact advisory, path, input boundary and review date | Registry audit, build, all consumers and release-gate inspection |
| S8 · Cache expiry mixed worker/DB clocks; expired lease owners could publish over newer keys | Database time for TTL/cooldown; renew owned lease before HTTPS; fence successful and failed publication by current unexpired owner | Worker clock skew does not extend trust or defeat cooldown; displaced owners cannot overwrite a successor; 100 cold requests retain one upstream fetch | Four additional actual PostgreSQL cache regressions |
| S9 · Release action migration changed token/input semantics; context SHA and build credential exposure were not checked | Pin official action commits; least-privilege tokens; require checkout and workflow context SHA to equal the evaluated commit; configure registry auth only for publication of already built packages | Valid current action inputs; no workspace build receives publishing credentials; failed publisher/audit fails CI; missing registry token invokes no publisher | Actionlint and nine audit/release-script tests |

Implementation order: S1/S2 and S3/S5 establish shared clock/store contracts; S4
integrates them into HTTP routes; S6 is independent; S7 precedes the complete
regression run. Required final gate: contract/build checks, all package and legacy
consumer suites, actual two-process PostgreSQL/Keycloak evals, browser evals,
dependency audits, historical artifact comparison, and whitespace/drift checks.

## References used

- [RFC 9449: DPoP](https://www.rfc-editor.org/rfc/rfc9449.html)
- [RFC 9700: OAuth Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP denial-of-service guidance](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

## Final results

The final integrated run passed all required cases. Completed checks:

| Check | Observed result |
|---|---|
| Frozen install; complete workspace/Next production build; strict typechecks | Passed |
| Schema / core / Agent Access / reference configuration | 203 / 89 / 78 / 9 tests passed |
| Actual legacy Node handlers/MCP and contract suite | 110 tests passed |
| Python contracts and FastAPI handlers | 150 tests passed |
| Actual two-process HTTP/PostgreSQL/Keycloak evals | 64 tests passed, zero skipped or failed; 82.18 seconds |
| Actual Chromium browser evals | 3 passed, zero skipped, unexpected or flaky; 5.7 seconds |
| Audit and publication wrapper regressions | 9 tests passed |
| Generated contract drift, compiler-negative fixtures, packed offline consumer | Passed |
| Historical archive | Nine schema/OpenAPI files byte-identical to original HEAD; v0.8 specification unchanged |
| Node dependency audit, including development/release tooling | Zero known advisories; no exceptions |
| Python requirements audit (`pip-audit 2.10.1 --strict`) | 37 dependencies; zero known vulnerabilities |
| CI/release syntax (`actionlint 1.7.12`) | Passed |

**715 automated cases passed**, including 78 additional cases compared with the
initial 637-case baseline. Build/type/archive/pack/drift and dependency-audit checks
are additional gates, not counted again as test cases. The final corpus records
zero unexpected authorization successes, zero duplicate bookings and zero
contradictory decisions. Session rotation preserves the JavaScript-free native
review flow, including keyboard navigation and a 320-pixel mobile viewport.

Final public catalogue measurements (local Darwin arm64, Node 24.18.1, PostgreSQL
18.6, two workers, 100 concurrent signed requests per phase, controlled 150 ms
directory upstream): cold p50/p95/max = 467.34/476.91/480.00 ms; warm =
185.75/196.95/202.21 ms. Cold fetches = 1 with peak concurrency 1; warm additional
fetches = 0. These are measured test-environment results, not a production SLO.

The initial Node audit contained 125 advisory records / 137 reported findings.
Updating current direct and compatible transitive versions removed them, including
the unpatched `braces` and `sprintf-js` paths through the former Changesets CLI.
The sole scoped override replaces vulnerable esbuild 0.27.x selected by current
tsup with 0.28.2; its reason and removal condition are recorded in the workspace
configuration. No advisories are suppressed.

Verified runtime/tooling updates include Next 16.3.8, React 19.3.0, Hono 4.13.13,
Node server 2.1.3, MCP SDK 1.32.1, AJV 8.20.0, TypeScript 7.0.2, Vitest 5.0.3,
Vite 8.3.3 and Changesets 3.0.3. The supported Node 24 and pnpm 10 lines remain;
pnpm is pinned to 10.34.6. Core declarations now use the native TypeScript compiler,
as the current tsup declaration compiler does not support TypeScript 7.

The first combined HTTP run passed 38 cases but failed the business suite's
startup before its 26 cases ran. The raw timeout and timing match the initial
five-second OIDC discovery readiness probe; the original report lacked a phase
trace, so the underlying transient stall cannot be established conclusively.
That failed result is retained in
`reference/.eval/http-security-first-failed.json`; it is not counted as a passing
run. Provider logs showed no business-suite login attempts in that interval.
Startup diagnostics were strengthened to identify phase, elapsed time and cause;
authentication limits and assertion thresholds were not relaxed. Provider log
review separately found Keycloak's deprecated `fullScopeAllowed` default; the
fixture now uses explicit client scopes and mappers with that setting disabled.
Actual admin-API inspection confirmed the setting on all three clients. The
unchanged 26-case auth/business suite passed against that configuration, followed
by the complete 64-case HTTP and three-case browser run. No automatic test retries
or relaxed assertions converted the failed run into a pass.

Reproduction and evidence:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test
pnpm --filter hitl-tests-node test
node --test scripts/*.test.mjs
pnpm run audit:dependencies
python -m pytest tests/python -q
pip-audit --strict -r tests/python/requirements.txt -r implementations/reference-service/python/requirements.txt
pnpm --filter @hitl-protocol/schemas check:profile
pnpm --filter @hitl-protocol/schemas test:pack
node implementations/agent-access/reference/scripts/wait-for-provider.mjs
pnpm eval:agent-access
pnpm eval:browser
```

Use the isolated Compose/Chromium setup in [README](README.md) first. Local JSON
evidence is in root `.eval/security-verification.json`,
`.eval/dependency-security-audit.json`, `.eval/python-dependency-security-audit.json`
and `reference/.eval/{http-results,browser-results,public-performance}.json`. These
generated files are ignored by Git; CI uploads reference eval results. Registry
audits are point-in-time checks and now run on every CI push/PR. CI or registry
failure blocks the existing release gate. Public core/schema release planning
still targets 0.9.0; private draft packages are excluded from npm publication.

All owned HTTP/browser workers exited. The isolated Keycloak/PostgreSQL eval
containers were stopped after verification; their database volume was retained.
No release, publication or production deployment was performed. Known limitations
remain the authorization server's revocation observation window, the draft status
of Web Bot Auth, and the absence of externally independent profile certification.
The suite verifies specified invariants; it is not a proof that no undiscovered
vulnerabilities exist. Gateway connection/bandwidth limits, secure deployment
configuration, secret lifecycle and operational monitoring remain responsibilities
of a production adopter.
