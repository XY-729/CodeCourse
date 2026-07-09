## Why

Importing the same GitHub repository via HTTPS (e.g., `https://github.com/owner/repo.git`) and SSH (e.g., `git@github.com:owner/repo.git`) creates duplicate project records because the system matches on the raw URL. Additionally, the frontend displays a bare "Not Found" when course files are missing, giving users no actionable information.

## What Changes

**Problem 1 — Duplicate projects from URL variants:**
- Add `normalize_github_repo_key(url)` in `git_service.py` to normalize HTTPS and SSH GitHub URLs to a canonical `github.com/OWNER/REPO` key
- Add `repo_key` column to `projects` table
- Change `upsert_project` to deduplicate by `repo_key` instead of raw URL
- Auto-migrate existing databases to add and backfill `repo_key`
- `list_projects` deduplicates by `repo_key`, keeping the most recently updated record
- Importing the same repo via a different URL scheme updates the existing project record

**Problem 2 — Frontend "Not Found" with no context:**
- Ensure `backend/app/main.py` includes the `course` router
- Verify the frontend API path in `getCourseContent` matches the backend route
- Replace bare 404 responses with structured `{"detail": "Course file not found: ..."}` error messages
- Frontend surfaces the server error message instead of generic "Not Found"

**Tests:**
- New tests: HTTPS/SSH URL normalization, project deduplication on import, course outline endpoint, missing course file error format

## Capabilities

### New Capabilities
- `repo-key-normalization`: Normalize GitHub HTTPS and SSH URLs to a canonical `github.com/OWNER/REPO` key for deduplication
- `course-error-responses`: Structured error responses for missing course files instead of bare 404

### Modified Capabilities
<!-- No existing spec files to modify -->

## Impact

- `backend/app/services/git_service.py` — new `normalize_github_repo_key()` function
- `backend/app/services/project_service.py` — `upsert_project` and `list_projects` updated for `repo_key`
- `backend/app/db.py` — migration to add `repo_key` column; `upsert_project` dedup logic
- `backend/app/routers/course.py` — improved error responses
- `backend/app/main.py` — verify course router is included
- `frontend/src/` — `getCourseContent` path check, error message display
- `backend/tests/` — new test cases for normalization, dedup, and course endpoints
