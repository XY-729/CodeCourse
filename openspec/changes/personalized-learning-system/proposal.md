## Why

CodeCourse currently treats every user the same: same term links, same answer depth, same prerequisite explanations. The existing `document_terms`, `learning_anchors`, and `knowledge_graph` tables capture what content exists and what users bookmark, but they don't model what a specific user *knows* or *doesn't know*.

This means:
- A user familiar with React still sees "React" linked as a term to explain
- A user who doesn't know FTS5 gets no extra context when FTS5 is central to an answer
- Answer depth never adapts — known concepts are re-explained, unknown prerequisites are skipped
- There's no feedback loop: the system never learns from user behavior

The goal is to build an explainable, correctable personal concept knowledge map that drives term linking, answer depth, and prerequisite supplementation — making CodeCourse "get better the more you use it."

## What Changes

### New Data Layer (5 tables)

- **`concepts`** — canonical concept definitions (name, domain, type, difficulty, aliases)
- **`concept_mastery`** — per-user, per-concept, per-scope mastery state (known/unknown evidence counts → mastery probability + uncertainty)
- **`learning_events`** — immutable event log of every user action that reveals knowledge state
- **`learner_preferences`** — per-scope answer style preferences (depth, code ratio, example vs principle, prerequisite detail)
- **`term_impressions`** — record of which terms were shown, clicked, or received feedback

### Mastery Update Engine (pure rules, deterministic)

- Bayesian-style probability: `mastery = knownEvidence / (knownEvidence + unknownEvidence)`
- Uncertainty: `uncertainty = 1 / sqrt(knownEvidence + unknownEvidence)`
- Different behaviors map to different evidence deltas (explicit feedback = ±5, strong implicit = ±3, weak implicit = ±1)
- Manual override sets mastery directly with uncertainty = 0
- Evidence decay for long-unseen concepts (uncertainty increases, mastery unchanged)

### Personalized Term Links

- `linkScore = 0.50 × unfamiliarity + 0.20 × difficulty + 0.20 × contextRelevance + 0.10 × explorationBonus`
- Three display tiers: prominent link (≥0.72), subtle hint (0.55–0.72), no link (<0.55)
- Hard caps: max 1–2 per paragraph, 4–6 per 1000 chars, first occurrence only

### Dynamic Learner Context Injection

- Generate `<learner_context>` block per QA round with: current goals, preferences, known concepts, likely-unfamiliar concepts, uncertain concepts
- Only inject concepts relevant to the current question — never dump the full profile

### UI Changes

- Term card enhancement: [I know this] [I don't know this] [Explain more] buttons on term hover/click
- Lightweight answer feedback (only when depth was adjusted): [Too basic] [Just right] [Go deeper]
- Learner profile page: view/edit mastery per concept, see evidence history, reset by scope

### Guardrails

- Single model inference caps at ±1 evidence; only explicit user action grants ±5
- Priority: manual override > exercise results > explicit questions > system inference > click behavior
- Never infer personality or intelligence — only concept familiarity and style preferences
- Long-unseen concepts get higher uncertainty but unchanged mastery

### Platform: Shared TypeScript Core

- All personalization logic lives in `frontend/src/personalization/` (shared between Desktop and Android)
- Backend adds API endpoints for CRUD on new tables (Desktop: Python/FastAPI, Android: local SQLite via Capacitor)
- Both platforms share identical table schemas and algorithms

## Capabilities

### New Capabilities
- `concept-mastery-engine`: Concept-level knowledge tracking with Bayesian evidence accumulation
- `learning-events`: Immutable event log driving mastery updates, enabling explainability and replay
- `personalized-term-links`: Adaptive term display based on per-user mastery + concept difficulty + context
- `learner-context-injection`: Per-question dynamic learner context block in QA prompts
- `learner-profile-ui`: Viewable, editable, resettable learner profile page
- `learner-preferences`: Per-scope answer style preferences with slow auto-update and manual control

### Modified Capabilities
- `qa-service`: Prompt construction now includes learner_context block
- `term-service`: Term extraction and display now consults mastery state
- `markdown-viewer`: Term link rendering uses linkScore tiers

## Impact

### New Files
- `frontend/src/personalization/masteryEngine.ts` — core mastery update algorithm
- `frontend/src/personalization/eventRecorder.ts` — learning event creation and persistence
- `frontend/src/personalization/termLinkScorer.ts` — linkScore computation
- `frontend/src/personalization/learnerContext.ts` — dynamic context block generation
- `frontend/src/personalization/preferenceTracker.ts` — preference update logic
- `frontend/src/personalization/types.ts` — TypeScript interfaces
- `frontend/src/components/LearnerProfilePage.tsx` — profile UI
- `frontend/src/components/TermFeedbackPopover.tsx` — term card enhancement

### Modified Files
- `backend/app/services/storage.py` — add 5 new tables to schema and migrations
- `backend/app/api/` — new endpoints or extend existing ones for concepts, mastery, events, preferences, impressions
- `backend/app/services/qa_service.py` — inject learner_context into prompts
- `backend/app/services/term_service.py` — consult mastery for term display decisions
- `frontend/src/api/client.ts` — add TypeScript types and API functions for new endpoints
- `frontend/src/platform/android/database.ts` — mirror new tables in mobile SQLite
- `frontend/src/platform/android/localProvider.ts` — implement new API methods locally
- `frontend/src/components/MarkdownViewer.tsx` — integrate linkScore-based term rendering
- `frontend/src/components/ExplainPanel.tsx` — add feedback buttons

### Not Touched
- Electron shell (`electron/`)
- Android Java code (`android/`)
- Code indexing, AST chunking, Tree-sitter
- Course generation
- Knowledge graph viewer (separate feature, may integrate later)
