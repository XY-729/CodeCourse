## 1. Data Layer — Python Backend (Desktop)

- [ ] 1.1 Add `concepts` table to `storage.py` schema: id TEXT PK, canonical_name TEXT UNIQUE, display_name TEXT, domain TEXT, concept_type TEXT, aliases_json TEXT, difficulty REAL, created_at TEXT
- [ ] 1.2 Add `concept_mastery` table: id TEXT PK, concept_id TEXT, scope_type TEXT, scope_id TEXT, known_evidence REAL DEFAULT 1, unknown_evidence REAL DEFAULT 1, mastery REAL DEFAULT 0.5, uncertainty REAL DEFAULT 0.707, manual_status TEXT, last_seen_at TEXT, updated_at TEXT. UNIQUE(concept_id, scope_type, scope_id)
- [ ] 1.3 Add `learning_events` table: id TEXT PK, concept_id TEXT, event_type TEXT, direction TEXT, strength REAL, evidence_text TEXT, session_id TEXT, qa_record_id TEXT, is_voided INTEGER DEFAULT 0, created_at TEXT
- [ ] 1.4 Add `learner_preferences` table: id TEXT PK, scope_type TEXT, scope_id TEXT, answer_depth REAL DEFAULT 0.5, code_ratio REAL DEFAULT 0.5, example_preference REAL DEFAULT 0.5, principle_preference REAL DEFAULT 0.5, prerequisite_detail REAL DEFAULT 0.5, terminology_density REAL DEFAULT 0.5, updated_at TEXT. UNIQUE(scope_type, scope_id)
- [ ] 1.5 Add `term_impressions` table: id TEXT PK, concept_id TEXT, qa_record_id TEXT, was_displayed INTEGER DEFAULT 0, was_opened INTEGER DEFAULT 0, feedback TEXT, display_style TEXT, display_position INTEGER, created_at TEXT
- [ ] 1.6 Add migration logic in `storage.py` (`_migrate_*` functions or version check) to create new tables on existing databases
- [ ] 1.7 Add seed data for common programming concepts (~50–100 concepts across domains: frontend, backend, database, android, general CS) in `concepts` table
- [ ] 1.8 Add CRUD functions in `storage.py`: `upsert_concept()`, `get_concept()`, `get_concepts_by_domain()`, `search_concepts()`, `upsert_concept_mastery()`, `get_concept_mastery()`, `get_concepts_mastery_batch()`, `insert_learning_event()`, `get_learning_events()`, `void_learning_event()`, `upsert_learner_preferences()`, `get_learner_preferences()`, `insert_term_impression()`, `update_term_impression()`, `get_term_impressions()`

## 2. Data Layer — Android (Capacitor SQLite)

- [ ] 2.1 Add same 5 tables to `frontend/src/platform/android/database.ts` (`initTables()` method)
- [ ] 2.2 Add TypeScript query methods in `database.ts`: `upsertConcept()`, `getConcept()`, `searchConcepts()`, `upsertConceptMastery()`, `getConceptMastery()`, `getConceptsMasteryBatch()`, `insertLearningEvent()`, `getLearningEvents()`, `upsertLearnerPreferences()`, `getLearnerPreferences()`, `insertTermImpression()`, `updateTermImpression()`
- [ ] 2.3 Mirror same seed data insertion for concepts on Android database init
- [ ] 2.4 Verify Android database migration adds new tables without breaking existing data

## 3. Core Personalization Engine (Shared TypeScript)

- [ ] 3.1 Create `frontend/src/personalization/types.ts` with all TypeScript interfaces: `Concept`, `ConceptMastery`, `LearningEvent`, `LearnerPreferences`, `TermImpression`, `TermCandidate`, `LearnerContext`, `EventType`, `ScopeType`
- [ ] 3.2 Create `frontend/src/personalization/masteryEngine.ts` with:
  - `EVIDENCE_DELTAS` constant mapping event types to (knownDelta, unknownDelta)
  - `updateMastery(event: LearningEvent, current: ConceptMastery): ConceptMastery`
  - `replayMastery(events: LearningEvent[]): ConceptMastery`
  - `calculateMastery(knownEvidence, unknownEvidence): { mastery, uncertainty }`
  - `applyDecay(lastSeenAt: string): number` (uncertainty multiplier)
- [ ] 3.3 Create `frontend/src/personalization/eventRecorder.ts` with:
  - `recordEvent(params): Promise<LearningEvent>`
  - `voidEvent(eventId: string): Promise<void>`
  - `getEventsForConcept(conceptId, scope): Promise<LearningEvent[]>`
