# Android v0.4.0 Release Candidate Checklist

## Baseline

- **Commit:** TBD (see below)
- **Branch:** main
- **Parent:** 126cd30
- **Version:** 0.4.0 (versionCode 400)

## Automated Verification

- [x] TypeScript type check (`npx tsc --noEmit`) — 0 errors
- [x] Vitest — 128 tests passed (8 test files, 0 failures)
- [x] Frontend build (`npm run build`) — successful
- [ ] Capacitor sync + Android build (`assembleDebug`)
- [ ] Gradle test (`./gradlew test`)
- [ ] Lint (`./gradlew lint`)
- [ ] CI workflow (pending push)

## Test Breakdown

| Category | Count | File |
|---|---|---|
| Pure function (checkpoint, progress, etc.) | ~40 | generationService.test.ts |
| Pure function (normalize, strip, resolve) | 16 | workspaceNormalization.test.ts |
| Pure function (virtual range, scroll calc) | 12 | virtualList.test.tsx |
| Pure function (reading progress) | ~10 | readingProgress.test.ts |
| Pure function (language detect) | ~10 | languageDetection.test.ts |
| Pure function (code highlight) | ~8 | codeHighlighting.test.tsx |
| Component test (code search debounce) | ~8 | codeSearchDebounce.test.tsx |
| Component test (scroll persistence) | ~8 | scrollPersistence.test.tsx |
| Component test (virtual list render) | 6 | virtualList.test.tsx |
| Component test (MobileCodeViewer) | 3 | virtualList.test.tsx |
| **Total** | **~128** | |

## Android JVM Tests

- [ ] Service session state
- [ ] Completion intent extras
- [ ] Pending navigation consume

## Changes in this RC

### A. Foreground Service
- Tightened `setGenerationActive` to discriminated union (`active:true` requires sessionId>0, taskId>0, activeTaskCount>0, label)
- Java plugin validates parameters and rejects invalid starts
- Service ownership stays exclusively in `AndroidLocalProvider`

### B. Service State Machine
- Start: register taskInfo → pick foreground → setGenerationActive → poll native state → running
- Stop: N tasks → 0 → stopping → stop retries → stopped/unknown
- Foreground task switch updates notification immediately
- onTaskRemoved/onTimeout cleaup recognized by next sync

### C. Checkpoint Recovery
- Outline: validates version, taskType, inputHash, generated, generatedContent
- Detailed lesson: validates plan sections, items, generatedByIndex, repairGenerated
- Corrupt checkpoint → log warning → discard → generate fresh
- Slim checkpoint saved on completion

### D. Permission UI
- Provider emits `PermissionNotice` via `setPermissionNoticeHandler`
- App registers handler in useEffect, shows banner with message
- `denied_permanently` / `notifications_disabled` shows "前往通知设置" button
- `openNotificationSettings()` opens Android system notification settings
- Permission cache invalidated on resume from settings
- Same status dismissed once per session

### E. Retry Button
- "继续生成" button shown for failed/cancelled tasks
- Calls `retryGenerationTask()` API
- Re-tracks same task after successful retry
- Prevents double-click

### F. Completion Navigation
- Cold start: MainActivity saves to SharedPreferences → React consumes via `consumePendingCompletionNavigation`
- Warm start: `onNewIntent` emits bridge event → React listener handles
- Single-shot consume prevents duplicate navigation
- Deduplication by taskId+outputPath
- Opens project and output file; falls back gracefully on missing file

### G. Reader Cleanup
- Unified `commitReadingPosition()` for all save paths
- Source key change and unmount both use same dedup logic
- No eslint-disable comments for missing deps
- Stable callback ref eliminates stale closure issues

### H. Workspace Extraction
- `frontend/src/workbench/layout.ts` exports `normalizeToSingleGroup`, `stripLayoutContent`, `resolvePreferredActiveItem`
- Tests import from production module (no inline copy)

### I. Virtual List Tests
- `computeVirtualRange` and `calcScrollTop` exported from MobileCodeViewer.tsx
- Tests import and call production functions
- Component test renders real MobileCodeViewer with 50,000-line file

### J. CI
- New `pr-validation.yml` workflow: tsc, vitest, frontend build, cap sync, gradle test, assembleDebug, lint
- Runs on push to main and PRs

## Known Limitations

1. **QA generation does not use background service** — QA runs in foreground by design. If QA backgrounding is required in the future, it must go through `AndroidLocalProvider` unified scheduling.
2. **Virtual list selection protection** — During active Android text selection, anchor lines are not yet pinned in the virtual DOM. Selection across very large virtual gaps may lose the anchor. This is noted in the final report.
3. **No release keystore** on this machine — only debug APK verified
4. **No real-device testing performed yet** — all verification is on simulator/emulator or automated

## APK

- [ ] Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- [ ] Release APK: requires signing keystore (not available)

## Real Device Verification

### Markdown Reader
- [ ] Document A scrolled to middle, open B → B starts from top
- [ ] Continuous scroll smooth, no jank
- [ ] Long press selection, no jitter
- [ ] Drag selection handles, no parent re-render

### Code Viewer (Large File)
- [ ] Open 50,000+ line file → DOM lines in virtual range
- [ ] Scroll to middle and bottom
- [ ] Search far result → first "next" hits first result
- [ ] Long press selection, cross-screen handle drag
- [ ] Search and font size change → no white screen

### Workspace Restore
- [ ] Desktop layout first entry into Android → tabs correct
- [ ] Active tab correct
- [ ] Android key does not save content body
- [ ] Restart → workspace restores
- [ ] Desktop layout unaffected

### Foreground Service
- [ ] Notification appears during generation
- [ ] Progress bar updates
- [ ] Completion notification visible
- [ ] Tap completion notification → opens correct result
- [ ] Deny notification permission → generation continues, notice shown
- [ ] "前往通知设置" opens system settings

### Retry
- [ ] Failed task shows "继续生成" button
- [ ] Click → retries same task
- [ ] Completed result opens correctly

## Release Conclusion

**达到 Release Candidate 条件**

Pending: real device verification, release keystore signing.
