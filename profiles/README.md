# HITL Protocol Profiles

[Agent Access v0.1](agent-access/v0.1/README.md) is an optional draft for public web attribution and delegated APIs. It binds the authenticated initiator and local grant to an immutable operation, its owner review and explicit execution. [OpenAPI 3.2.1](agent-access/v0.1/openapi.json) and the [persistent reference implementation](../implementations/agent-access/README.md) specify the available bindings.

Profiles define optional interoperability layers that sit above the HITL core.

The HITL core remains the same:

- `HTTP 202 + hitl object`
- required `review_url` fallback
- required `poll_url`
- service-hosted review UI

Profiles MAY add additional capabilities for clients that support them, but they MUST NOT replace the core browser-based flow.

## Available Profiles

| Profile | Status | Purpose |
|--------|--------|---------|
| [`agent-access/v0.1`](agent-access/v0.1/README.md) | Draft | Public attribution, delegated enrollment, owner review and explicit local execution |
| [`surface-interop/v0.1`](surface-interop/v0.1/README.md) | Draft | Declarative embedded review surfaces with required URL fallback |
