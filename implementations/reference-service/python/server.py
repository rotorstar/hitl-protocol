"""
HITL Protocol v0.5 — Reference Implementation (FastAPI)

Same features as Express/Hono variants.

Usage:
    pip install -r requirements.txt
    uvicorn server:app --port 3458
    curl -X POST http://localhost:3458/api/demo?type=selection
"""

import asyncio
import hashlib
import hmac
import html as html_module
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

app = FastAPI(title="HITL Reference Service (FastAPI)")

PORT = int(os.environ.get("PORT", "3458"))
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}")
TEMPLATES_DIR = Path(__file__).parent.parent.parent.parent / "templates"


# ============================================================
# Token Utilities
# ============================================================

def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def verify_token(token: str, stored_hash: bytes) -> bool:
    candidate = hash_token(token)
    return hmac.compare_digest(candidate, stored_hash)


# ============================================================
# Store + State Machine
# ============================================================

store: dict[str, dict[str, Any]] = {}
sse_queues: dict[str, list[asyncio.Queue]] = {}
rate_limits: dict[str, dict[str, Any]] = {}
RATE_LIMIT = 60

VALID_TRANSITIONS = {
    "pending": ["opened", "expired", "cancelled"],
    "opened": ["in_progress", "completed", "expired", "cancelled"],
    "in_progress": ["completed", "expired", "cancelled"],
    "completed": [],
    "expired": [],
    "cancelled": [],
}


def transition(rc: dict, new_status: str) -> None:
    allowed = VALID_TRANSITIONS.get(rc["status"], [])
    if new_status not in allowed:
        raise ValueError(f"Invalid: {rc['status']} → {new_status}")
    rc["status"] = new_status
    rc[f"{new_status}_at"] = datetime.now(timezone.utc).isoformat()
    rc["version"] += 1
    rc["etag"] = f'"v{rc["version"]}-{new_status}"'
    # Clean up resources on terminal state
    if new_status in ("completed", "expired", "cancelled"):
        rate_limits.pop(rc["case_id"], None)
    # Notify SSE
    queues = sse_queues.get(rc["case_id"], [])
    payload = {"case_id": rc["case_id"], "status": rc["status"]}
    if rc.get("result"):
        payload["result"] = rc["result"]
    msg = f"event: review.{new_status}\ndata: {json.dumps(payload)}\nid: evt_{int(time.time() * 1000)}\n\n"
    for q in queues:
        q.put_nowait(msg)


async def schedule_expiration(case_id: str, delay: float) -> None:
    """Auto-expire a review case after the given delay (seconds)."""
    await asyncio.sleep(delay)
    rc = store.get(case_id)
    if rc and rc["status"] in ("pending", "opened", "in_progress"):
        try:
            transition(rc, "expired")
        except ValueError:
            pass


def check_rate_limit(case_id: str) -> dict:
    now = time.time()
    entry = rate_limits.get(case_id)
    if not entry or now > entry["reset_at"]:
        entry = {"count": 0, "reset_at": now + 60}
        rate_limits[case_id] = entry
    entry["count"] += 1
    return {"allowed": entry["count"] <= RATE_LIMIT, "remaining": max(0, RATE_LIMIT - entry["count"])}


# ============================================================
# Sample Data
# ============================================================

