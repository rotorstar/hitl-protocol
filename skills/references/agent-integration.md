# HITL Protocol — Agent Integration Guide

This guide is for **agent developers** who want to handle HITL responses from services.

The code below illustrates the historical **v0.8** contract used by the local demos. Validate it against [archived v0.8 schemas](../../schemas/v0.8/) or `@hitl-protocol/schemas/v0.8`; the [current normative contract is v0.9](../../spec/v0.9/hitl-protocol.md), which unversioned schema imports select. These snippets are application examples, not a complete authenticated agent SDK.

`completed` records a decision, not execution success or verified identity. Client-supplied channel metadata is a claim; only trusted service-side authentication and case authorization can establish `responded_by`. The optional draft [Agent Access profile](../../profiles/agent-access/v0.1/README.md) separately defines PKCE/OIDC owner enrollment, DPoP-bound grants and fresh explicit commit. A URL visit, callback payload, correlation ID or expiry default never grants execution authority. Validate service origins, response schemas and case correlation before consuming these examples; do not forward credentials to untrusted URLs.

## Core Concept

When a service needs human input, it returns HTTP 202 instead of 200. The response body contains a `hitl` object with a `review_url` (for the human) and a `poll_url` (for the agent). The agent forwards the URL, polls for the result, and continues.

## Implementation Checklist

### Minimum (Polling)

- [ ] **Detect HTTP 202** — check `response.status_code == 202`
- [ ] **Check for `hitl` in body** — not all 202s are HITL (standard async exists)
- [ ] **Validate required fields** — `review_url`, `poll_url`, `type`, `prompt`, `case_id`, `created_at`, `expires_at`
- [ ] **Forward review URL** — send `hitl.review_url` to human with `hitl.prompt` as context
- [ ] **Poll for result** — `GET hitl.poll_url` at 30-second to 5-minute intervals
- [ ] **Handle `completed`** — consume the decision; require the service's execution authorization and authoritative business result before reporting success
- [ ] **Handle `expired`** — return expiry status and inform the user; trusted service policy determines recovery, without implicit approval or commit
- [ ] **Handle `cancelled`** — inform user, abort or skip
- [ ] **Respect rate limits** — max 60 requests/min per case, check `Retry-After` header

### Enhanced (Optional)

- [ ] **SSE transport** — connect to `hitl.events_url` if present
- [ ] **Callback transport** — include `hitl_callback_url` in original request
- [ ] **Multi-round** — follow `next_case_id` for edit cycles
- [ ] **Input form metadata** — relay form step count/titles to human
- [ ] **Sensitive fields** — do NOT log values for fields with `sensitive: true`
- [ ] **Reminders** — re-send URL at `hitl.reminder_at` timestamps
- [ ] **Progress tracking** — relay `progress` from `in_progress` poll responses

## Historical v0.8 Polling Example

```python
import time
import httpx

def handle_response(response, send_to_user, auth_headers):
    """Handle any HTTP response, detecting HITL when present."""

    if response.status_code != 202:
        return response.json()  # Normal response

    body = response.json()
    hitl = body.get("hitl")
    if not hitl:
        return body  # 202 without HITL (standard async)

    # Validate required fields
    for field in ("spec_version", "review_url", "poll_url", "type", "prompt", "case_id", "created_at", "expires_at"):
        if field not in hitl:
            raise ValueError(f"HITL object missing required field: {field}")

    # Forward URL to human
    message = body.get("message", hitl["prompt"])
    send_to_user(f"{message}\n\n{hitl['review_url']}")

    # Poll for result
    while True:
        time.sleep(30)
        poll_response = httpx.get(hitl["poll_url"], headers=auth_headers)

        # Handle rate limiting
        if poll_response.status_code == 429:
            retry_after = int(poll_response.headers.get("Retry-After", 60))
            time.sleep(retry_after)
            continue

        poll_response.raise_for_status()
        poll = poll_response.json()
        if poll.get("case_id") != hitl["case_id"]:
            raise ValueError("Poll response belongs to another case")
        status = poll["status"]

        if status == "completed":
            return poll  # Decision envelope; not an execution result

        if status == "expired":
            send_to_user("Review expired. No decision was recorded.")
            return poll  # Never manufacture an action/result on expiry

        if status == "cancelled":
            reason = poll.get("reason", "Case cancelled")
            send_to_user(f"Review cancelled: {reason}")
            return poll

        # pending, opened, in_progress → keep polling
        if status == "opened":
            pass  # Optional: send_to_user("Review page opened")
        if status == "in_progress" and "progress" in poll:
            p = poll["progress"]
            pass  # Optional: send_to_user(f"Step {p['current_step']}/{p['total_steps']}")
```

