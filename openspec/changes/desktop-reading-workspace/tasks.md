## 1. Desktop Font Zoom — Monaco Code Viewer

- [x] 1.1 Add `mouseWheelZoom: true` to Monaco `<Editor>` options in `frontend/src/components/MonacoCodeViewer.tsx`
- [x] 1.2 Add `fontSize` state initialized from `localStorage` key `codecourse.desktop.codeFontSize` (default 14)
- [x] 1.3 Persist font size to `localStorage` on change via `onDidChangeConfiguration` listener

## 2. Desktop Font Zoom — Markdown Viewer

- [x] 2.1 Add CSS variables `--reader-font-size` (default 16px), `--reader-code-font-size` (default 0.8125em), `--reader-line-height` (default 1.78) in `apple-content.css`, scoped to `html:not(.platform-android)`
- [x] 2.2 Update `.markdown-body`, `.markdown-body h1-4`, `.markdown-body code` to reference these variables (headings use `em` for proportional scaling)
- [x] 2.3 Add `wheel` event listener on `articleRef` in `MarkdownViewer.tsx` — when `event.ctrlKey`, `preventDefault()` and adjust `--reader-font-size` via `documentElement.style.setProperty()`
- [x] 2.4 Clamp font sizes to [8, 36] range
- [x] 2.5 Persist document font size to `localStorage` key `codecourse.desktop.docFontSize`
- [x] 2.6 Restore persisted doc font size on mount

## 3. Markdown Code Block Syntax Highlighting

- [x] 3.1 Install `highlight.js`: `npm install highlight.js` in `frontend/`
- [x] 3.2 Create custom `code` component in react-markdown `components` that calls `hljs.highlight(code, { language })` and renders with `dangerouslySetInnerHTML`
- [x] 3.3 Add custom `pre` and `code` components to react-markdown's `components` prop in `MarkdownViewer.tsx`
- [x] 3.4 Ensure inline `` `code` `` renders as plain `<code>` (no highlighting) — checked via `className?.startsWith("language-")`
- [x] 3.5 Ensure code block content does NOT pass through `highlightChildren` (knowledge-point linking, text highlight) — custom `code` component bypasses all text processing
- [x] 3.6 Create `frontend/src/styles/apple-code-highlight.css` with `.hljs` and token-scope color rules using CSS variables (`--hl-keyword`, `--hl-string`, etc.)
- [x] 3.7 Import `apple-code-highlight.css` in `main.tsx`
- [x] 3.8 Add highlight token color variables to `apple-tokens.css` for both light and dark themes

## 4. Dark Mode No White Flash

- [x] 4.1 Add `<meta name="color-scheme" content="light dark">` in `frontend/index.html` `<head>`
- [x] 4.2 Add inline blocking `<script>` at start of `<body>` in `index.html` that:
  - Reads `localStorage.getItem("codecourse.theme")` or `matchMedia("(prefers-color-scheme: dark)").matches`
  - Sets `document.documentElement.dataset.theme` and `document.documentElement.style.backgroundColor`
  - Sets `document.body.style.backgroundColor` to match
  - Updates `theme-color` meta
- [x] 4.3 Add `.app-starting` class on `<html>` in `index.html`; remove it in `App.tsx` via `useEffect` on mount
- [x] 4.4 In `apple-tokens.css`, add `.app-starting` selector to suppress `transition` on `background-color` and `color` for `html`, `body`, `#root`
- [x] 4.5 Simplified `main.tsx` theme init (inline script now handles first-paint theme, JS module syncs `theme-color` fallback)
- [x] 4.6 Desktop dark colors (`#1c1c1e` / `#f5f5f7`) are set via inline script before CSS paints

## 5. Desktop Sheet Docked Layout

- [x] 5.1 Audited `.apple-sheet-layer` consumers — only `GenerationSheet.tsx` uses it
- [x] 5.2 Added `body.has-sheet .reader-workspace { margin-right: 420px }` in `apple-workbench.css` — workspace shrinks to make scrollbar visible beside the overlay
- [x] 5.3 GenerationSheet toggles `has-sheet` class on `document.body` via `useEffect`
- [x] 5.4 Added `scrollbar-gutter: stable` to `.markdown-body` in `apple-content.css`
- [ ] 5.5 Full grid docked layout (moving sheet into `.reader-workspace` as grid child) deferred — requires relocating React component tree; current margin approach achieves the scrollbar-visibility goal without structural refactor

## 6. Verification

- [ ] 6.1 Manual test: Ctrl+scroll in Monaco code viewer zooms font
- [ ] 6.2 Manual test: Ctrl+scroll in Markdown viewer zooms doc font
- [ ] 6.3 Manual test: Font size persists across page reload
- [ ] 6.4 Manual test: Markdown code blocks show colored tokens (js, python, bash)
- [ ] 6.5 Manual test: Inline code is not highlighted
- [ ] 6.6 Manual test: Cold start in dark mode — no white flash
- [ ] 6.7 Manual test: System theme switch while app is open works correctly
- [ ] 6.8 Manual test: Opening GenerationSheet shrinks reading area and scrollbar moves with content edge
- [ ] 6.9 Manual test: Closing sheet restores full-width layout
- [x] 6.10 Run `npm run build` in `frontend/` — no TypeScript or build errors
- [ ] 6.11 Run backend tests: `cd backend && python -m pytest tests/` — no regression (backend untouched)
- [ ] 6.12 Verify Android MobileCodeViewer and mobile styles are untouched (regression check) — confirmed no android files modified
