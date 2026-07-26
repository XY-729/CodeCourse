# Android v0.4.0 Release Verification

## Baseline

- **Branch:** `main`
- **Parent:** `ac4ad6fcd691db229de5b2978c641d81c1b8ad5c`
- **Verified implementation commit:** `28f6135e8596fb147175b339401e7557c490fff1`
- **Version:** `0.4.0` (`versionCode 400`)
- **Scope:** release closure plus Android code-reader scroll stability

## Automated Verification

- [x] TypeScript: `pnpm --dir frontend exec tsc --noEmit`
- [x] Vitest: 148 tests in 11 files
- [x] Frontend production build
- [x] Capacitor sync
- [x] Android debug build: `gradlew.bat assembleDebug`
- [x] Gradle unit-test task: `gradlew.bat test`
- [x] Android lint: `gradlew.bat lint`
- [x] GitHub Actions PR Validation for `28f6135`:
  [run 30185587589](https://github.com/XY-729/CodeCourse/actions/runs/30185587589)

## Android Code Reader

- [x] `restoreLine`, `visibleLine`, and `jumpRequest` are separate data flows.
- [x] The saved learning position is captured only when a file tab is opened.
- [x] A database write-back cannot become a new scroll input for the active tab.
- [x] Every code tab uses its instance ID as the React component key.
- [x] Activating a file tab no longer writes a synthetic reading position.
- [x] Initial restore is consumed once per mounted file component.
- [x] Explicit jumps are consumed once per request ID.
- [x] Content, language, theme, search UI, and unrelated parent renders do not replay restore.
- [x] Android code rows and the scroll algorithm use an exact 24px row height.
- [x] Code-reader scroll anchoring is disabled locally.
- [x] `content-visibility:auto` is not used for code rows.
- [x] Files over 1,000 lines use the fixed-height virtual list.
- [x] A 50,000-line file renders fewer than 300 code rows.
- [x] Visible-line persistence uses an 800ms trailing save.
- [x] Pending positions flush on tab close, project switch, and App backgrounding.
- [x] Out-of-order save responses cannot replace a newer learning state.
- [x] Vertical programmatic scrolling is audited as restore, explicit jump, or search result.
- [x] Active Android text selections pin their anchor line in the virtual range.

### Production Regression Coverage

`frontend/src/__tests__/virtualList.test.tsx` contains 12 tests that render the
real `MobileCodeViewer`, plus 3 pure geometry tests:

- 50,000-line bounded DOM
- real scroll to line 20,000
- one-time restore
- App-style 800ms persistence write-back without a second jump
- unrelated parent rerender stability
- same-line explicit request with a new ID
- 200ms search and far-result navigation
- requestAnimationFrame visible-line sampling
- ordinary-file line 100 geometry
- line 500 save/restore round trip
- keyed A/B file isolation
- selection-anchor pinning
- stable CSS geometry

`frontend/src/__tests__/trailingSaveScheduler.test.ts` additionally verifies
that 100 scroll updates produce exactly one database callback containing the
latest position.

## Release Closure

- [x] Foreground generation coordinator reconciles native state and switches tasks transactionally.
- [x] Notification permission is rechecked when returning from system settings.
- [x] Warm completion navigation is acknowledged and deduplicated.
- [x] Checkpoint and coordinator tests use production implementations.
- [x] Android workspace layout helpers are imported from production code.
- [x] Debug APK exists at `android/app/build/outputs/apk/debug/app-debug.apk`.
- [ ] Signed release APK (release keystore is not available in this environment).

## Real Device Verification

The following checks remain mandatory on a real Android device:

- [ ] Open files containing 300, 2,000, 10,000, and 50,000 lines.
- [ ] Scroll each file rapidly for 30 seconds, stop, and confirm no movement for 5 seconds.
- [ ] Background the App for 10 seconds and confirm the reader does not jump on resume.
- [ ] Open and close search without changing the reading position.
- [ ] Select a search result and confirm this explicit action is the only resulting jump.
- [ ] Change the theme without changing the reading position.
- [ ] Long-press text and drag both selection handles without collapsing the selection.
- [ ] Switch repeatedly between files A and B without sharing positions.
- [ ] Observe a development build and confirm ordinary reading emits no `programmatic-scroll` log.
- [ ] Verify foreground notification progress, completion navigation, permission recovery, and retry.

## Known Limitations

1. The generated APK is a debug build and is not suitable for public distribution.
2. Gradle's `test` task succeeds, but this repository still relies mainly on
   TypeScript production-path tests for the Capacitor coordinator.
3. Real-device verification has not been performed in this environment.

## Release Conclusion

**未达到正式发布条件。**

Automated verification is green, but the real-device matrix and signed release
APK are still required. Do not create the `v0.4.0` tag or GitHub Release yet.
