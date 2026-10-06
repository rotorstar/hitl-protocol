# README refresh — 2026-10-06

The README must describe the current v0.9 contract and show readable crops from the current animation and playground, with their shared orange/slate palette and local Inter / JetBrains Mono fonts.

## Plan and acceptance criteria

| Task | Acceptance criteria |
|---|---|
| Audit every displayed image | Inventory the root README and its linked screenshot comparisons. Current screenshots derive from the current HTML; original / rejected / v0.8 comparison screenshots remain explicitly historical. No current preview refers to a legacy GIF or PNG. |
| Capture useful previews | Capture the animation explorer at job-search/browser step 6 in light and dark mode, including tabs, playback, messenger and human choices. Capture the playground overview with all eight tabs, v0.9 ownership/decision/execution cards and the complete lifecycle. Exclude surrounding page chrome and unrelated lower content; retain readable labels and complete cards. |
| Keep captures reproducible | Existing capture commands generate both complete comparison images and cropped README previews directly from the rendered DOM after local fonts load. No manually edited image is a source of truth. |
| Align README content | Quick Start uses a schema-valid v0.9 HITL object. Current feature/spec links point to v0.9. Repository structure includes the current specification, optional Agent Access, packages and both HTML pages. Historical implementations and guides remain correctly labelled v0.8. Decision completion, reviewer identity and execution stay distinct. |
| Verify the result | Visually inspect new light/dark and playground crops; verify local links, images and current specification anchors; validate README wire JSON against the canonical schema; run the existing capture/browser checks for both pages. Check temporal claims against primary sources when needed. |

## Capture sources

- Animation: `assets/hitl-protocol-flow.html#story=jobs&flow=browser&step=6`, the `#explorer` element.
- Playground: `playground/index.html#tab=protocol`, from its eight-tab navigation through the complete Case Lifecycle card.
- Full-page screenshots remain in the linked [animation comparison](animation-review/README.md) and [playground comparison](playground-review/README.md).

Capture APIs follow the current [Playwright screenshot documentation](https://playwright.dev/docs/screenshots). Playwright 1.63.0 was confirmed as the current stable release; no dependency change is required. Image paths follow [GitHub's relative-link guidance](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax).

## Image inventory and result

| README surface | Current image source | Result |
|---|---|---|
| Root animation preview | `assets/hitl-flow-v0.9-preview.png` / `-preview-dark.png` | Fresh DOM crops of the same job-selection step; theme-aware picture and link to that exact step. |
| Root playground preview | `assets/hitl-playground-v0.9-preview.png` | Fresh overview crop with all eight tabs, v0.9 cards and the complete lifecycle. |
| Animation comparison | `assets/hitl-flow-v0.9.png`, `-dark.png`; `messenger.png`, `research.png`, `purchase.png` | Recaptured from current HTML; the complete images already matched the current font/palette commit. |
| Playground comparison | `after.png`, `after-inline.png`, `assets/hitl-playground-v0.9.png` | Recaptured from current HTML; complete images already matched the current commit. |
| Historical comparisons | Animation `original.png` / `first-pass.png`; playground `before.png` / `before-inline.png` | Preserved and explicitly historical. |
| Logo and badges | Existing logo and v0.9 draft badge | Current; no screenshot substitution needed. |

No README currently references the old unversioned animation PNGs/GIFs or playground PNG. The original assets remain available as historical material.

The README Quick Start JSON validates against the canonical v0.9 HITL schema. Current feature, security and form links point to v0.9; the repository tree, version-handling explanation, optional inline/verification guidance and font licences are current. Historical demos, templates, example JSON and their Quick Start remain labelled with their actual v0.8 contract. The unsupported install counter and unsourced anecdote were removed. The outdated AI Act date was corrected against the European Commission's [current timeline](https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force) and [Article 14 text](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14).

Both capture commands pass in Chromium: animation **29 outcomes / 85 schema-valid messages**; playground **226 configurations / 552 schema-valid messages**. The light/dark animation and playground crops were visually inspected. Local image/link targets and current Markdown heading anchors were checked; no missing target remains. The HTML interaction logic is unchanged.
