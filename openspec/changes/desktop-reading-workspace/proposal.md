## Why

The CodeCourse desktop reading workspace has four gaps that prevent it from being a fully stable desktop reader:

1. **No font zoom** — Ctrl+scroll doesn't resize text in either code viewer or Markdown docs
2. **Code blocks are monochrome** — Markdown fenced code blocks lack syntax highlighting (no highlight.js, no token-level styles)
3. **White flash on dark mode startup** — No `color-scheme` meta, no inline theme script in `<head>`, global base styles default to light colors before Apple token overrides apply
4. **Scrollbar hidden behind overlay panels** — GenerationSheet and other large sheets are `position: fixed` overlays that cover the workspace scrollbar instead of docking alongside it

The codebase already separates desktop from Android (MonacoCodeViewer vs MobileCodeViewer, `html:not(.platform-android)` CSS scoping, `isAndroidRuntime()` checks), so all four changes can stay desktop-scoped.

## What Changes

**1. Ctrl+Scroll font zoom (desktop reading workspace)**
- Enable `mouseWheelZoom: true` in MonacoCodeViewer options
- Add `wheel` event listener in MarkdownViewer that scales `--reader-font-size` when `ctrlKey` is true
- Persist desktop font size preference in localStorage (`codecourse.desktop.codeFontSize`, `codecourse.desktop.docFontSize`)
- Introduce CSS variables `--reader-font-size`, `--reader-code-font-size`, `--reader-line-height` scoped to `html:not(.platform-android)` so `.markdown-body` and its children scale from them

**2. Markdown code block syntax highlighting**
- Add `highlight.js` dependency and its ESM theme CSS
- Custom `code` / `pre` components in react-markdown's `components` that call `hljs.highlightElement()` or highlight the code string
- Add token-level color rules (`.hljs-keyword`, `.hljs-string`, `.hljs-comment`, `.hljs-title`, etc.) in a new desktop-scoped CSS file
- Ensure the custom code renderer does NOT route through `highlightChildren` (text highlight / knowledge-point linking), avoiding token-span pollution

**3. Dark mode startup without white flash**
- Add `<meta name="color-scheme" content="light dark">` in `index.html`
- Add inline blocking `<script>` before any stylesheet in `index.html` that reads localStorage + `prefers-color-scheme` and sets `data-theme` + `backgroundColor` on `<html>` synchronously
- Disable `background-color` / `color` transitions on `html`, `body`, `#root` during initial paint; re-enable after React mounts
- Move hardcoded light base colors in `styles.css` into CSS-variable-driven fallbacks so desktop dark tokens are the single source of truth from first frame

**4. Desktop sheets as docked layout columns**
- Change `.apple-sheet-layer` large sheets (GenerationSheet) from `position: fixed` overlay to an in-flow right column in `.reader-workspace`
- Add `has-sheet` state class to `.center-pane` / `.reader-workspace`, switching layout to `grid-template-columns: minmax(0, 1fr) var(--sheet-width)`
- The reading scrollbar naturally stays at the right edge of the reading column and moves inward when the sheet opens
- Add `scrollbar-gutter: stable` on scroll containers to prevent layout shift when scrollbars appear/disappear

## Capabilities

### New Capabilities
- `desktop-font-zoom`: Ctrl+scroll font scaling across code viewer and Markdown viewer, persisted per desktop
- `markdown-code-highlighting`: Syntax-highlighted code blocks in Markdown via highlight.js token spans + themed CSS
- `dark-mode-no-flash`: First-paint-is-dark via color-scheme meta + inline theme script + transition suppression
- `desktop-sheet-docked-layout`: Large panels render as docked right columns that shrink the workspace instead of overlaying it

### Modified Capabilities
<!-- No existing spec files to modify -->

## Impact

- `frontend/src/components/reader/MonacoCodeViewer.tsx` — enable mouseWheelZoom, optionally wire to persisted font size
- `frontend/src/components/reader/MarkdownViewer.tsx` — wheel listener, custom code/pre components, highlight.js integration
- `frontend/index.html` — color-scheme meta, inline theme script
- `frontend/src/main.tsx` — suppress transitions on initial mount, re-enable after hydration
- `frontend/src/styles/styles.css` — refactor base light colors to CSS-variable-driven fallbacks
- `frontend/src/styles/apple-content.css` — reader font-size variables, scrollbar-gutter, docked layout grid
- `frontend/src/styles/apple-overlays.css` — change `.apple-sheet-layer` from fixed overlay to docked column
- `frontend/src/styles/apple-tokens.css` — disable transitions during startup
- `frontend/src/styles/apple-code-highlight.css` **(new)** — highlight.js token color rules in Apple dark/light themes
- `frontend/package.json` — add `highlight.js` dependency

**Not touched:** `MobileCodeViewer.tsx`, `android-experience.css`, `runtime.ts`.
