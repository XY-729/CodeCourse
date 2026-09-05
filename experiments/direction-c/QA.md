# Direction C — stage A review

## Result and scope

Three runnable desktop scenes are available for visual approval. Production business integration (stages B–E) is not started. All added source, dependencies, candidate art, tests, screenshots and video live under this experiment directory.

## Checks completed

- TypeScript checking and Vite production build passed.
- Eight Chrome tests passed together: three resolution suites plus scene lifecycle, ASK interactions, modal focus, reduced motion / command navigation, and video recording.
- The additional review-gallery test passed: all three screenshot groups decode, resolution switching works, the video exposes playable metadata and has a duration over eight seconds, with no uncaught browser errors.
- ASK replay was then adjusted to replace its existing history item instead of duplicating the same question. Two targeted ASK / modal tests passed after that adjustment.
- Screenshots cover PROJECT, SOURCE and ASK at 1280×720, 1440×900 and 1920×1080. The tests check visible control bounds, single scene ownership, composer / footer separation, and minimum usable answer area.
- Browser runtime checks recorded no uncaught page errors or external network requests across the scene screenshot suites. Font and image resources are served locally.
- ASK checks include empty-send disabled, IME composition, Shift+Enter, simulated streaming, cancellation without extra paragraphs, replay, clipboard copy, 2,000-character input and history selection.
- Modal checks include one dialog, inert background, Tab/Shift+Tab containment, Escape, focus restoration, HUD feedback, disabled/busy specimens, hover and press screenshots.
- Scene checks include input lock during the 700ms sweep, focus after exit, retained active source file and split state when returning from ASK.
- Reduced-motion checks confirm no background transform or sweeping overlay while scene navigation and modal controls remain usable.
- Video captures project hover/selection, SOURCE entry, split toggle, ASK entry, input focus, send hover and paragraph reveal. Original recording is retained alongside a stable review copy.

## Visual corrections made during review

1. Moved toast feedback away from the input controls and disabled pointer interception on this noninteractive layer.
2. Deferred scene focus until React removes `inert`; preserved modal entry focus through the exit animation.
3. Removed the visual outline from the noninteractive scene heading used as a focus destination. Interactive controls retain visible keyboard outlines.
4. Added a dark backing behind top-right icons so they remain visible over the white moon.
5. Increased source sample text to a minimum of 14px; reserved additional bottom space for the ASK composer at 720px height.
6. Kept generated art behind the content; source text does not participate in parallax. Existing answer paragraphs are not replayed when subsequent paragraphs arrive.
7. Locked compatible `motion-dom` and `motion-utils` versions after the registry resolved incompatible newer transitive versions.

## Repository isolation

- The experiment was created from `dcd00f7e59bcd86e6ea8c8032fe54b0e36955f1d`.
- At creation, the original `main` tracked files were clean and `tmp/` was already untracked. This task did not read, change or stage that directory.
- During final read-only inspection, the original `main` had independently advanced to `f8373c8220b06378006a3a947584787e3dbd2f87` and had personalization/backend/Android changes. This task did not create or incorporate those changes. Consequently, the main worktree cannot be described as globally unchanged during this session.
- The other listed worktrees remained at `2451c6d`, `585e4cc`, `858b78b` and `4db48c4` at the final inspection.
- The experiment's diff against its specified baseline is confined to `experiments/direction-c/`. Production frontend, backend, Android, Electron, package metadata and existing shortcuts are outside the diff.
- No merge, rebase, remote push, installer creation, application installation or shortcut modification was performed.

## Open gate and remaining work

User visual approval is required by the accepted stage-A plan before business integration. Remaining work includes three additional scene designs, 4K master art and transparent decorations, reusable production components, retained Monaco / Markdown readers, actual draggable split panes, all API-backed workflows, full scroll restoration, and production frontend / Android / Electron regression testing. Original optional UI sounds remain unimplemented and off.

The current three generated background plates are 1672×941. Their exact built-in generation prompts are in `ART-DIRECTION.md`; no upscaled preview is represented as a 4K master. No claim of pixel-identical Persona artwork or animation validation is made.