- [ ] 3.4 Create `frontend/src/personalization/termLinkScorer.ts` with:
  - `scoreTermLink(candidate: TermCandidate, mastery: ConceptMastery): number`
  - `getDisplayTier(score: number): "prominent" | "subtle" | "none"`
  - `selectTopTerms(candidates: ScoredTerm[], textLength: number): ScoredTerm[]`
  - `EXPLORATION_BONUS` logic for uncertain concepts
- [ ] 3.5 Create `frontend/src/personalization/learnerContext.ts` with:
  - `buildLearnerContext(projectId, questionText, masteryMap, preferences): string`
  - `extractConceptsFromText(text: string): string[]`
  - `categorizeConcepts(masteryMap): { known, unfamiliar, uncertain }`
- [ ] 3.6 Create `frontend/src/personalization/preferenceTracker.ts` with:
  - `updatePreferences(current, feedbackType): LearnerPreferences`
  - `PREFERENCE_NUDGE` constants (small deltas per feedback type)
  - Learning rate decay for stabilized preferences
- [ ] 3.7 Create `frontend/src/personalization/index.ts` barrel export

## 4. API Layer — Python Backend

- [ ] 4.1 Create or extend `backend/app/api/personalization.py` with endpoints:
  - `GET /api/projects/{id}/concepts` — search/list concepts
  - `GET /api/projects/{id}/mastery` — get mastery for concept batch
  - `PUT /api/projects/{id}/mastery/{concept_id}` — manual override
  - `POST /api/projects/{id}/events` — record learning event
  - `GET /api/projects/{id}/events/{concept_id}` — get event history
  - `GET /api/projects/{id}/preferences` — get learner preferences
  - `PUT /api/projects/{id}/preferences` — update preferences
  - `POST /api/projects/{id}/impressions` — record term impressions
  - `GET /api/projects/{id}/profile` — full profile export
  - `POST /api/projects/{id}/profile/import` — profile import
  - `DELETE /api/projects/{id}/profile` — reset profile
- [ ] 4.2 Register new router in `backend/app/main.py`
- [ ] 4.3 Extend `backend/app/services/qa_service.py`:
  - Call concept extraction before prompt construction
  - Query mastery for extracted concepts
  - Build and inject `<learner_context>` into user message
- [ ] 4.4 Extend `backend/app/services/term_service.py`:
  - Accept mastery data when computing term display decisions
  - Apply linkScore thresholds and display caps
  - Return display tier with each term

## 5. API Layer — TypeScript Client + Android Provider

- [ ] 5.1 Add TypeScript types for all new API request/response shapes in `frontend/src/api/client.ts`
- [ ] 5.2 Add API functions: `fetchConcepts()`, `fetchMastery()`, `updateMasteryManual()`, `recordLearningEvent()`, `fetchLearningEvents()`, `fetchPreferences()`, `updatePreferences()`, `recordTermImpressions()`, `exportProfile()`, `importProfile()`, `resetProfile()`
- [ ] 5.3 Add corresponding methods in `frontend/src/platform/android/localProvider.ts` that call the shared TypeScript engine directly (no HTTP round-trip needed on Android)
- [ ] 5.4 Add concept extraction from text in `localProvider.ts` (simple keyword matching against concepts table for Phase 1)

## 6. UI — Term Feedback in MarkdownViewer

- [ ] 6.1 Create `frontend/src/components/TermFeedbackPopover.tsx`:
  - Renders term name, brief definition, and action buttons
  - [我认识] → records `marked_known` event, dismisses popover
  - [我不认识] → records `marked_unknown` event, expands explanation
  - [详细解释] → opens full ExplainPanel for this concept
  - [以后少提示这类词] → nudges preference, dismisses
  - Positioned near the clicked term, auto-dismisses on scroll
- [ ] 6.2 Modify `frontend/src/components/MarkdownViewer.tsx`:
  - During term rendering, call `scoreTermLink()` for each candidate
  - Apply CSS classes based on tier: `.term-link-prominent`, `.term-link-subtle`
  - Attach click handler that opens `TermFeedbackPopover`
  - Enforce per-paragraph and per-answer caps in `selectTopTerms()`
  - Skip terms already explained inline in the answer text
- [ ] 6.3 Add term link tier CSS in `apple-content.css`:
  - `.term-link-prominent`: colored underline, pointer cursor, slight background on hover
  - `.term-link-subtle`: dashed underline, lighter color
  - Both scoped to `html:not(.platform-android)` initially, then enabled for both

## 7. UI — Learner Profile Page

- [ ] 7.1 Create `frontend/src/components/LearnerProfilePage.tsx`:
  - Tab/section layout: 已掌握 / 正在学习 / 系统不确定 / 标记为陌生
  - Each section is a scrollable list of concept cards
  - Each card shows: name, domain badge, mastery bar, uncertainty indicator
  - Click card → expand to detail view with evidence history
  - Manual override controls: "Mark as Known" / "Mark as Unknown" / "Clear Override"
