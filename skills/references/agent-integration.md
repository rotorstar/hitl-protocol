# HITL Protocol — Agent Integration Guide

This guide is for **agent developers** who want to handle HITL responses from services.

## Core Concept

When a service needs human input, it returns HTTP 202 instead of 200. The response body contains a `hitl` object with a `review_url` (for the human) and a `poll_url` (for the agent). The agent forwards the URL, polls for the result, and continues.

## Implementation Checklist

### Minimum (Polling)

- [ ] **Detect HTTP 202** — check `response.status_code == 202`
- [ ] **Check for `hitl` in body** — not all 202s are HITL (standard async exists)
- [ ] **Validate required fields** — `review_url`, `poll_url`, `type`, `prompt`, `case_id`, `created_at`, `expires_at`
- [ ] **Forward review URL** — send `hitl.review_url` to human with `hitl.prompt` as context
- [ ] **Poll for result** — `GET hitl.poll_url` at 30-second to 5-minute intervals
- [ ] **Handle `completed`** — extract `result.action` and `result.data`, continue workflow
- [ ] **Handle `expired`** — execute `hitl.default_action` or inform user
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

## Complete Polling Implementation

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
    for field in ("review_url", "poll_url", "type", "prompt", "case_id"):
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

        poll = poll_response.json()
        status = poll["status"]

        if status == "completed":
            return poll["result"]  # {action: "select", data: {...}}

        if status == "expired":
            default = hitl.get("default_action", "skip")
            send_to_user(f"Review expired. Using default action: {default}")
            return {"action": default, "data": {}, "expired": True}

        if status == "cancelled":
            reason = poll.get("reason", "User cancelled")
            send_to_user(f"Review cancelled: {reason}")
            return {"action": "cancelled", "data": {}, "cancelled": True}

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
| **Messaging** | Telegram, Slack, WhatsApp, Discord | Send as clickable link |
| **Desktop CLI** | Agent runs on user's machine | `open` (macOS), `xdg-open` (Linux), `start` (Windows) |
| **Terminal QR** | Remote SSH session | `qrencode -t ANSI {url}` |

```python
import platform, subprocess, os

def deliver_url(url: str, mode: str = "auto"):
    if mode == "auto":
        if os.environ.get("TELEGRAM_BOT_TOKEN"):
            mode = "messaging"
        elif os.environ.get("SSH_CONNECTION"):
            mode = "qr"
        else:
            mode = "desktop"

    if mode == "desktop":
        system = platform.system()
        if system == "Darwin":
            subprocess.run(["open", url])
        elif system == "Linux":
            subprocess.run(["xdg-open", url])
        elif system == "Windows":
            os.startfile(url)
    elif mode == "qr":
        subprocess.run(["qrencode", "-t", "ANSI", url])
        print(f"\nOr open: {url}")
```

## SSE Event Stream

If `hitl.events_url` is present, use SSE for real-time updates instead of polling:

```python
import httpx_sse, json

def handle_hitl_sse(hitl, send_to_user, auth_headers):
    events_url = hitl.get("events_url")
    if not events_url:
        return handle_hitl_polling(hitl, send_to_user, auth_headers)

    try:
        with httpx_sse.connect(events_url, headers=auth_headers) as sse:
            for event in sse:
                if event.event == "review.completed":
                    data = json.loads(event.data)
                    return data["result"]

                elif event.event == "review.expired":
                    data = json.loads(event.data)
                    return {"action": data["default_action"], "expired": True}

                elif event.event == "review.cancelled":
                    data = json.loads(event.data)
                    return {"action": "cancelled", "reason": data.get("reason")}

                elif event.event == "review.opened":
                    send_to_user("Review page opened")

                elif event.event == "review.reminder":
                    send_to_user(f"Reminder: {hitl['review_url']}")

    except ConnectionError:
        return handle_hitl_polling(hitl, send_to_user, auth_headers)
```

Support reconnection via `Last-Event-ID` header. Always fall back to polling on failure.

### SSE Event Types

| Event | Payload | When |
|-------|---------|------|
| `review.opened` | `{case_id, opened_at}` | Human opens URL |
| `review.in_progress` | `{case_id, progress}` | Human interacts |
| `review.completed` | `{case_id, completed_at, result}` | Human submits |
| `review.expired` | `{case_id, expired_at, default_action}` | Timeout |
| `review.cancelled` | `{case_id, cancelled_at, reason}` | Human cancels |
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

Still maintain polling as fallback — the poll endpoint is the source of truth.

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

Fields with `sensitive: true` (like salary, passwords) MUST NOT be logged or displayed by the agent. Only the human sees these values in the browser.

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

## What NOT to Do

- **Do NOT render the review UI** — the service hosts the review page. The agent is a messenger.
- **Do NOT submit responses on behalf of the human** — unless explicitly delegated.
- **Do NOT ignore HTTP 202 + HITL** — proceeding without human input violates the protocol.
- **Do NOT poll too frequently** — respect rate limits (max 60/min). Check `Retry-After` header.
- **Do NOT store review URLs long-term** — they contain time-limited tokens that expire.
- **Do NOT log sensitive field values** — fields marked `sensitive: true` are for human eyes only.

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
│   ├── completed → use result.action + result.data
│   │   └── Check next_case_id for multi-round
│   ├── expired → execute default_action, inform human
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
