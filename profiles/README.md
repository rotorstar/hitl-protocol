# HITL Protocol Profiles

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
| [`surface-interop/v0.1`](surface-interop/v0.1/README.md) | Draft | Declarative embedded review surfaces with required URL fallback |
