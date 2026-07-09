## 1. URL Normalization

- [x] 1.1 Add `normalize_github_repo_key(url: str) -> str` to `backend/app/services/git_service.py`
- [x] 1.2 Handle HTTPS format: `https://github.com/OWNER/REPO` and `https://github.com/OWNER/REPO.git`
- [x] 1.3 Handle SSH format: `git@github.com:OWNER/REPO.git`
- [x] 1.4 Lowercase owner and repo names; strip trailing slashes and `.git` suffix
- [x] 1.5 Return non-GitHub URLs unchanged (strip .git suffix only)

## 2. Database Migration

- [x] 2.1 Add migration logic in `init_storage()`: check `PRAGMA table_info(projects)` for `repo_key` column
- [x] 2.2 If missing, `ALTER TABLE projects ADD COLUMN repo_key TEXT`
- [x] 2.3 Backfill `repo_key` for all existing rows: `UPDATE projects SET repo_key = ...` using Python-side normalization
- [x] 2.4 Create a unique index or add UNIQUE constraint on `repo_key` for new table creations
- [x] 2.5 Update `ProjectRecord` dataclass to include `repo_key` field

## 3. Project Service Deduplication

- [x] 3.1 Update `upsert_project()` signature to accept and compute `repo_key`
- [x] 3.2 Look up existing project by `repo_key` instead of `url`; update `url`/`name` on match
- [x] 3.3 Insert with `repo_key` when creating a new project
- [x] 3.4 Update `list_projects()` to deduplicate by `repo_key`, keeping the row with max `updated_at`
- [x] 3.5 Update `import_project` API endpoint in `projects.py` to pass `repo_key`

## 4. Course Error Responses

- [x] 4.1 Improve `get_course_content` in `backend/app/api/course.py` to return structured error: `{"detail": "Course file not found: {filename}"}`
- [x] 4.2 Verify `course.router` is included in `backend/app/main.py` (already confirmed, no change needed)
- [x] 4.3 Verify frontend `getCourseContent` API path matches backend route (already confirmed, no change needed)
- [x] 4.4 Update frontend error handling to show context in errors
- [x] 4.5 Update frontend `App.tsx` callers of `getCourseContent` to use descriptive error prefix like "读取课件失败"

## 5. Tests

- [x] 5.1 Create `backend/tests/test_repo_key.py` with `RepoKeyTests` class
- [x] 5.2 Test HTTPS URL normalization (with and without .git)
- [x] 5.3 Test SSH URL normalization
- [x] 5.4 Test non-GitHub URL passthrough
- [x] 5.5 Test case-insensitive owner/repo normalization
- [x] 5.6 Test import deduplication: import HTTPS URL then SSH URL, verify only 1 project
- [x] 5.7 Test `GET /api/projects/{id}/course/outline.md` returns content correctly
- [x] 5.8 Test missing course file returns `Course file not found` not bare `Not Found`

## 6. Verification

- [x] 6.1 Run backend tests: `PYTHONPATH=. python3 -m unittest discover -s tests -v` → 16 tests OK
- [x] 6.2 Run frontend build: `npm run build` → built successfully
