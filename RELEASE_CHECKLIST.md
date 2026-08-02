# CodeCourse v0.4.3 Release Verification

## Scope

- Reliable unfamiliar-term discovery, diagnostics, and rescan controls.
- Knowledge-network interaction and large-layout performance improvements.
- Initial extraction of term routing, polling, and graph layout modules.
- Windows Setup/Portable and permanently signed Android distribution.

## Automated Verification

- [x] TypeScript and frontend production build.
- [x] Frontend Vitest: 55 files, 401 tests.
- [x] Backend unittest: 235 tests.
- [x] Android Gradle unit tests.
- [x] Android Lint after API 26/27 resource separation.
- [x] Signed Android release APK built with the permanent CodeCourse key.
- [x] APK Signature Scheme v2 verification and certificate fingerprint check.
- [x] APK privacy scan.
- [x] PyInstaller backend build.
- [x] Windows Portable and NSIS Setup builds.
- [x] Windows file version and Electron update metadata are `0.4.3`.

## Runtime Verification

- [x] `win-unpacked` cold start keeps the packaged backend alive.
- [x] Restored project, learning state, QA, knowledge, file, and term-status requests return successfully.
- [x] Existing `0.3.0` installation upgraded to `0.4.3` without removing user data.
- [x] Installed build cold start keeps the packaged backend alive.
- [x] Desktop shortcut targets the installed `0.4.3` executable.
- [ ] Android real-device smoke test was not available on this machine.

## Distribution

- [x] Production tag workflow fails when Android signing secrets are absent.
- [x] CI validates tag/package, Windows ProductVersion, and Android versionName consistency.
- [x] CI creates `SHA256SUMS.txt` after all platform builds succeed.
- [x] Release assets use fixed Setup, Portable, and Android names.
- [x] Electron auto-update metadata is published with the Setup asset.
- [x] Android debug tags are isolated from production release tags.

## Known Limitations

1. Windows executables are not commercially code-signed and may trigger SmartScreen.
2. `App.tsx`, `localProvider.ts`, and `KnowledgeGraphViewer.tsx` remain above the planned size targets. This release extracts bounded modules without a risky late-stage rewrite.
3. `highlight.js` remains a large lazy vendor chunk; production build emits a size warning but succeeds.

## Release Conclusion

Automated and Windows runtime verification are green. The signed Android artifact is suitable for release, with real-device smoke testing recorded as the remaining manual follow-up.