## URL Delivery Strategies

Choose based on your agent's environment:

| Mode | When | How |
|------|------|-----|
| **Messaging** (default) | Agent is a bot (Telegram, Slack, Discord, WhatsApp) | Send URL as clickable link in chat message |
| **Messaging + Inline** (v0.7) | Bot + Service provides `submit_url` | Native buttons in chat + URL fallback |
| **Desktop CLI** | Agent runs on user's own machine | `webbrowser.open(url)` |
| **Remote CLI** | Agent on remote server (SSH) | Print URL (optionally QR code) |

In most real deployments, the agent is a bot on a server — not on the human's device. The agent sends messages to the human via the messaging platform's API. The human taps the URL link, and the browser opens on **their** device.

```python
from urllib.parse import urlparse

def handle_hitl(hitl: dict, send_to_user) -> None:
    """Forward a HITL review to the human."""
    review_url = hitl["review_url"]

    # Validate URL
    parsed = urlparse(review_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Invalid review URL: must be HTTPS with a valid host")

    # Conservative example: policies or undeclared buttons use the browser.
    if has_inline_submit(hitl):
        send_inline_buttons(
            prompt=hitl["prompt"],
            actions=hitl["inline_actions"],
            review_url=review_url,       # Always include URL fallback
        )
    else:
        # Standard: send URL as clickable link
        send_to_user(f"{hitl['prompt']}\n{review_url}")
```

