# AAuth readiness assessment

Reviewed **2026-10-06** against HITL source commit `e6949a1eafb83e2dbf4e071b2a18b303dddacee6` and [AAuth Protocol revision 11](https://datatracker.ietf.org/doc/html/draft-hardt-oauth-aauth-protocol-11). This is an engineering assessment and a proposed implementation sequence. **There is no implemented AAuth binding or demonstrated AAuth interoperability in this repository.**

## Status and scope

The [IETF Datatracker](https://datatracker.ietf.org/doc/draft-hardt-oauth-aauth-protocol/) lists revision 11, dated 2026-09-25, as an active individual Internet-Draft. It is not an adopted IETF standard or an RFC. Recheck the latest revision before starting an adapter; pin the reviewed revision and related drafts in its contract and eval report.

The implemented v0.9 plan remains useful: core decision semantics, versioned schemas, Public Web and OAuth/DPoP access, confirmed enrollment, local grants, immutable operations, browser review and atomic execution. Those features establish our service's security boundaries. They do not implement every agent-auth protocol that uses signatures or human consent.

The immediate documentation work has these acceptance criteria:

| Task | Acceptance criteria |
|---|---|
| Identify the protocol | Name, draft revision, date and maturity are checked against primary sources. |
| Audit the implementation | Each claimed foundation has a source reference; missing wire support and identity assumptions are explicit. |
| Align public wording | README and profile describe implemented bindings separately from future AAuth work; discovery advertises no unimplemented capability. |
| Define preparation | Future tasks have dependencies and measurable gates; no placeholder authenticator, invented identity or unchecked authorization is added. |
| Verify | Documentation links and diff pass; the existing Agent Access package suite is run as a regression check, with no AAuth conformance implication. |

## What exists in the code

| Boundary | Implementation evidence | Consequence for future work |
|---|---|---|
| Authentication and domain commands are separated | [Keycloak authenticator](../packages/agent-access/src/keycloak.ts), [route composition](../implementations/agent-access/reference/src/app.tsx), [persistent domain store](../implementations/agent-access/reference/src/store.ts) | Crypto/provider verification can be developed separately from review and booking commands. |
| The API facts contract is OAuth-specific | `AgentFactsSchema` in [canonical contracts](../packages/agent-access/src/contracts.ts); principals and enrollment use issuer, subject, client ID and DPoP thumbprint | The injectable `authenticate` method still returns this exact contract. Injection alone does not make it an AAuth adapter. |
| Existing protected requests require DPoP | [Keycloak authenticator](../packages/agent-access/src/keycloak.ts) accepts `Authorization: DPoP` and verifies fresh proof plus live introspection | An `Authorization: AAuth` credential cannot substitute for the required OAuth/DPoP proof. |
| Public attribution uses a different profile | [Public Web verifier](../packages/agent-access/src/public-web.ts), `PUBLIC_WEB_DRAFT` in [contracts](../packages/agent-access/src/contracts.ts) | Verified directory attribution grants no enrollment or booking rights. |
| Decisions and execution use persisted authority | [Store](../implementations/agent-access/reference/src/store.ts), [profile](../profiles/agent-access/v0.1/README.md#prepare-review-and-commit) | Preserve snapshot, grant/version, owner, deadline, idempotency and explicit-commit checks across any new binding. |
| Capability publication is explicit | `agentAccessDiscovery` and `AgentAccessContextSchema` in [contracts](../packages/agent-access/src/contracts.ts), [OpenAPI](../profiles/agent-access/v0.1/openapi.json) | Only the existing Public Web and delegated API profile IDs are announced. No AAuth metadata, challenge or token contract is published. |
| Existing verification covers our bindings | [Package tests](../packages/agent-access/src/__tests__), [real-service evals](../implementations/agent-access/reference/evals), [security re-audit](../implementations/agent-access/security-review.md) | Existing passes prove their stated scenarios; they are not AAuth test vectors or independent AAuth interoperability evidence. |

## Differences that need an explicit contract

AAuth uses `Signature-Key` and its own token, metadata and requirement vocabulary. Our Public Web binding uses `Signature-Agent`; our delegated API uses OAuth access tokens and DPoP. Sharing RFC 9421 does not make their wire formats interchangeable. AAuth also specifies consent, missions and deferred interactions, so HTTP 202 plus polling is not a compatibility test. [Draft sections 6–11](https://datatracker.ietf.org/doc/html/draft-hardt-oauth-aauth-protocol-11#section-6).

Some AAuth modes intentionally omit the agent identifier at the resource. Mapping those modes into our required OAuth client ID would invent an identity assertion. [Draft section 4.2 and appendix C.1.6](https://datatracker.ietf.org/doc/html/draft-hardt-oauth-aauth-protocol-11#appendix-C.1.6).

Our assessment is therefore: a future integration must specify its supported access mode, trusted issuers, verified person/key facts and local authorization rules before it changes the persistent principal model. Preserve the originating binding in stored authority so credentials from different mechanisms cannot collide or silently acquire one another's grants. The present `AgentFactsSchema` must not be weakened with arbitrary optional IDs to accommodate unverified data.

Authorization consent and a business decision need distinct purposes. A future integration may use HITL to present an interaction only when an explicit adapter preserves the surrounding authorization contract. A HITL confirmation alone must not mint an external authorization token, approve a mission or execute a booking. Existing service decisions remain tied to their immutable operation.

## Proposed implementation sequence

These tasks are **not implemented**. The first proposed scope is resource-managed access, which fits our service-owned enrollment and business policy; support for other modes requires its own assessment. No new binding identifier is reserved or advertised by this document.

| Task | Dependencies | Acceptance criteria |
|---|---|---|
| A1 — Pin the interoperability target | None | Recheck official drafts and usable implementations. Specify the exact access mode, trust model, endpoint/metadata/token/error contracts and consent purpose. Record unsupported modes. Review the threat model before introducing authority. |
| A2 — Define a separate versioned binding | A1 | Derive types and JSON Schemas from canonical runtime contracts. Define verified facts without fabricated client IDs; include binding/trust namespace in ownership and grant constraints. Preserve v0.1 behavior and historical artifacts. Negative fixtures reject mixed credentials, unknown mandatory capabilities and client-asserted identities. |
| A3 — Implement proof and discovery | A1, A2 | Verify the selected wire profile and token purposes; constrain metadata/key fetches, freshness, rotation and revocation. Shared two-process proof handling meets the service's replay policy. Unsupported schemes and failed dependencies never downgrade to another privileged binding. Official or independent signing vectors pass. |
| A4 — Integrate enrollment, review and execution | A2, A3 | Independently verify account ownership and local grants. Status and commit check the originating binding and current authorization. Consent does not enlarge rights or execute a booking. Changed terms, revocation and expiry prevent stale execution; retries preserve the recorded result. |
| A5 — Establish interoperability and publish | A1–A4 | A client without our SDK completes the declared mode against a real peer. Existing E1–E12 scenarios remain valid or gain explicitly documented binding variants. Two workers withstand 20 concurrent prepare/decision/commit requests with one operation, one winning decision and at most one booking. CI requires these gates before advertising the binding. |

The release claim must name the supported mode and pinned revision. A single working mode does not establish full AAuth implementation. Stable profile status still requires independent interoperability and threat-model review.

## Repository description

The public description checked on 2026-10-06 names service-hosted reviews, approvals, selections, forms and messenger actions. It does not mention Agent Access or AAuth. OAuth2 and DPoP are already repository topics.

Suggested description, based on implemented features:

> Open HTTP protocol for human decisions in AI agent workflows. Service-hosted reviews, structured results and optional Agent Access with OAuth/DPoP, verified requests and explicit execution.

Keep AAuth's draft status and future-binding detail in the README and this assessment. Publish an AAuth compatibility claim only after the corresponding interoperability gate passes. This review does not change GitHub repository settings.

## Verification of this assessment

The existing Agent Access package suite passed **78 tests across five files**. Local documentation validation found **104 existing targets and 11 valid Markdown heading anchors**, with no missing targets or anchors. These checks verify the current bindings and documentation; the full PostgreSQL/Keycloak/browser eval suite was not rerun for this documentation-only change. No AAuth interoperability was tested or claimed. Runtime code, schemas and discovery remain unchanged.
