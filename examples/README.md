# HITL Protocol Examples

Complete end-to-end examples demonstrating every review type and transport pattern.

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

## Structure

Each example (except 07) follows this structure:

```json
{
  "_comment": "HITL Protocol v0.5 — Example: [description]",
  "_spec": "https://github.com/rotorstar/hitl-protocol",
  "scenario": "Human-readable scenario description",
  "steps": [
    {
      "step": 1,
      "description": "What happens in this step",
      "request": { ... }
    },
    {
      "step": 2,
      "description": "Service returns HTTP 202",
      "response": {
        "status_code": 202,
        "body": {
          "status": "human_input_required",
          "hitl": { ... }
        }
      }
    }
  ]
}
```

## Validation

All HITL objects in these examples validate against the schemas in [`../schemas/`](../schemas/).

```bash
# Validate with ajv-cli
for f in examples/0[1-6]*.json; do
  echo "Validating $f..."
  jq '.steps[] | select(.response) | .response.body.hitl' "$f" | \
    ajv validate -s schemas/hitl-object.schema.json --spec=draft2020 -c ajv-formats -d -
done
```

## Quick Reference

### Flow Pattern

Every HITL interaction follows the same pattern:

```
1. Agent → Service:  POST /api/endpoint (standard HTTP request)
2. Service → Agent:  HTTP 202 + hitl object (human input needed)
3. Agent → Human:    Forward review_url via messaging channel
4. Human → Browser:  Opens URL, interacts with review page
5. Agent → Service:  GET poll_url (check status)
6. Service → Agent:  {status: "completed", result: {...}}
7. Agent:            Continues workflow with structured result
```