> **Desktop CLI agents** (running on the user's machine, e.g. Claude Code): Use `webbrowser.open(review_url)` to open the URL directly in the user's browser. This only applies when agent and human share the same device.

> **Remote CLI agents** (SSH): Print the URL for manual opening. Optionally render a QR code with `qrencode -t ANSI <url>` if installed.

## SSE Event Stream

If `hitl.events_url` is present, use SSE for real-time updates instead of polling:

```python
import httpx
from httpx_sse import connect_sse

def handle_hitl_sse(hitl, send_to_user, auth_headers):
    events_url = hitl.get("events_url")
    if not events_url:
        return handle_hitl_polling(hitl, send_to_user, auth_headers)

    try:
        with httpx.Client() as client:
            with connect_sse(client, "GET", events_url, headers=auth_headers) as source:
                source.response.raise_for_status()
                for event in source.iter_sse():
                    if event.event in ("review.completed", "review.expired", "review.cancelled"):
                        # Read the canonical decision/terminal state from the service.
                        return handle_hitl_polling(hitl, send_to_user, auth_headers)
                    elif event.event == "review.opened":
                        send_to_user("Review URL loaded; identity not established")
                    elif event.event == "review.reminder":
                        send_to_user(f"Reminder: {hitl['review_url']}")
    except httpx.TransportError:
        pass
    return handle_hitl_polling(hitl, send_to_user, auth_headers)
```

`handle_hitl_polling` above denotes your polling implementation. The [`httpx-sse` API](https://github.com/florimondmanca/httpx-sse) supports event iteration; implement bounded reconnection via `Last-Event-ID` only when the service supports replay. Fall back to polling on disconnect or transport failure. The local demos do not promise durable replay.

### SSE Event Types

| Event | Payload | When |
|-------|---------|------|
| `review.opened` | `{case_id, opened_at}` | Review URL loaded; human presence not established |
| `review.in_progress` | `{case_id, progress}` | Human interacts |
| `review.completed` | `{case_id, completed_at, result}` | Human submits |
| `review.expired` | `{case_id, expired_at, default_action}` | Timeout |
| `review.cancelled` | `{case_id, cancelled_at, reason}` | Service cancels the case |
| `review.reminder` | `{case_id, review_url}` | Reminder triggered |

## Callback/Webhook

For agents with a publicly reachable endpoint:

1. Include `hitl_callback_url` in your original API request
2. Expose `POST /webhooks/hitl` on your server
3. Verify signature: `X-HITL-Signature: sha256=<hmac>`

```python
import hmac, hashlib

def verify_hitl_signature(body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Still maintain polling as fallback — the service's case state is the source of truth. Verify case correlation and replay handling; a webhook signature alone does not confer execution authorization. The local reference demos do not implement callbacks.

## Multi-Round Reviews

Approval-type reviews may involve edit cycles:

```
Round 1: case_id="review_draft1"
  → Human: action="edit", data={feedback: "Fix the intro"}
  → Poll: next_case_id="review_draft2"

Round 2: case_id="review_draft2", previous_case_id="review_draft1"
  → Agent revises artifact based on feedback
  → Human: action="approve"
  → Workflow continues
```

After `completed` with `action="edit"`:
1. Check `poll.next_case_id` for the follow-up case
2. Revise your artifact based on `result.data.feedback`
3. Poll the new case until it completes

## Input Form Handling

When `type` is `"input"`, the `context.form` tells you about the form structure:

```python
hitl = response.json()["hitl"]

if hitl["type"] == "input" and "form" in hitl.get("context", {}):
    form = hitl["context"]["form"]

    if "steps" in form:
        # Multi-step wizard
        step_titles = [s["title"] for s in form["steps"]]
        total_fields = sum(len(s["fields"]) for s in form["steps"])
        send_to_user(
            f"{len(form['steps'])}-step form ({', '.join(step_titles)}). "
            f"{total_fields} fields total.\n{hitl['review_url']}"
        )
    elif "fields" in form:
        # Single-step form
        required = [f for f in form["fields"] if f.get("required")]
        send_to_user(
            f"Please fill {len(form['fields'])} fields "
            f"({len(required)} required).\n{hitl['review_url']}"
        )
```

### Sensitive Fields

Do not log or relay values marked `sensitive: true`. This metadata does not hide the field from an authorized poll consumer: context and `result.data` may contain personal data. Minimize service responses and enforce caller authorization; collect credentials through a separate appropriate authentication flow.

## Reminders

If `hitl.reminder_at` is present:

```python
import datetime

reminder_at = hitl.get("reminder_at")
if reminder_at:
    # Can be a single timestamp or array
    timestamps = [reminder_at] if isinstance(reminder_at, str) else reminder_at

    for ts in timestamps:
        reminder_time = datetime.datetime.fromisoformat(ts)
        # Schedule: if case is still pending/opened at reminder_time,
        # re-send the review URL to the human
```

Do NOT send reminders for terminal states (`completed`, `expired`, `cancelled`).

## Channel-Native Inline Actions (v0.7)

When a service includes `submit_url` and `submit_token` in the HITL object, the agent MAY render native messaging buttons for simple decisions instead of (or in addition to) a URL link.

### Detection

```python
def has_inline_submit(hitl: dict) -> bool:
    # Conservative sample: use the browser for any declared verification policy.
    return bool(hitl.get("submit_url") and hitl.get("submit_token")
                and hitl.get("inline_actions") and not hitl.get("verification_policy"))
```

A production client may support policy preflight instead: determine whether it can satisfy an allowed requirement branch for `inline_submit`, and otherwise use `review_url`. Never self-attest verification. This sample also uses the browser when optional `inline_actions` is absent instead of inventing buttons.

### Rendering Decision

```python
def render_hitl_message(hitl: dict, platform: str):
    review_type = hitl["type"]
    inline_actions = hitl.get("inline_actions")

    if not has_inline_submit(hitl):
        # No inline submit → URL-only (v0.5 behavior)
        return render_url_button(hitl["review_url"], "Review")

    if review_type == "confirmation":
        # 2 buttons: Confirm + Cancel — works on ALL platforms (incl. WhatsApp max 3)
        return render_inline_plus_url(
            actions=inline_actions or ["confirm", "cancel"],
            url=hitl["review_url"],
            url_label="View Details"
        )

    if review_type == "escalation":
        # 3 buttons: Retry + Skip + Abort — fits WhatsApp max 3
        # But if 'retry' is NOT in inline_actions, show only skip/abort inline
        return render_inline_plus_url(
            actions=inline_actions or ["retry", "skip", "abort"],
            url=hitl["review_url"],
            url_label="View Error Details"
        )

    if review_type == "approval":
        if inline_actions and "edit" not in inline_actions:
            # Simple approve/reject inline
            return render_inline_plus_url(
                actions=inline_actions,
                url=hitl["review_url"],
                url_label="Review & Edit"
            )
        else:
            # Edit needs browser → URL only
            return render_url_button(hitl["review_url"], "Review & Approve")

    if review_type in ("selection", "input"):
        # Always needs full review page
        if platform == "telegram":
            return render_webapp_button(hitl["review_url"], "Open")
        else:
            return render_url_button(hitl["review_url"], "Open")
```

### Inline Submit Handler

```python
import httpx

async def handle_inline_action(case_mapping: dict, action: str, user_info: dict):
    """After validating the platform callback and its case/recipient binding."""

    if action not in case_mapping["inline_actions"]:
        return {"success": False, "reason": "action_not_inline"}
    submitted_by = {
        "platform": user_info["platform"],
        "platform_user_id": user_info["platform_user_id"]
    }
    if user_info.get("display_name") is not None:
        submitted_by["display_name"] = user_info["display_name"]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            case_mapping["submit_url"],
            headers={
                "Authorization": f"Bearer {case_mapping['submit_token']}",
                "Content-Type": "application/json"
            },
            json={
                "action": action,
                "data": {},
                "submitted_via": user_info["submitted_via"],
                "submitted_by": submitted_by
            }
        )

    if response.status_code == 200:
        return {"success": True, "decision": response.json()}  # No execution claim
    elif response.status_code == 403:
        # Action not permitted inline → direct to review_url
        error = response.json()
        return {"success": False, "redirect_url": error.get("review_url", case_mapping["review_url"])}
    elif response.status_code == 409:
        return {"success": False, "reason": "already_responded"}
    elif response.status_code == 410:
        return {"success": False, "reason": "expired"}
    else:
        return {"success": False, "reason": f"http_{response.status_code}"}
```

### Platform-Specific Callback Data Encoding

Each messaging platform has different limits for action callback data. The agent must encode enough information to identify the case and action when a button is tapped.

Use opaque, expiring references to agent-side case mappings. Validate the platform callback's authenticity and bind it to the intended recipient and offered action before submitting. Correlation data is not authorization, and messaging metadata remains a claim from the service's perspective. Provider payload limits differ; consult the current provider documentation instead of assuming unrestricted JSON is safe.

For [Telegram inline buttons](https://core.telegram.org/bots/api#inlinekeyboardbutton), `callback_data` is limited to 1–64 bytes. The following local example avoids truncated case hashes and checks the encoded byte length.

**Telegram mapping table example:**

```python
import secrets
from datetime import datetime, timezone

# Agent-side in-memory mapping (or Redis/SQLite for persistence)
case_store: dict[str, dict] = {}

def register_case(hitl: dict, recipient_id: str) -> str:
    """Store a validated case for the intended platform recipient."""
    short_id = secrets.token_urlsafe(12)
    while short_id in case_store:
        short_id = secrets.token_urlsafe(12)
    case_store[short_id] = {
        "case_id": hitl["case_id"],
        "submit_url": hitl["submit_url"],
        "submit_token": hitl["submit_token"],
        "review_url": hitl["review_url"],
        "inline_actions": hitl["inline_actions"],
        "expires_at": hitl["expires_at"],
        "recipient_id": recipient_id
    }
    return short_id

def callback_data(short_id: str, action: str) -> str:
    """Generate Telegram callback_data (max 64 bytes)."""
    value = f"hitl:{short_id}:{action}"
    if len(value.encode("utf-8")) > 64:
        raise ValueError("Callback data exceeds Telegram's byte limit")
    return value

def resolve_callback(data: str, verified_recipient_id: str) -> tuple[dict, str] | None:
    """Call only after authenticating the platform callback transport."""
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "hitl":
        return None
    short_id, action = parts[1], parts[2]
    case = case_store.get(short_id)
    if not case or case["recipient_id"] != verified_recipient_id:
        return None
    expires_at = datetime.fromisoformat(case["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) >= expires_at:
        del case_store[short_id]
        return None
    return (case, action) if action in case["inline_actions"] else None
```

### Security: Never Leak submit_token

The `submit_token` MUST NOT appear in:
- Telegram `callback_data` (transits Telegram servers)
- Discord `custom_id` (transits Discord servers)
- Slack `action_id` or `value` (transits Slack servers)
- WhatsApp `reply.id` (transits WhatsApp servers)
- Any client-side or third-party visible field

Store `submit_token` only in the agent's own memory/database. Look it up using the case mapping when a button callback arrives.

### Enhanced Checklist (v0.7)

- [ ] **Detect `submit_url`** — check if `submit_url` and `submit_token` are present in the HITL object
- [ ] **Render native buttons** — for confirmation, escalation, simple approval when inline submit is available
- [ ] **Always include URL fallback** — render a URL button to `review_url` alongside inline buttons
- [ ] **Handle inline submit response** — `200` OK, `403` action not inline, `409` duplicate, `410` expired
- [ ] **Update message after action** — edit original message, remove buttons, show result
- [ ] **Never leak submit_token** — store only agent-side, never in callback data
- [ ] **Respect inline_actions** — only render buttons for actions listed in `inline_actions`
- [ ] **Preflight verification policy** — satisfy an allowed `inline_submit` requirement branch or use the browser; the conservative sample falls back for every declared policy
- [ ] **Authenticate callbacks** — check platform transport, intended recipient, case correlation, offered action and expiry; never treat a UI payload as proof of identity
- [ ] **Fallback to URL** — if platform doesn't support buttons or submit_url is absent, use URL-only delivery

## What NOT to Do

- **Do NOT render the review UI** — the service hosts the review page. The agent is a messenger.
- **Do NOT submit responses on behalf of the human** — unless the human explicitly triggered a native messaging button and `submit_url` is available.
- **Do NOT ignore HTTP 202 + HITL** — proceeding without human input violates the protocol.
- **Do NOT poll too frequently** — respect rate limits (max 60/min). Check `Retry-After` header.
- **Do NOT store review URLs long-term** — they contain time-limited tokens that expire.
- **Do NOT log or relay sensitive field values** — browser entry alone does not keep them out of service payloads.
- **Do NOT put `submit_token` in callback data** — it must never transit through third-party messaging servers.

## Decision Tree

```
Agent receives HTTP response
│
├── Status 200 → Use result directly
│
├── Status 202 + "hitl" in body
│   ├── Forward hitl.review_url to human with hitl.prompt
│   ├── Poll hitl.poll_url (or connect SSE / register callback)
│   │
│   ├── completed → consume decision; execution needs separate authorization/result
│   │   └── Check next_case_id for multi-round
│   ├── expired → return expiry, inform human; never infer approval/commit
│   └── cancelled → inform human, skip/abort
│
├── Status 202 without "hitl" → standard async (not HITL)
│
├── Status 429 → wait Retry-After seconds, retry
├── Status 4xx → handle client error
└── Status 5xx → retry with exponential backoff
```

## Detailed Agent Checklist

For the complete implementation guide with pseudocode for all transport modes, multi-round reviews, input forms, reminders, and delivery modes, see [agents/checklist.md](../../agents/checklist.md).