SAMPLE_CONTEXTS = {
    "selection": {"items": [
        {"id": "job_001", "title": "Senior Frontend Engineer", "description": "React/Next.js at TechCorp, Berlin.", "metadata": {"salary": "85-110k EUR", "remote": "Hybrid"}},
        {"id": "job_002", "title": "Full-Stack Developer", "description": "Node.js + React at StartupXYZ, Munich.", "metadata": {"salary": "70-95k EUR", "remote": "Fully remote"}},
        {"id": "job_003", "title": "Tech Lead", "description": "Team of 8, microservices.", "metadata": {"salary": "110-140k EUR", "remote": "On-site"}},
    ]},
    "approval": {"artifact": {"title": "Production Deployment v2.4.0", "content": "Changes:\n- Updated auth\n- Fixed rate limiter\n- Added HITL support\n\nRisk: Medium\nRollback: Automated", "metadata": {"environment": "production", "commit": "a1b2c3d"}}},
    "input": {"form": {"fields": [
        {"key": "salary_expectation", "label": "Salary Expectation (EUR)", "type": "number", "required": True, "validation": {"min": 30000, "max": 300000}},
        {"key": "start_date", "label": "Earliest Start Date", "type": "date", "required": True},
        {"key": "work_auth", "label": "Work Authorization", "type": "select", "required": True, "options": [{"value": "citizen", "label": "EU Citizen"}, {"value": "blue_card", "label": "Blue Card"}, {"value": "visa_required", "label": "Visa Required"}]},
    ]}},
    "confirmation": {"description": "The following emails will be sent:", "items": [{"id": "email_1", "label": "Application to TechCorp"}, {"id": "email_2", "label": "Application to StartupXYZ"}]},
    "escalation": {"error": {"title": "Deployment Failed", "summary": "Container OOMKilled", "details": "Error: OOMKilled\nMemory: 2.1GB / 2GB\nPod: web-api-7b8c9d-xk4m2"}, "params": {"memory": "2GB", "replicas": "3"}},
}

PROMPTS = {
    "selection": "Select which jobs to apply for",
    "approval": "Approve production deployment v2.4.0",
    "input": "Provide application details",
    "confirmation": "Confirm sending 2 emails",
    "escalation": "Deployment failed — decide how to proceed",
}

TEMPLATE_MAP = {
    "selection": "selection.html",
    "approval": "approval.html",
    "input": "input.html",
    "confirmation": "confirmation.html",
    "escalation": "escalation.html",
}


# ============================================================
# Routes
# ============================================================

@app.post("/api/demo")
async def create_demo(type: str = Query(default="selection")):
    if type not in SAMPLE_CONTEXTS:
        raise HTTPException(400, detail={"error": "invalid_type", "message": f"Use: {', '.join(SAMPLE_CONTEXTS)}"})

    case_id = "review_" + secrets.token_hex(8)
    token = generate_token()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=24)

    rc = {
        "case_id": case_id, "type": type, "status": "pending", "prompt": PROMPTS[type],
        "token_hash": hash_token(token), "context": SAMPLE_CONTEXTS[type],
        "created_at": now.isoformat(), "expires_at": expires.isoformat(),
        "default_action": "skip", "version": 1, "etag": '"v1-pending"',
        "result": None, "responded_by": None,
    }
    store[case_id] = rc

    # Auto-expire after 24h (matching Express/Hono behavior)
    asyncio.create_task(schedule_expiration(case_id, 86400))

    return JSONResponse(
        status_code=202,
        headers={"Retry-After": "30"},
        content={
            "status": "human_input_required",
            "message": rc["prompt"],
            "hitl": {
                "spec_version": "0.5", "case_id": case_id,
                "review_url": f"{BASE_URL}/review/{case_id}?token={token}",
                "poll_url": f"{BASE_URL}/api/reviews/{case_id}/status",
                "type": type, "prompt": rc["prompt"], "timeout": "24h",
                "default_action": "skip", "created_at": rc["created_at"], "expires_at": rc["expires_at"],
                "context": rc["context"],
            },
        },
    )


@app.get("/review/{case_id}", response_class=HTMLResponse)
async def review_page(case_id: str, token: str = Query()):
    rc = store.get(case_id)
    if not rc:
        raise HTTPException(404, detail={"error": "not_found"})
    if not verify_token(token, rc["token_hash"]):
        raise HTTPException(401, detail={"error": "invalid_token"})

    if rc["status"] == "pending":
        try:
            transition(rc, "opened")
        except ValueError:
            pass

    template_path = TEMPLATES_DIR / TEMPLATE_MAP[rc["type"]]
    if not template_path.exists():
        raise HTTPException(500, detail={"error": "template_error", "message": "Template not found."})

    html = template_path.read_text()
    hitl_data = {
        "case_id": rc["case_id"], "prompt": rc["prompt"], "type": rc["type"],
        "status": rc["status"], "token": token,
        "respond_url": f"{BASE_URL}/reviews/{rc['case_id']}/respond",
        "expires_at": rc["expires_at"], "context": rc["context"],
    }
    safe_prompt = html_module.escape(rc["prompt"])
    html = html.replace("{{prompt}}", safe_prompt).replace("{{hitl_data_json}}", json.dumps(hitl_data))
    return HTMLResponse(html)


