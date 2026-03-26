# HITL Flow Verification

This document contains the Mermaid flows used to verify that HITL core and optional surface profiles remain consistent.

## Verification Rules

- Every flow must preserve `review_url` as fallback.
- Every flow must map to real HITL lifecycle states.
- Embedded rendering must be optional and ignorable.
- Unsupported formats or invalid payloads must fall back to the browser review page.

## 1. Standard Browser Review

```mermaid
sequenceDiagram
    actor Human
    participant Agent
    participant Service
    participant ReviewPage

    Agent->>Service: API request
    Service-->>Agent: HTTP 202 + hitl
    Agent->>Human: review_url
    Human->>ReviewPage: Open review_url
    ReviewPage->>Service: GET review page
    Human->>ReviewPage: Submit decision
    Agent->>Service: Poll poll_url
    Service-->>Agent: completed result
```

Verified against:

- `review_url`
- `poll_url`
- `pending/opened/in_progress/completed`

## 2. Inline Submit with URL Fallback

```mermaid
sequenceDiagram
    actor Human
    participant Agent
    participant Service

    Agent->>Service: API request
    Service-->>Agent: HTTP 202 + hitl + submit_url
    Agent->>Human: Inline buttons + Details -> review_url
    alt Human taps inline button
        Agent->>Service: POST submit_url
        Service-->>Agent: completed
    else Human needs full context
        Human->>Service: Open review_url
        Agent->>Service: Poll poll_url
    end
```

Verified against:

- `submit_url`
- `inline_actions`
- `review_url` fallback
- `403` and browser fallback path

## 3. Embedded `json-render` with URL Fallback

```mermaid
flowchart LR
    A[Agent calls Service] --> B[HTTP 202 + hitl]
    B --> C{Client supports surface profile?}
    C -->|No| D[Send review_url to human]
    C -->|Yes| E[Resolve surface-interop profile]
    E --> F{json-render supported?}
    F -->|No| D
    F -->|Yes| G[Render inline json-render payload]
    G --> H{Inline rendering succeeds?}
    H -->|No| D
    H -->|Yes| I[Human decides inline]
    I --> J[Service returns result via HITL flow]
```

Verified against:

- `supports_surface`
- `surface_formats`
- browser fallback on unsupported or invalid payload

## 4. Embedded A2UI with URL Fallback

```mermaid
flowchart LR
    A[Agent calls Service] --> B[HTTP 202 + hitl]
    B --> C{Client supports A2UI profile?}
    C -->|No| D[Use review_url]
    C -->|Yes| E[Resolve surface-interop profile]
    E --> F{A2UI payload valid?}
    F -->|No| D
    F -->|Yes| G[Render A2UI surface inline]
    G --> H[User action or browser fallback]
    H --> I[Result still retrieved through HITL core]
```

Verified against:

- HITL transport remains source of truth
- embedded payload does not replace review page authorization

## 5. Discovery and Capability Negotiation

```mermaid
sequenceDiagram
    participant Client
    participant Service

    Client->>Service: GET /.well-known/hitl.json
    Service-->>Client: Discovery response
    Client->>Client: Cache transports, inline support, surface formats, surface profiles
    Client->>Service: Normal API request
    Service-->>Client: HTTP 202 + hitl
    Client->>Client: Choose inline render, browser flow, or fallback
```

Verified against:

- discovery schema
- OpenAPI discovery contract
- example `07-well-known-hitl.json`

## 6. Invalid Surface / Fallback

```mermaid
flowchart TD
    A[Declarative surface advertised] --> B{Supported format?}
    B -->|No| C[Ignore payload]
    B -->|Yes| D{Payload valid?}
    D -->|No| C
    D -->|Yes| E[Render inline]
    C --> F[Open or send review_url]
    E --> G[If rendering fails later, open review_url]
```

Verified against:

- unknown formats ignored
- malformed payloads fall back
- `review_url` always works
