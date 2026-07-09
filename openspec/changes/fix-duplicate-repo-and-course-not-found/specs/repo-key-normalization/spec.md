## ADDED Requirements

### Requirement: GitHub URL normalization
The system SHALL normalize GitHub HTTPS and SSH URLs to a canonical `github.com/OWNER/REPO` key. Both `OWNER` and `REPO` SHALL be lowercased, as GitHub treats owner and repo names case-insensitively.

#### Scenario: HTTPS URL with .git suffix
- **WHEN** `normalize_github_repo_key("https://github.com/Owner/Repo.git")` is called
- **THEN** the result is `github.com/owner/repo`

#### Scenario: HTTPS URL without .git suffix
- **WHEN** `normalize_github_repo_key("https://github.com/owner/repo")` is called
- **THEN** the result is `github.com/owner/repo`

#### Scenario: SSH URL
- **WHEN** `normalize_github_repo_key("git@github.com:Owner/Repo.git")` is called
- **THEN** the result is `github.com/owner/repo`

#### Scenario: Non-GitHub URL returns unmodified
- **WHEN** `normalize_github_repo_key("https://gitlab.com/user/project.git")` is called
- **THEN** the result is `https://gitlab.com/user/project.git` (unchanged, with .git stripped but host preserved)

### Requirement: projects table includes repo_key
The `projects` table SHALL have a `repo_key TEXT` column that stores the canonical repository key.

#### Scenario: Migration adds repo_key to existing database
- **WHEN** the application starts with a database that has projects table but no `repo_key` column
- **THEN** `init_storage` adds the `repo_key` column and backfills existing rows by computing `normalize_github_repo_key(url)` for each

### Requirement: Import deduplication by repo_key
Importing a project SHALL match existing projects by `repo_key` rather than by raw URL.

#### Scenario: Import same repo via HTTPS then SSH
- **WHEN** a user imports `https://github.com/owner/repo.git`
- **AND** later imports `git@github.com:owner/repo.git`
- **THEN** only one project record exists with `updated_at` reflecting the second import

### Requirement: list_projects deduplication
`list_projects` SHALL not return multiple records with the same `repo_key`. If duplicates exist, only the record with the most recent `updated_at` SHALL be retained.

#### Scenario: Pre-existing duplicates are filtered
- **WHEN** the projects table contains two records with the same `repo_key` but different `url` values
- **THEN** `list_projects` returns only the record with the most recent `updated_at`
EOF" && cat > ~/github-project-learner/openspec/changes/fix-duplicate-repo-and-course-not-found/specs/course-error-responses/spec.md" << 'EOF'
## ADDED Requirements

### Requirement: Course file not found returns structured error
When a course file does not exist, the API SHALL return a 404 response with a JSON body containing `detail`, `error_type`, and `filename` fields.

#### Scenario: Requesting a non-existent course file
- **WHEN** `GET /api/projects/1/course/nonexistent.md` is requested
- **THEN** the response status is 404
- **AND** the response body contains `{"detail": "Course file not found: nonexistent.md", "error_type": "course_file_not_found", "filename": "nonexistent.md"}`

#### Scenario: Requesting a valid course file
- **WHEN** `GET /api/projects/1/course/outline.md` is requested and the file exists
- **THEN** the response status is 200
- **AND** the response body contains the file content

### Requirement: Frontend surfaces server error detail
The frontend SHALL include the triggering action in error messages shown to the user when course file loading fails.

#### Scenario: Frontend shows contextual error for course load failure
- **WHEN** the frontend fails to load course content for a file
- **THEN** the error message displayed includes the action context (e.g., "读取课件失败: Course file not found: outline.md")
