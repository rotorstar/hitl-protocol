# Agent Implementation Checklist

This document provides a step-by-step guide for implementing HITL Protocol support in an autonomous agent.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Your Agent                         │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   HTTP       │  │   HITL       │  │   Message     │  │
│  │   Client     │──│   Handler    │──│   Delivery    │  │
│  │             │  │              │  │               │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
│                          │                              │
│                   ┌──────┴───────┐                      │
│                   │   Poll       │                      │
│                   │   Manager    │                      │
│                   └──────────────┘                      │
└─────────────────────────────────────────────────────────┘
         │                  │                    │
    API calls          Poll/SSE            Telegram/Slack
         │                  │              WhatsApp/CLI
         ▼                  ▼                    ▼
    ┌─────────┐      ┌─────────┐          ┌─────────┐
    │ Service │      │ Service │          │  Human  │
    │  API    │      │  Poll   │          │         │
    └─────────┘      └─────────┘          └─────────┘
```

## Decision Tree

```
Agent receives HTTP response from service
│
├── Status 200
│   └── Use result directly, continue workflow
│
├── Status 202 + "hitl" in body
│   ├── Extract hitl.review_url and hitl.prompt
│   ├── Send URL + prompt to human via messaging channel
│   │
│   ├── Transport: choose one
│   │   ├── Polling (default): GET hitl.poll_url every 30s-5min
│   │   ├── SSE: connect to hitl.events_url, listen for events
│   │   └── Callback: register hitl_callback_url, wait for POST
│   │
│   ├── On status "pending"
│   │   └── Continue waiting
│   │
│   ├── On status "opened"
│   │   └── (Optional) Inform human "Review page opened"
│   │
│   ├── On status "in_progress"
│   │   └── (Optional) Inform human "Reviewer is working on it"
│   │
│   ├── On status "completed"
│   │   ├── Extract result.action and result.data
│   │   ├── Check for next_case_id (multi-round)
│   │   └── Continue workflow with structured result
│   │
│   ├── On status "expired"
│   │   ├── Read default_action from hitl object
│   │   ├── Execute default_action (skip/approve/reject/abort)
│   │   └── Inform human "Review expired, using default: {action}"
│   │
│   └── On status "cancelled"
│       ├── Read reason
│       └── Inform human "Review cancelled: {reason}"
│
├── Status 4xx
│   └── Handle client error (bad request, auth, etc.)
│
└── Status 5xx
    └── Handle server error (retry with backoff)
```

## Minimum Implementation (Polling)

The simplest HITL-compliant agent needs only these capabilities:

### Checklist

- [ ] **Detect HTTP 202** — Check response status code for 202
- [ ] **Parse HITL object** — Extract `hitl` from response body JSON
- [ ] **Validate required fields** — Ensure `review_url`, `poll_url`, `type`, `prompt`, `case_id` exist
- [ ] **Forward review URL** — Send `hitl.review_url` to the human with `hitl.prompt` as context
- [ ] **Poll for result** — `GET hitl.poll_url` at 30-second to 5-minute intervals
- [ ] **Handle `completed`** — Extract `result.action` and `result.data`, continue workflow
- [ ] **Handle `expired`** — Execute `hitl.default_action` or inform user
- [ ] **Handle `cancelled`** — Inform user, abort or skip depending on workflow

### Pseudocode

```python
import time
import httpx

def handle_response(response, send_to_user):
    if response.status_code != 202:
        return response.json()  # Normal response

    body = response.json()
    hitl = body.get("hitl")
    if not hitl:
        return body  # 202 without HITL (standard async)

    # Forward URL to human
    message = body.get("message", hitl["prompt"])
    send_to_user(f"{message}\n\n{hitl['review_url']}")

    # Poll for result
    while True:
        time.sleep(30)
        poll = httpx.get(
            hitl["poll_url"],
            headers={"Authorization": "Bearer <token>"}
        ).json()

        status = poll["status"]

        if status == "completed":
            return poll["result"]

        if status == "expired":
            return {
                "action": hitl.get("default_action", "skip"),
                "data": {},
                "expired": True
            }

        if status == "cancelled":
            return {
                "action": "cancelled",
                "data": {"reason": poll.get("reason")},
                "cancelled": True
            }

        # pending, opened, in_progress → keep polling
```

## Enhanced: SSE Transport

Add real-time status updates without a public endpoint.

### Additional Checklist

- [ ] **Connect to SSE** — If `hitl.events_url` exists, open SSE connection
- [ ] **Handle events** — Process `review.opened`, `review.in_progress`, `review.completed`, `review.expired`, `review.cancelled`, `review.reminder`
- [ ] **Reconnection** — Track `Last-Event-ID`, reconnect on disconnect
- [ ] **Fallback to polling** — If SSE connection fails, fall back to polling

### Pseudocode

```python
import httpx_sse