- [ ] 7.2 Add scope controls:
  - Toggle between project / global scope views
  - Reset project profile button with confirmation dialog
  - Reset entire profile button with confirmation dialog
  - Toggle automatic learning on/off
  - Export profile button (downloads JSON)
  - Import profile button (file picker + merge)
- [ ] 7.3 Add route/navigation entry for profile page (sidebar link, command palette entry)
- [ ] 7.4 Make profile page responsive for both desktop and Android layouts

## 8. UI — Answer Feedback Bar

- [ ] 8.1 Create feedback bar component (inline in MarkdownViewer or separate):
  - Renders at bottom of answer when depth was significantly adjusted
  - Three buttons: [太基础] [正合适] [再深入一点]
  - Shows brief confirmation after click
  - Auto-hides after feedback given or after 30 seconds
- [ ] 8.2 Wire feedback to `updatePreferences()` in `preferenceTracker.ts`
- [ ] 8.3 Record feedback as answer-level metadata for analytics

## 9. Integration — QA Flow Wiring

- [ ] 9.1 In QA service (both Python and Android paths), add step between question receipt and LLM call:
  - Extract concepts from question text
  - Query mastery for relevant concepts
  - Build learner context string
  - Prepend to user message
- [ ] 9.2 After answer is rendered, extract term candidates from answer Markdown
- [ ] 9.3 For each candidate, resolve to concept (by name/alias), query mastery, compute linkScore
- [ ] 9.4 Pass scored terms to MarkdownViewer for tiered rendering
- [ ] 9.5 Record `term_impressions` for all displayed terms
- [ ] 9.6 On user interaction with term (click, feedback), record learning event + update mastery

## 10. Concept Seed Data

- [ ] 10.1 Define initial concept taxonomy covering:
  - Frontend: React, useState, useEffect, Virtual DOM, JSX, props, state, hooks, Context API, Redux, CSS-in-JS, SSR, Next.js, Vite, Webpack, Babel, TypeScript, ES6
  - Backend: FastAPI, REST API, GraphQL, WebSocket, SQL, NoSQL, Redis, JWT, OAuth, CORS, middleware, rate limiting
  - Database: SQLite, PostgreSQL, MySQL, FTS5, full-text search, indexing, B-tree, transactions, ACID, migrations, ORM
  - Android: Activity, Fragment, WebView, ActionMode, Capacitor, Gradle, APK, foreground service, SharedPreferences, ContentProvider
  - General CS: algorithm, data structure, Big O, recursion, closure, promise, async/await, dependency injection, MVC, MVVM, design pattern, refactoring
- [ ] 10.2 Set appropriate difficulty scores (0.1–0.9) for each concept
- [ ] 10.3 Set domain and concept_type for each (concept_type: "language_feature" | "framework_api" | "pattern" | "tool" | "theory" | "project_symbol")
- [ ] 10.4 Insert seed data into both Python backend (migration/init) and Android database (initTables)

## 11. Verification

- [ ] 11.1 Unit tests for `masteryEngine.ts`: verify mastery calculation, evidence deltas, uncertainty, decay, manual override, replay
- [ ] 11.2 Unit tests for `termLinkScorer.ts`: verify score calculation for known/unknown concepts, tier thresholds, caps, exploration bonus
- [ ] 11.3 Unit tests for `learnerContext.ts`: verify context block format, concept categorization, relevance filtering
- [ ] 11.4 Unit tests for `preferenceTracker.ts`: verify nudge sizes, learning rate decay, contradictory feedback handling
- [ ] 11.5 Backend tests: verify new tables created, CRUD operations, API endpoints return correct data
- [ ] 11.6 Android tests: verify new tables created in Capacitor SQLite, local provider methods work
- [ ] 11.7 Manual test Desktop: full QA flow with new user → verify cold start (all mastery=0.5) → click "I know" on a term → verify mastery updated → re-ask same topic → verify term not re-linked
- [ ] 11.8 Manual test Desktop: Learner profile page shows correct concept groups, manual override works, reset works
- [ ] 11.9 Manual test Desktop: Answer feedback bar appears after depth-adjusted answer, clicking feedback updates preferences
- [ ] 11.10 Manual test Android: same flows as 11.7–11.9 on Android device/emulator
- [ ] 11.11 Run `npm run build` in `frontend/` — no TypeScript or build errors
- [ ] 11.12 Run backend tests: `cd backend && python -m pytest tests/` — no regression
- [ ] 11.13 Verify existing QA, term, knowledge graph functionality is not broken
