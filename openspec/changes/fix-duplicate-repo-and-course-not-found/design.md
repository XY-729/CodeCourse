## Context

The GitHub Project Learner imports repos by URL. Currently the `projects` table uses `url TEXT NOT NULL UNIQUE`, meaning `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git` are treated as different projects. The README explicitly suggests switching between HTTPS and SSH due to network instability on the VM, which makes this duplication likely in practice.

The frontend shows bare "Not Found" errors when course files are missing because the error handling chain loses context between the backend FastAPI response and the frontend error display.

## Goals / Non-Goals

**Goals:**
- Normalize GitHub URLs to a canonical `github.com/OWNER/REPO` key for deduplication
- Migrate existing databases safely (add column + backfill)
- Deduplicate on import and in list queries
- Make course file 404s return actionable error messages
- Ensure the frontend surfaces the server's error detail

**Non-Goals:**
- Support non-GitHub URLs for normalization (out of MVP scope)
- Merge already-duplicated project data (just keep the latest)
- Change the frontend routing or add new UI components

## Decisions

### Decision 1: Canonical repo_key format `github.com/OWNER/REPO`

Strip `.git` suffix and trailing slashes from both HTTPS and SSH forms. This is lossless for dedup and human-readable.

**Alternatives considered:**
- Hash-based key (e.g., sha256 of normalized URL): Not readable in the DB, harder to debug.
- Just lowercase: Insufficient — HTTPS vs SSH is the primary source of duplicates.

### Decision 2: ALTER TABLE migration in init_storage

Check `PRAGMA table_info(projects)` for the `repo_key` column, add it if missing, then backfill. This avoids a separate migration framework for the MVP.

SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we inspect the schema first.

### Decision 3: upsert_project matches on repo_key, updates url and name

When importing the same repo via a different URL scheme, the existing project record gets its `url` and `name` updated to reflect the new import, and `updated_at` is refreshed. This way the project list stays clean.

### Decision 4: list_projects returns DISTINCT

Use a subquery to pick the row with the max `updated_at` per `repo_key`. This handles any pre-existing duplicates from before the migration.

### Decision 5: Structured error detail for course endpoints

Instead of plain string "Not Found", return an object with `detail`, `error_type`, and `filename`. The frontend `request()` function already parses `body.detail`, so enhance it to show the full context.

## Risks / Trade-offs

- **Backfill on large DB**: Not a concern for MVP — project count is tiny.
- **Non-GitHub URLs**: `normalize_github_repo_key` returns the original URL unchanged for non-matching formats, preserving existing behavior.
- **Race condition on import**: Two concurrent imports of the same repo could both pass the lookup and both insert. Mitigation: we rely on SQLite's `UNIQUE` constraint on `repo_key` to prevent duplicates, and retry the read path on conflict.
