## Context

CodeCourse desktop uses MonacoCodeViewer for code reading and MarkdownViewer for doc reading. The codebase already separates desktop from Android via `isAndroidRuntime()`, `applyPlatformClass()`, and `html:not(.platform-android)` CSS scoping. Apple design tokens drive the desktop theme via CSS custom properties in `apple-tokens.css`, with component styles in `apple-content.css`, `apple-workbench.css`, and `apple-overlays.css`.

The four improvements are desktop-only. No Android code paths are affected.

## Goals / Non-Goals

**Goals:**
- Ctrl+scroll font zoom in both code viewer and Markdown viewer
- Syntax-highlighted code blocks in Markdown with token-level CSS
- First-paint-is-dark on desktop, no white flash
- Large panels (GenerationSheet) dock as workspace columns that shrink the reading area

**Non-Goals:**
- Font zoom on Android (MobileCodeViewer)
- Syntax highlighting on Android
- Dark mode flash fix on mobile (different rendering path)
- Replacing existing small overlays (tooltips, context menus) — only large sheets are affected
- Changing the backend

## Decisions

### Decision 1: Monaco mouseWheelZoom + shared persisted state

Use Monaco's built-in `mouseWheelZoom: true` for the code viewer. Persist the font size in `localStorage` keyed as `codecourse.desktop.codeFontSize`. This keeps the code viewer change minimal.

**Why not a unified zoom state across code + docs:** Code is monospace (px), docs are proportional (rem/px). A single numeric scale factor would produce mismatched visual sizes. Two persisted keys (`codeFontSize`, `docFontSize`) with independent defaults is more correct.

### Decision 2: highlight.js ESM + custom react-markdown components

Add `highlight.js` as an npm dependency. In MarkdownViewer, add custom `code` and `pre` components to react-markdown's `components` prop. The `pre` component calls `hljs.highlight(code, { language })` on the code string and renders the resulting HTML with `dangerouslySetInnerHTML`.

**Why not rehype-highlight:** Adding a rehype plugin requires a full unified pipeline setup (rehype-highlight + rehype-stringify + rehype-raw), which is heavier and harder to control per-element. Custom components are the idiomatic react-markdown approach.

**Why not react-syntax-highlighter:** It bundles its own theme system that doesn't integrate with our Apple token CSS variables. highlight.js produces plain `.hljs-*` class spans that we style with our own CSS.

### Decision 3: Inline script + color-scheme meta + CSS transition suppression

Three-pronged approach for no-flash dark mode:

1. **`<meta name="color-scheme">`** — tells the browser which schemes the page supports, before CSS loads
2. **Inline blocking `<script>` in `<head>`** — sets `data-theme` and `documentElement.style.backgroundColor` synchronously, before any paint
3. **Transition suppression** — add a `.app-starting` class on `<html>` during load; Apple token CSS disables transitions when this class is present. Remove it in `main.tsx` after React mounts.

**Why not just a CSS-only fix:** The base styles in `styles.css` hardcodes light colors (`#eef1f4`, white, `#fbfcfd`). CSS alone can't read localStorage to know the user's theme preference before paint.

### Decision 4: CSS grid docked column for large sheets

Change `.apple-sheet-layer` on desktop from `position: fixed; z-index: 70` to a CSS grid approach:

```css
html:not(.platform-android) .reader-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 0;
  transition: grid-template-columns 0.2s ease;
}
html:not(.platform-android) .reader-workspace.has-sheet {
  grid-template-columns: minmax(0, 1fr) var(--sheet-width);
}
```

The sheet itself moves from a fixed overlay to a grid child. Only large workspace panels (GenerationSheet) adopt this; tooltips, context menus, and notifications stay as overlays.

**Why not just add right padding:** Padding only shifts the content, not the scrollbar. The scrollbar stays on the viewport edge and remains hidden.

**Why not keep fixed overlay + reserve width:** This is a valid middle ground, but the docked column approach correctly models the relationship: the sheet *is* part of the workspace layout, not an overlay on top of it.

## Risks / Trade-offs

- **highlight.js bundle size**: highlight.js is ~20KB gzipped for the core + common languages. Acceptable for a desktop Electron app.
- **Inline script maintainability**: The inline theme script must stay in sync with `main.tsx` theme logic. It's short (~15 lines) and changes rarely.
- **Sheet layout regression**: Changing GenerationSheet from fixed to docked could affect other sheets that share `.apple-sheet-layer`. Audit all sheet consumers before changing the selector.
- **Font zoom step granularity**: Monaco uses 1px steps by default; doc zoom uses `rem`-based scaling. The visual ratio between code and doc may drift after many zoom steps. Acceptable for an MVP — users adjust each independently.