def handle_hitl_sse(hitl, send_to_user):
    events_url = hitl.get("events_url")
    if not events_url:
        return handle_hitl_polling(hitl, send_to_user)  # Fallback

    try:
        with httpx_sse.connect(events_url, headers=auth) as sse:
            for event in sse:
                if event.event == "review.opened":
                    send_to_user("Review page opened")

                elif event.event == "review.completed":
                    data = json.loads(event.data)
                    return data["result"]

                elif event.event == "review.expired":
                    data = json.loads(event.data)
                    return {"action": data["default_action"], "expired": True}

                elif event.event == "review.cancelled":
                    data = json.loads(event.data)
                    return {"action": "cancelled", "reason": data.get("reason")}

                elif event.event == "review.reminder":
                    send_to_user(f"Reminder: {hitl['review_url']}")

    except ConnectionError:
        return handle_hitl_polling(hitl, send_to_user)  # Fallback
```

## Enhanced: Callback Transport

For agents with publicly reachable endpoints.

### Additional Checklist

- [ ] **Expose webhook endpoint** — `POST /webhooks/hitl` on agent's server
- [ ] **Include callback URL** — Add `hitl_callback_url` in original API requests
- [ ] **Verify signatures** — Check `X-HITL-Signature: sha256=<hmac>` header
- [ ] **Handle callback events** — Process `review.completed`, `review.expired`, `review.cancelled`
- [ ] **Fallback to polling** — If callback delivery fails, poll endpoint remains source of truth

### Signature Verification

```python
import hmac
import hashlib

def verify_hitl_signature(body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(),
        body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

## Enhanced: Multi-Round Reviews

Support approval cycles with edit requests.

### Additional Checklist

- [ ] **Track `previous_case_id`** — When present, link to prior review case
- [ ] **Display chain context** — Show user which round they're in
- [ ] **Follow `next_case_id`** — After completion, check if service created a follow-up case
- [ ] **Handle `edit` action** — When `result.action` is `"edit"`, revise the artifact and expect a new case

### Flow

```
Round 1: Service creates case_id="review_draft1"
  → Human responds: action="edit", data={feedback: "Fix intro"}
  → Poll response includes next_case_id="review_draft2"

Round 2: Service creates case_id="review_draft2", previous_case_id="review_draft1"
  → Agent revises artifact based on edit feedback
  → Human responds: action="approve"
  → Workflow continues
```

## Enhanced: Input Forms

Handle structured form data in Input-type reviews.

### Additional Checklist

- [ ] **Parse `context.form`** — Detect single-step (`fields` array) vs multi-step (`steps` array)
- [ ] **Forward form metadata** — Include field count or step titles in message to human (e.g., "Please fill 6 fields" or "3-step form: Personal Info → Preferences → Review")
- [ ] **Handle `progress` in poll** — If `progress` object is present in `in_progress` response, relay to human (e.g., "Step 2 of 3, 4/8 fields completed")
- [ ] **Handle `submit` action** — `result.data` contains key-value pairs matching `context.form` field keys
- [ ] **Validate result keys** — Ensure expected required fields from `context.form` are present in `result.data`
- [ ] **Handle `sensitive` fields** — Do NOT log or display values for fields marked `sensitive: true`

### Flow

```
Input-type HITL response received
│
├── context.form.fields exists (single-step)
│   └── Forward review_url: "Please fill {N} fields: [URL]"
│
├── context.form.steps exists (multi-step wizard)
│   └── Forward review_url: "{N}-step form: [step titles]: [URL]"
│
├── Poll returns in_progress + progress
│   └── (Optional) "Step {current}/{total}, {completed}/{total_fields} fields done"
│
└── Poll returns completed
    ├── result.action = "submit"
    ├── result.data = { field_key: value, ... }
    └── Continue workflow with structured form data
```

## Enhanced: Reminders

Re-send URLs when humans haven't responded.

### Additional Checklist

- [ ] **Parse `reminder_at`** — Can be a single timestamp or array of timestamps
- [ ] **Schedule re-sends** — At each `reminder_at` timestamp, check if case is still pending/opened
- [ ] **Handle `review.reminder` SSE event** — If using SSE, listen for reminder events
- [ ] **Respect terminal states** — Do NOT send reminders for completed/expired/cancelled cases

## Delivery Modes

Choose URL delivery based on agent environment:

| Mode | When | How |
|------|------|-----|
| **Messaging** | Agent communicates via Telegram, Slack, WhatsApp | Send URL as clickable link |
| **Desktop** | Agent runs on user's machine (CLI) | `open` (macOS), `xdg-open` (Linux), `start` (Windows) |
| **Terminal QR** | Remote terminal, user has phone | Render QR code (`qrencode -t ANSI`) |

```python
import platform
import subprocess

def deliver_review_url(url: str, mode: str = "auto"):
    if mode == "auto":
        # Detect environment
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
            subprocess.run(["start", url], shell=True)

    elif mode == "qr":
        subprocess.run(["qrencode", "-t", "ANSI", url])
        print(f"\nOr open manually: {url}")

    elif mode == "messaging":
        # Send via messaging API (Telegram, Slack, etc.)
        pass
```

## What NOT to Do

- **Do NOT render the review UI.** The service hosts and renders the review page. The agent is a messenger.
- **Do NOT submit responses on behalf of the human.** Unless explicitly delegated.
- **Do NOT ignore HTTP 202 + HITL.** Proceeding without human input violates the protocol.
- **Do NOT poll too frequently.** Respect rate limits (max 60/min recommended). Check `Retry-After` header.
- **Do NOT store review URLs long-term.** URLs contain time-limited opaque tokens. They expire.
