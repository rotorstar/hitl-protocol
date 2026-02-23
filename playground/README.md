# HITL Protocol Interactive Playground

An interactive HTML playground for exploring the HITL Protocol — review types, transport options, status lifecycle, and complete end-to-end flows.

## Usage

Open `index.html` directly in any browser:

```bash
# macOS
open playground/index.html

# Linux
xdg-open playground/index.html

# Or serve locally
npx serve playground/
```

## Features

The playground includes interactive tabs for:

1. **Protocol Overview** — Core concept, case lifecycle state machine, HITL object anatomy, transport options, and all 5 review types
2. **Job Search** — Selection + Confirmation flow with configurable delivery mode (Telegram/Desktop/QR), transport (Poll/SSE/Callback), and scenarios (happy path, timeout, cancel)
3. **Deployment** — Approval flow with signed responses, audit trail, and timeout scenarios
4. **Content Review** — Multi-round edit cycle with 1-3 review rounds and case chain visualization
5. **Agent Deal (ADL)** — Integration with Agent Deal Language negotiation protocol
6. **Compare** — Feature comparison heatmap across HITL, AG-UI, A2UI, Adaptive Cards, MCP Elicitation

## Screenshots

The playground is fully responsive and works on both desktop and mobile browsers.

## Contributing

Improvements to the playground are welcome. The playground is a single self-contained HTML file with inline CSS and JavaScript — no build step required.
