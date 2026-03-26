# HITL Protocol Examples

Complete end-to-end examples demonstrating every review type, transport pattern, and the new v0.8 proof-of-human verification layer.

## Examples

| # | File | Review Type | Description |
|---|------|------------|-------------|
| 1 | [`01-job-search-selection.json`](01-job-search-selection.json) | Selection | Job board finds 5 positions, human selects 2 |
| 2 | [`02-deployment-approval.json`](02-deployment-approval.json) | Approval | CI/CD pipeline needs sign-off before production deploy |
| 3 | [`03-content-review-edit.json`](03-content-review-edit.json) | Approval (multi-round) | Blog post review with edit cycle and `previous_case_id` chain |
| 4 | [`04-input-form.json`](04-input-form.json) | Input | Job application needs salary, start date, and visa status |
| 5 | [`05-confirmation-gate.json`](05-confirmation-gate.json) | Confirmation | Email service confirms sending 3 application emails |
| 6 | [`06-escalation-error.json`](06-escalation-error.json) | Escalation | Deployment failed, human decides retry with modified params |
| 7 | [`07-well-known-hitl.json`](07-well-known-hitl.json) | Discovery | `.well-known/hitl.json` endpoint response |
| 8 | [`08-multi-step-input.json`](08-multi-step-input.json) | Input (multi-step) | Contractor onboarding wizard with conditional fields and progress tracking |
| 9 | [`09-inline-confirmation.json`](09-inline-confirmation.json) | Confirmation (Inline) | Native messaging buttons confirm without leaving chat |
| 10 | [`10-inline-escalation.json`](10-inline-escalation.json) | Escalation (Inline) | Native 3-button recovery flow in Slack |
| 11 | [`11-hybrid-approval.json`](11-hybrid-approval.json) | Approval (Hybrid) | Approve/reject inline; edit still requires browser review |
| 12 | [`12-embedded-selection.json`](12-embedded-selection.json) | Selection (Embedded) | Telegram Mini App WebView with URL fallback |
| 13 | [`13-quality-improvement-loop.json`](13-quality-improvement-loop.json) | Quality Loop | Service returns `improvement_suggestions` for enrichment cycles |
| 14 | [`14-inline-proof-of-human.json`](14-inline-proof-of-human.json) | Confirmation (Inline + PoH) | Inline submit succeeds with `verification_evidence` and normalized `verification_result` |
| 15 | [`15-step-up-verification.json`](15-step-up-verification.json) | Confirmation (Step-Up) | Inline path requires PoH and falls back to browser review |
| 16 | [`16-browser-verified-approval.json`](16-browser-verified-approval.json) | Approval (Browser + PoH) | High-stakes browser flow verifies proof on the service-hosted review surface |

## Structure

Most examples follow this structure:

```json
{
  "_comment": "HITL Protocol v0.8 — Example: [description]",
  "_spec": "https://github.com/rotorstar/hitl-protocol",
  "scenario": "Human-readable scenario description",
  "steps": [
    {
      "step": 1,
      "description": "What happens in this step",
      "request": { "...": "..." }
    },
    {
      "step": 2,
      "description": "Service returns HTTP 202",
      "response": {
        "status_code": 202,
        "body": {
          "status": "human_input_required",
          "hitl": { "...": "..." }
        }
      }
    }
  ]
}
```

`07-well-known-hitl.json` is a discovery document example rather than a review flow.

## v0.8 Verification Examples

- Example 14 shows low-risk inline submit with `verification_policy`, relayed `verification_evidence`, and normalized `submission_context.verification_result`.
- Example 15 shows the agent preflight rule and the 403 `verification_required` fallback pattern.
- Example 16 shows `browser_submit` verification, where the service hosts the proof flow and the agent only receives normalized verification output.

## Validation

All HITL objects in these examples validate against [`../schemas/hitl-object.schema.json`](../schemas/hitl-object.schema.json). Poll responses validate against [`../schemas/poll-response.schema.json`](../schemas/poll-response.schema.json). Inline submit examples also validate against [`../schemas/submit-request.schema.json`](../schemas/submit-request.schema.json). The discovery example validates against [`../schemas/discovery-response.schema.json`](../schemas/discovery-response.schema.json).

```bash
pnpm --dir tests/node test
pytest -v tests/python/test_schema.py
```

## Quick Reference

### Core Flow Pattern

```text
1. Agent → Service:  POST /api/endpoint
2. Service → Agent:  HTTP 202 + hitl object
3. Agent → Human:    Forward review_url or render compliant inline actions
4. Human → Browser:  Opens URL, interacts with review page if needed
5. Agent → Service:  GET poll_url
6. Service → Agent:  {status: "completed", result: {...}}
7. Agent:            Continues workflow with structured result
```

### Verification Step-Up Pattern

```text
1. Service declares verification_policy for inline_submit or browser_submit
2. Agent preflights whether inline requirements can be satisfied
3. If not, agent routes directly to review_url
4. If inline attempt still fails, service returns 403 verification_required or verification_failed
5. Agent falls back to review_url and continues polling
```
