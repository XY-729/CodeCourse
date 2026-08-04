## ADDED Requirements

### Requirement: Per-lesson file selection at outline stage
After the outline is generated, the system SHALL select and persist a list of involved files for each lesson, so lesson generation can inject real code from those files.

#### Scenario: Files selected from outline lessons
- **WHEN** the outline generation task completes and the outline contains lessons
- **THEN** for each lesson, the system selects 2–10 involved files from the repository
- **AND** the selection is persisted (file path per lesson) for later lesson generation

#### Scenario: Selection uses code index when available
- **WHEN** the code index for the project has been built (active generation > 0)
- **THEN** file selection searches the index with the lesson title + lesson section text as query
- **AND** the top matching files are selected

#### Scenario: Selection falls back to key files when index is empty
- **WHEN** the code index is not built (active generation == 0) or search returns nothing
- **THEN** file selection falls back to key files (README, package.json, build config, entry points) detected from the repository tree
- **AND** the lesson files remain non-empty for any repository-type lesson

#### Scenario: LLM-assisted selection for ambiguous lessons
- **WHEN** the system's automatic selection confidence is low (few or no index hits)
- **THEN** the system MAY include a second LLM call asking the model to pick involved files from the outline lesson description + repository tree

#### Scenario: Selection persisted across tasks
- **WHEN** the lesson file list is selected at outline stage
- **THEN** it is stored persistently (DB table keyed by project_id + lesson number)
- **AND** the file lesson generation task reads the same persisted list

### Requirement: Lesson generation injects real file code
Lesson generation SHALL include actual code from the lesson's involved files in the prompt input, instead of relying solely on RAG search results.

#### Scenario: Course-level lesson gets file code blocks
- **WHEN** an outline lesson (course-level) is generated for a repository project
- **THEN** the prompt input includes a "涉及文件代码" section with code excerpts from each involved file
- **AND** each excerpt is labeled with file path and line range (e.g., `### src/main.cpp:103-315`)
- **AND** excerpts are capped (e.g., per-file head/tail sampling, total budget ≤ ~24,000 chars)

#### Scenario: File-level lesson gets full file code
- **WHEN** a file lesson (file-level, detailed mode) is generated
- **THEN** the prompt input includes the file's full content (or compacted head/tail for very large files)

#### Scenario: RAG evidence still included when available
- **WHEN** the code index is built and search returns matching chunks
- **THEN** RAG evidence is included in the prompt input in addition to the file code blocks
- **AND** file code blocks take precedence as the primary source

#### Scenario: No more empty code references
- **WHEN** the lesson input contains file code blocks with real content
- **THEN** the LLM no longer receives "索引中没有匹配片段。" as the only code context

### Requirement: Desktop lesson length parity with Android
Desktop lesson generation SHALL provide code context comparable to the Android local pipeline, so generated lessons have similar length and code reference density.

#### Scenario: Desktop lesson input includes file code
- **WHEN** `build_outline_lesson_input` runs for a repository project
- **THEN** the returned lesson_input includes the involved files' code (same mechanism as the Android `projectContext` fallback)
- **AND** when the RAG index is empty, the code blocks come from direct file reads, not empty search results

#### Scenario: Desktop and Android inputs converge in structure
- **WHEN** both pipelines generate the same lesson
- **THEN** both prompt inputs contain: outline summary, lesson plan section, involved-file code blocks, and RAG evidence when available
