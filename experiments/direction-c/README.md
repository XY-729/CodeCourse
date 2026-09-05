# CodeCourse — direction C / stage A

Independent desktop UI experiment, based on `main@dcd00f7`. All changes are confined to `experiments/direction-c` on `codex/ui-direction-c-experiment`.

## Run locally

From this directory, run `npm ci` and `npm run dev`. Open <http://127.0.0.1:5197/review.html> for the review gallery, or <http://127.0.0.1:5197/?scene=ask> for the interactive ASK scene.

Requires Node.js 20.19+ or 22.12+. Dependencies and fonts are bundled locally. The app makes no requests to an AI service or the CodeCourse backend. Browser testing uses locally installed Google Chrome.

## What to try

- PROJECT: select the three fictional projects, hover and press the angled buttons, open the new/import preview.
- SOURCE: switch files with mouse or arrow keys, toggle the two-column layout, enter ASK and return with Escape. This is a static reading specimen, not a replacement Monaco editor.
- ASK: expand context, choose the suggested question, send with Enter, insert a newline with Shift+Enter, stop, replay, copy and select history. Answers are explicitly marked as simulated.
- Bottom navigation: PROJECT / SOURCE / ASK are available. COURSE / GENERATE / SYSTEM are intentionally disabled until the visual approval gate.
- Ctrl+K: search the three scenes, navigate with arrows, confirm with Enter and dismiss with Escape.
- Top-right sliders: inspect primary, secondary, ghost, danger, busy and disabled buttons. Tab and Shift+Tab remain inside the modal; Escape restores focus.
- System reduced-motion: no parallax, sweeping numbers or ambient fragments. UI sound is off and is not implemented in stage A.

## Review artifacts

The gallery links the nine screenshots under `artifacts` (PROJECT, SOURCE and ASK at 1280×720, 1440×900 and 1920×1080), an ASK answer screenshot, button state screenshots and `direction-c-interaction.webm`.

Candidate art remains under `public/candidates`. The built-in image generator produced three 1672×941 plates despite a 3840×2160 request; these are original preview-resolution assets, not claimed 4K masters. Prompts and provenance are in `ART-DIRECTION.md`. Font licenses are bundled in `public/licenses`.

## Validation

- `npm run build`: TypeScript + Vite production build of the standalone prototype.
- `npm test`: Chrome interaction tests, three-resolution screenshots and video capture.
- Before the first video test, install only the recording helper inside this worktree: in PowerShell, set `$env:PLAYWRIGHT_BROWSERS_PATH=(Join-Path (Get-Location) '.cache/playwright')`, then run `npx playwright install ffmpeg`.
- The test launcher uses this local cache; it does not require a separate Playwright browser download.
- Full production frontend, Android and Electron integration tests belong to later stages. Their source code has not changed during stage A.

## Approval gate

Stage A is a reviewable visual and motion prototype. Stages B–E are **not implemented**. Await approval of the actual screenshots and interactions before integrating business components or producing the other three backgrounds. No merge, rebase, deployment, installer, application upgrade or shortcut modification is part of this delivery.

Known prototype limits: in-memory sample data only; no real file selection or AI; source view is a code specimen without Monaco editing/dragging; split layout is a toggle specimen; full source/answer scroll restoration is deferred to the retained-reader integration; no sound or native Electron window controls. Existing application features remain in the original application, untouched.
