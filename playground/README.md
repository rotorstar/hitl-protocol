# HITL Protocol Interactive Playground

An illustrative HITL v0.9 Draft HTML playground using fictional data and simulated outcomes to explore the HITL Protocol — review types, transport options, status lifecycle, and complete end-to-end flows.

## Usage

Open `index.html` directly in any browser:

```bash
# macOS
open playground/index.html

# Linux
xdg-open playground/index.html

# Or serve locally
npx serve .
```

This playground does not call the reference runtime or verify users, signatures or real side effects. A service signature demonstrates integrity and issuer authenticity; it is not proof of a human decision.

## Features

The playground includes interactive tabs for:

1. **Protocol Overview** — Core concept, case lifecycle state machine, HITL object anatomy, transport options, and all 5 review types
2. **Job Search** — Selection + Confirmation flow with configurable delivery mode (Telegram/Desktop/QR), transport (Poll/SSE/Callback), and scenarios (happy path, timeout, cancel)
3. **Deployment** — Approval flow with signed responses, audit trail, and timeout scenarios
4. **Content Review** — Multi-round edit cycle with 1-3 review rounds and case chain visualization
5. **Agent Deal (ADL)** — Integration with Agent Deal Language negotiation protocol
6. **Input Form** — Configurable fields, validation, conditional visibility, sensitive values, multi-step forms and progress
7. **Inline** — Telegram/Slack/Discord buttons, explicit confirm/cancel decisions, browser fallback and optional verification step-up
8. **Compare** — Feature comparison heatmap across HITL, AG-UI, A2UI, Adaptive Cards, MCP Elicitation

## Screenshots

The existing orange visual identity, eight tabs and sidebar controls are retained. v0.9 adds a concise ownership/authentication/immutability explanation, accurate full wire examples, accessible tabs, shareable control state, clipboard fallback and reduced motion.

See [before/after screenshots and acceptance criteria](../docs/playground-review/README.md). Run `pnpm test:playground` for schema and browser checks, or `pnpm capture:playground` to refresh screenshots. Inter and JetBrains Mono are bundled locally and shared with the animation. Serve the repository root and open `/playground/index.html` so the shared assets are available. No build step is required.

## Contributing

Improvements to the playground are welcome. The playground is one HTML file with inline CSS and JavaScript, plus shared local font assets — no build step required.
