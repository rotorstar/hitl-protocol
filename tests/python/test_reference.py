"""Exercise actual FastAPI requests and storage, not a copied implementation."""
import asyncio
import json
from urllib.parse import urlsplit

import httpx
from jsonschema import Draft202012Validator

from test_schema import make_registry


def test_inline_and_browser_contract(reference_server, poll_schema, form_field_schema, verification_policy_schema, verification_result_schema, submission_context_schema):
    registry = make_registry(form_field_schema, verification_policy_schema, verification_result_schema, submission_context_schema)
    validator = Draft202012Validator(poll_schema, registry=registry)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=reference_server.app), base_url="http://localhost") as client:
            hitl = (await client.post("/api/demo?type=confirmation")).json()["hitl"]
            assert hitl["spec_version"] == "0.8"
            target = urlsplit(hitl["submit_url"]).path
            headers = {"authorization": "Bearer " + hitl["submit_token"]}
            body = {"action": "confirm", "submitted_via": "x-cli", "submitted_by": {"platform": "x-cli", "platform_user_id": "claimed"}}
            assert (await client.post(target, headers=headers, json=body)).status_code == 200
            poll = (await client.get(urlsplit(hitl["poll_url"]).path)).json()
            assert validator.is_valid(poll), list(validator.iter_errors(poll))
            assert "responded_by" not in poll
            assert poll["submission_context"]["submitted_by"]["platform_user_id"] == "claimed"
            assert (await client.post(target, headers=headers, json={**body, "action": "cancel"})).status_code == 409
            assert (await client.get(urlsplit(hitl["poll_url"]).path)).json() == poll
            browser = (await client.post("/api/demo?type=confirmation")).json()["hitl"]
            token = urlsplit(browser["review_url"]).query
            target = f'/reviews/{browser["case_id"]}/respond?{token}'
            assert (await client.post(target, json={"action": "confirm", "submitted_by": {"name": "forged"}})).status_code == 400
            assert (await client.post(target, json={"action": "confirm", "data": {}})).status_code == 200

    asyncio.run(scenario())
    reference_server.store.clear()


def test_expiry_invalid_body_and_escaping(reference_server):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=reference_server.app), base_url="http://localhost") as client:
            hitl = (await client.post("/api/demo?type=confirmation")).json()["hitl"]
            token = urlsplit(hitl["review_url"]).query
            target = f'/reviews/{hitl["case_id"]}/respond?{token}'
            for body in [None, [], {"action": 3}, {"action": "unknown"}, {"action": "confirm", "data": "bad"}]:
                assert (await client.post(target, content=json.dumps(body), headers={"content-type": "application/json"})).status_code == 400
            assert (await client.post(target, content="{bad", headers={"content-type": "application/json"})).status_code == 400
            rc = reference_server.store[hitl["case_id"]]
            rc["prompt"] = "$& $` $' {{hitl_data_json}} {{prompt}} </script><script>alert(1)</script>"
            rc["context"] = {"description": "$& $` $' {{hitl_data_json}} </script><script>alert(2)</script>"}
            html = (await client.get(urlsplit(hitl["review_url"]).path + "?" + token)).text
            assert "</script><script>alert(1)</script>" not in html
            rendered_data = json.loads(html.split('id="hitl-data">', 1)[1].split('</script>', 1)[0])
            assert rendered_data["prompt"] == rc["prompt"]
            assert rendered_data["context"] == rc["context"]
            rc["expires_at"] = "2000-01-01T00:00:00Z"
            assert (await client.post(target, json={"action": "confirm"})).status_code == 410
            assert rc["result"] is None
            poll = (await client.get(urlsplit(hitl["poll_url"]).path)).json()
            assert poll["status"] == "expired"
            assert "expired_at" in poll and poll["default_action"] == "skip"

    asyncio.run(scenario())
    reference_server.store.clear()


