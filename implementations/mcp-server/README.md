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
pnpm --filter @hitl-protocol/schemas build
pnpm --filter @hitl-protocol/core build

# Register with Claude Code:
claude mcp add hitl-demo -- node /absolute/path/to/implementations/mcp-server/server.js
```

Then ask your agent:

> Send my 3 application emails using the hitl-demo tool.

You'll get a consent prompt showing the review URL, the browser opens the service-hosted confirmation page, and the moment you click **Confirm** the tool call resolves with the structured result — no polling, no token in the chat.

## Notes

- The review token is generated, SHA-256-hashed, and verified with the [`@hitl-protocol/core`](../../packages/core) helpers, exactly like the [reference services](../reference-service/).
- The `elicitationId` is correlated with the HITL `case_id`; the completion notification replaces agent-side polling, while `poll_url` remains available as the universal fallback.
- Everything is in-memory and bound to `127.0.0.1` — this is a teaching demo, not a production service. It records confirmation and never sends emails. Polling is unauthenticated, and review tokens do not authenticate the reviewer. For production guidance see the [spec](../../spec/v0.8/hitl-protocol.md) and [service integration guide](../../skills/references/service-integration.md).

## MCP revision compatibility

This demo explicitly implements **Binding A (MCP 2025-11-25)**. Protocol revision support is negotiated with the MCP client; this example does not claim support for every newer revision. Other bindings are documented separately in the [binding guide](../../docs/mcp-elicitation-binding.md). The form-mode/no-elicitation fallback returns the HITL URL and `poll_review` tool result.
