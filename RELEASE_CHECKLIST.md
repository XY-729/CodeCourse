# CodeCourse post-v0.4.4 verification

This checklist describes the current development tree. It does not certify a published release or replace device testing.

## Automated verification

- [x] TypeScript check.
- [x] Frontend Vitest: 90 files, 509 tests.
- [x] Frontend desktop production build.
- [x] Frontend Android production build.
- [x] Android Capacitor sync.
- [x] Backend unittest: 303 tests.
- [ ] Android Gradle unit tests, Lint, and Debug APK build. Local verification is blocked because the required Android Gradle Plugin artifacts are not cached and network access is unavailable; CI must run these jobs.

## Android checks

- [x] Android build excludes desktop-only detached-window, Monaco, desktop-toolbar, gesture-guide, call-guide, and desktop generation-sheet chunks.
- [x] WebView generation is documented as foreground-only with persisted checkpoint recovery.
- [x] Foreground Service, WakeLock, battery-optimization exemption, and unused broad FileProvider declarations are removed.
- [x] Completion-only notification contract and application-ID tests replace Capacitor template tests.
- [ ] Real-device smoke test: foreground generation, interruption recovery, notification permission states, completion notification navigation, local ZIP import, and public repository import.

## Release-only checks

- [ ] Build a signed release APK with the permanent CodeCourse key.
- [ ] Verify APK Signature Scheme v2 and certificate fingerprint.
- [ ] Run the APK privacy scan.
- [ ] Build Windows Portable and NSIS Setup artifacts.
- [ ] Verify package versions and update metadata match the intended tag.
- [ ] Generate checksums after all platform artifacts succeed.
- [ ] Publish only after CI and manual smoke tests are complete.

## Known limitations

1. Android generation requires the app to remain in the foreground. If Android suspends or terminates the app, reopening it resumes from the latest valid checkpoint.
2. Android supports public repository snapshots and local ZIP imports; desktop filesystem and detached-window features are intentionally absent.
3. Windows executables are not commercially code-signed and may trigger SmartScreen.