@app.post("/reviews/{case_id}/respond")
async def submit_response(case_id: str, request: Request, token: str = Query()):
    rc = store.get(case_id)
    if not rc:
        raise HTTPException(404, detail={"error": "not_found"})
    if not verify_token(token, rc["token_hash"]):
        raise HTTPException(401, detail={"error": "invalid_token"})
    if rc["status"] == "expired":
        raise HTTPException(410, detail={"error": "case_expired", "message": f"Expired on {rc['expires_at']}."})
    if rc["status"] == "completed":
        raise HTTPException(409, detail={"error": "duplicate_submission", "message": "Already responded."})

    body = await request.json()
    action = body.get("action")
    if not action:
        raise HTTPException(400, detail={"error": "missing_action"})

    rc["result"] = {"action": action, "data": body.get("data", {})}
    rc["responded_by"] = {"name": "Demo User", "email": "demo@example.com"}
    transition(rc, "completed")
    return {"status": "completed", "case_id": rc["case_id"], "completed_at": rc["completed_at"]}


@app.get("/api/reviews/{case_id}/status")
async def poll_status(case_id: str, request: Request, response: Response):
    rc = store.get(case_id)
    if not rc:
        raise HTTPException(404, detail={"error": "not_found"})

    rl = check_rate_limit(rc["case_id"])
    response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT)
    response.headers["X-RateLimit-Remaining"] = str(rl["remaining"])
    if not rl["allowed"]:
        return JSONResponse(
            status_code=429, headers={"Retry-After": "30"},
            content={"error": "rate_limited", "message": "Wait 30 seconds."},
        )

    inm = request.headers.get("If-None-Match")
    if inm and inm == rc["etag"]:
        return Response(status_code=304, headers={"ETag": rc["etag"]})

    resp: dict[str, Any] = {"status": rc["status"], "case_id": rc["case_id"], "created_at": rc["created_at"], "expires_at": rc["expires_at"]}
    for key in ("opened_at", "completed_at", "expired_at", "cancelled_at"):
        if rc.get(key):
            resp[key] = rc[key]
    if rc["result"]:
        resp["result"] = rc["result"]
    if rc["responded_by"]:
        resp["responded_by"] = rc["responded_by"]
    if rc["status"] == "expired":
        resp["default_action"] = rc["default_action"]

    response.headers["ETag"] = rc["etag"]
    response.headers["Retry-After"] = "30"
    return resp


@app.get("/api/reviews/{case_id}/events")
async def event_stream(case_id: str):
    rc = store.get(case_id)
    if not rc:
        raise HTTPException(404, detail={"error": "not_found"})

    queue: asyncio.Queue = asyncio.Queue()
    if case_id not in sse_queues:
        sse_queues[case_id] = []
    sse_queues[case_id].append(queue)

    async def generate():
        try:
            initial = json.dumps({"case_id": rc["case_id"], "status": rc["status"]})
            yield f"event: review.{rc['status']}\ndata: {initial}\nid: evt_init\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            sse_queues.get(case_id, []).remove(queue) if queue in sse_queues.get(case_id, []) else None
            if not sse_queues.get(case_id):
                sse_queues.pop(case_id, None)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/.well-known/hitl.json")
async def discovery():
    return JSONResponse(
        content={"hitl_protocol": {
            "spec_version": "0.5",
            "service": {"name": "HITL Reference Service (FastAPI)", "url": BASE_URL},
            "capabilities": {"review_types": ["approval", "selection", "input", "confirmation", "escalation"], "transports": ["polling", "sse"], "default_timeout": "PT24H", "supports_reminders": False, "supports_multi_round": False, "supports_signatures": False},
            "endpoints": {"reviews_base": f"{BASE_URL}/api/reviews", "review_page_base": f"{BASE_URL}/review"},
            "rate_limits": {"poll_recommended_interval_seconds": 30, "max_requests_per_minute": 60},
        }},
        headers={"Cache-Control": "public, max-age=86400"},
    )
