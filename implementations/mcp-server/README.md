# HITL via MCP URL Mode Elicitation — Demo

A runnable demonstration of the [MCP Elicitation Binding](../../docs/mcp-elicitation-binding.md): a single Node.js process that runs a minimal HITL service (confirmation review page) and an MCP server (stdio) whose tool delivers the `review_url` through MCP URL mode elicitation.

```
MCP URL mode  = how the review URL reaches the human (inside the MCP session)
HITL Protocol = what happens at the URL, and how the structured result returns
```

## What it shows

| MCP client capability | Flow |
|---|---|
| URL mode elicitation (e.g. Claude Code ≥ 2.1.76) | `elicitation/create` (`mode: "url"`) → browser review page → `notifications/elicitation/complete` → tool resolves with the structured decision. No polling by the agent. |
| Form mode only / none | Tool returns the HTTP-202-style `hitl` object as text; the agent relays `review_url` and polls via the `poll_review` tool — the standard HITL flow. |

## Run it

```bash
pnpm install   # from the repository root

# Register with Claude Code:
claude mcp add hitl-demo -- node /absolute/path/to/implementations/mcp-server/server.js
```

Then ask your agent:

> Send my 3 application emails using the hitl-demo tool.

You'll get a consent prompt showing the review URL, the browser opens the service-hosted confirmation page, and the moment you click **Confirm** the tool call resolves with the structured result — no polling, no token in the chat.

## Notes

- The review token is generated, SHA-256-hashed, and verified with the [`@hitl-protocol/core`](../../packages/core) helpers, exactly like the [reference services](../reference-service/).
- The `elicitationId` is correlated with the HITL `case_id`; the completion notification replaces agent-side polling, while `poll_url` remains available as the universal fallback.
- Everything is in-memory and `localhost` — this is a teaching demo, not a production service. For production guidance see the [spec](../../spec/v0.8/hitl-protocol.md) and [service integration guide](../../skills/references/service-integration.md).

## MCP revision compatibility

This demo implements **Binding A (MCP 2025-11-25, current stable)** and works against clients on that revision. The **2026-07-28 revision** (release candidate; final targeted 2026-07-28) removes `elicitationId` and `notifications/elicitation/complete` — server-initiated elicitation is replaced by the MRTR pattern (`resultType: "input_required"` + `requestState` re-issue), and long-running approval gates move to the Tasks extension (`io.modelcontextprotocol/tasks`). See [Bindings B and C](../../docs/mcp-elicitation-binding.md#binding-b--mcp-2026-07-28-release-candidate-mrtr) for the mappings. A migration of this demo is planned once the final spec and SDK support land; the form-mode/no-elicitation fallback path (`poll_review`) is revision-independent and keeps working either way.