def test_body_parsing_race_preserves_winner(reference_server):
    class DelayedRequest:
        headers = {}

        def __init__(self, body, event):
            self.body, self.event = body, event

        async def json(self):
            await self.event.wait()
            return self.body

    async def scenario():
        from fastapi import HTTPException
        created = await reference_server.create_demo("confirmation")
        hitl = json.loads(created.body)["hitl"]
        token = urlsplit(hitl["review_url"]).query.split("=", 1)[1]
        first, second = asyncio.Event(), asyncio.Event()
        tasks = [asyncio.create_task(reference_server.submit_response(hitl["case_id"], DelayedRequest({"action": "confirm"}, first), token)), asyncio.create_task(reference_server.submit_response(hitl["case_id"], DelayedRequest({"action": "cancel"}, second), token))]
        await asyncio.sleep(0)
        first.set(); await tasks[0]
        second.set()
        try:
            await tasks[1]
            assert False, "Duplicate response must fail"
        except HTTPException as error:
            assert error.status_code == 409
        assert reference_server.store[hitl["case_id"]]["result"]["action"] == "confirm"

    asyncio.run(scenario())
    reference_server.store.clear()


def test_actual_form_selection_and_token_contracts(reference_server):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=reference_server.app), base_url="http://localhost") as client:
            confirmation = (await client.post("/api/demo?type=confirmation")).json()["hitl"]
            target = urlsplit(confirmation["submit_url"]).path
            review_token = urlsplit(confirmation["review_url"]).query.split("=", 1)[1]
            assert (await client.post(target, json={"action": "confirm"})).status_code == 401
            assert (await client.post(target, headers={"authorization": "Bearer " + review_token}, json={"action": "confirm"})).status_code == 401
            assert (await client.get(urlsplit(confirmation["review_url"]).path + "?token=" + confirmation["submit_token"])).status_code == 401
            hitl = (await client.post("/api/demo?type=input")).json()["hitl"]
            target = f'/reviews/{hitl["case_id"]}/respond?{urlsplit(hitl["review_url"]).query}'
            valid = {"salary_expectation": 65000, "start_date": "2026-10-20", "work_auth": "citizen"}
            for data in [{**valid, "salary_expectation": "65000"}, {**valid, "start_date": "2026-02-30"}, {**valid, "work_auth": "unknown"}]:
                assert (await client.post(target, json={"action": "submit", "data": data})).status_code == 400
            assert (await client.post(target, json={"action": "submit", "data": valid})).status_code == 200
            assert reference_server.store[hitl["case_id"]]["result"]["data"] == valid
            selection = (await client.post("/api/demo?type=selection")).json()["hitl"]
            target = f'/reviews/{selection["case_id"]}/respond?{urlsplit(selection["review_url"]).query}'
            assert (await client.post(target, json={"action": "select", "data": {"selected": ["missing"]}})).status_code == 400
            assert (await client.post(target, json={"action": "select", "data": {"selected": ["job_001"]}})).status_code == 200

    asyncio.run(scenario())
    reference_server.store.clear()


def test_deadline_is_checked_after_body_parsing(reference_server):
    class DeadlineRequest:
        headers = {}

        def __init__(self, case):
            self.case = case

        async def json(self):
            self.case["expires_at"] = "2000-01-01T00:00:00Z"
            return {"action": "confirm"}

    async def scenario():
        from fastapi import HTTPException
        hitl = json.loads((await reference_server.create_demo("confirmation")).body)["hitl"]
        rc = reference_server.store[hitl["case_id"]]
        token = urlsplit(hitl["review_url"]).query.split("=", 1)[1]
        try:
            await reference_server.submit_response(hitl["case_id"], DeadlineRequest(rc), token)
            assert False, "Expired response must fail"
        except HTTPException as error:
            assert error.status_code == 410
        assert rc["status"] == "expired" and rc["result"] is None

    asyncio.run(scenario())
    reference_server.store.clear()
