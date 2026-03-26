# HITL Surface Interop Profile v0.1

An optional interoperability profile for services that want to publish declarative review surfaces alongside the HITL core flow.

## Purpose

This profile is for clients that can render review UI inline from declarative payloads such as `json-render` or A2UI.

It does **not** change the HITL core:

- `review_url` remains required
- `poll_url` remains required
- the browser review page remains the canonical fallback

## Non-goals

- Replacing the HITL core with an embedded-only flow
- Standardizing renderer-specific payload semantics inside the core `hitl` object
- Forcing a single UI framework on services or agents

## Discovery

Services SHOULD advertise support via `/.well-known/hitl.json`:

```json
{
  "hitl_protocol": {
    "spec_version": "0.7",
    "capabilities": {
      "supports_surface": true,
      "surface_formats": ["json-render", "a2ui"],
      "surface_profiles": ["hitl-surface-interop/v0.1"]
    }
  }
}
```

## Wrapper Object

The profile standardizes a portable wrapper object. The transport carrying this object is intentionally profile-defined and may be:

- an adjacent HTTP response field
- a follow-up endpoint bound to `case_id`
- A2A or AG-UI metadata
- any other correlated transport

```json
{
  "profile": "hitl-surface-interop/v0.1",
  "case_id": "review_abc123",
  "surfaces": [
    {
      "id": "primary-review",
      "format": "json-render",
      "version": "0.12",
      "fallback_review_url": "https://service.example.com/review/abc123?token=...",
      "catalog_id": "https://service.example.com/catalogs/review-surfaces/v1",
      "payload": {}
    }
  ]
}
```

## Required Rules

- Every surface MUST include `fallback_review_url`.
- `fallback_review_url` MUST be the same review experience the service already exposes via HITL core.
- Unknown `format` values MUST be ignored by clients.
- Invalid payloads MUST fall back to the browser review page.
- The `payload` field is opaque to HITL core and interpreted only by clients that understand the selected format.

## Supported Formats

### `json-render`

Use when the client can render a catalog-constrained, flat-tree JSON UI with state binding and action handlers.

```json
{
  "id": "primary-review",
  "format": "json-render",
  "version": "0.12",
  "fallback_review_url": "https://service.example.com/review/abc123?token=...",
  "payload": {
    "root": "review-card",
    "elements": {
      "review-card": {
        "type": "Card",
        "props": { "title": "Approve deployment?" },
        "children": ["approve-button"]
      },
      "approve-button": {
        "type": "Button",
        "props": { "label": "Approve" },
        "children": []
      }
    }
  }
}
```

### `a2ui`

Use when the client understands A2UI surfaces and data models.

```json
{
  "id": "primary-review",
  "format": "a2ui",
  "version": "v0.10",
  "fallback_review_url": "https://service.example.com/review/abc123?token=...",
  "catalog_id": "https://a2ui.org/specification/v0_10/basic_catalog.json",
  "payload": {
    "version": "v0.10",
    "createSurface": {
      "surfaceId": "primary-review",
      "catalogId": "https://a2ui.org/specification/v0_10/basic_catalog.json"
    }
  }
}
```

## Security and UX Rules

- Embedded rendering is optional convenience, not an authorization boundary.
- Services SHOULD prefer the browser fallback for high-stakes actions.
- Clients SHOULD preserve a visible path to `fallback_review_url`.
- Mobile-first, keyboard support, screen-reader labels, and explicit expired/completed states remain required whether the UI is embedded or browser-hosted.

## Reference Schema

See [`surface-interop-profile.schema.json`](surface-interop-profile.schema.json).
