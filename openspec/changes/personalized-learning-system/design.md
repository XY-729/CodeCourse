## Context

CodeCourse runs on two platforms sharing a React/TypeScript frontend:
- **Desktop**: Electron shell → Python FastAPI backend → SQLite (`workspace/app.db`)
- **Android**: Capacitor shell → `AndroidLocalProvider` (TypeScript) → Capacitor SQLite (`codecourse_mobile`)

All personalization logic must work identically on both platforms. The strategy: implement the core engine in shared TypeScript (`frontend/src/personalization/`), add API endpoints on the Python side, mirror them in the Android local provider, and keep the algorithms deterministic (no ML model dependency in Phase 1).

Existing related tables: `document_terms` (AI-extracted terms), `learning_anchors` (user "I understand this" bookmarks), `knowledge_nodes`/`knowledge_edges` (user-editable knowledge graph), `qa_records` (Q&A history). The new tables complement these — `concepts` canonicalizes what `document_terms` extracts, `learning_events` formalizes what `learning_anchors` implies, and `concept_mastery` tracks what the graph shows statically.

## Goals / Non-Goals

**Goals:**
- Concept-level knowledge tracking with explainable mastery scores
- Deterministic mastery update engine driven by user behavior events
- Adaptive term links that reflect individual user knowledge
- Dynamic learner context injection into QA prompts
- User-correctable profile with evidence traceability
- Cross-platform: identical behavior on Desktop and Android

**Non-Goals:**
- ML-based knowledge tracing (Bayesian Knowledge Tracing, DKT) — Phase 1 is rule-based only
- Concept relationship graph (prerequisite_of, related_to, often_confused) — Phase 3
- Cross-project long-term profile sync — Phase 4
- Automated exercise generation and recommendation — Phase 4
- Replacing the existing knowledge graph viewer — it stays as-is
- Changing the LLM prompt structure beyond adding `<learner_context>`

## Decisions

### Decision 1: TypeScript core engine, not Python

The mastery engine, event recorder, term link scorer, and context builder all live in `frontend/src/personalization/` as pure TypeScript.

**Why not Python backend:** The Android platform has no Python runtime. Putting logic in TypeScript means both platforms execute the same code paths. The Python backend becomes a thin storage layer for desktop; Android uses the same TS engine directly against Capacitor SQLite.

**Why not SQL-only:** Mastery update rules (different evidence deltas per event type, uncertainty calculation, exploration bonus) are algorithmic, not declarative. Keeping them in TS makes them testable and keeps the SQL layer simple.

### Decision 2: Event-sourced mastery, not direct state mutation

Every user action produces an immutable `learning_event` row. A separate `updateMastery()` function replays pending events to recompute mastery. This is not full CQRS/event sourcing — we compute current state eagerly on each event — but the event log is preserved for explainability and future replay.

**Why not just UPDATE concept_mastery directly:** Direct mutation loses the "why" behind each mastery change. The event log enables: showing users evidence trails, undoing individual events, recomputing all mastery if the algorithm changes, and measuring system accuracy.

### Decision 3: Beta-distribution-inspired evidence counting

`mastery = knownEvidence / (knownEvidence + unknownEvidence)` with initial values `knownEvidence=1, unknownEvidence=1` (equivalent to a Beta(1,1) uniform prior, giving mastery=0.5, uncertainty=0.71).

Evidence deltas:

| Event | knownEvidence Δ | unknownEvidence Δ |
|-------|----------------|-------------------|
| User clicks "I know this" | +5 | 0 |
| User clicks "I don't know this" | 0 | +5 |
| User asks "What is X?" | 0 | +3 |
| User clicks term for explanation | 0 | +1 |
| User uses term correctly in question | +1 | 0 |
| User saves learning anchor for concept | +2 | 0 |
| Model infers understanding from context | +1 | 0 |
| Model infers confusion from context | 0 | +1 |
| Manual override: set to "known" | known=100, unknown=1 |
| Manual override: set to "unknown" | known=1, unknown=100 |

**Why not a simple 0–100 score:** Evidence counts give us both mastery (the ratio) and uncertainty (inverse of sqrt(total evidence)). A single score can't express "80% sure with 2 data points" vs "80% sure with 50 data points."

**Why not full Bayesian update:** Conjugate prior updates with Beta-Binomial would be more mathematically pure, but the evidence-counting approach is simpler to explain to users ("you've seen this concept 5 times and asked about it 3 times") and produces identical mastery values.

### Decision 4: linkScore as weighted sum, not ML ranking

`linkScore = 0.50 × (1 - mastery) + 0.20 × difficulty + 0.20 × contextRelevance + 0.10 × explorationBonus`

Weights were chosen to prioritize user knowledge state (50%) over static concept properties. `explorationBonus` is a small random factor (0–0.1) that occasionally surfaces a term the system is uncertain about, preventing the "cold start lockout" problem.

**Why not a learned ranking model:** Phase 1 is rule-based. A learned model would need training data we don't have yet. The weighted sum is transparent, debuggable, and the weights can be tuned with real usage data later.

### Decision 5: Learner context as structured prompt injection, not system prompt rewrite

The QA prompt template stays fixed. A `<learner_context>` block is prepended to the user message (not the system prompt), containing only concepts relevant to the current question. This block is generated fresh per request.

**Why not modify the system prompt:** A permanently rewritten system prompt accumulates errors. A single bad inference ("user is a beginner") poisons all future answers. Per-request context blocks are ephemeral — mistakes don't persist.

**Why in the user message, not system prompt:** The system prompt contains stable teaching strategy rules. The learner context is dynamic data about this specific user and question. Semantically, it belongs with the question, not the instruction.

### Decision 6: Five new tables, minimal schema

Phase 1 uses five simple tables. No migrations on existing tables. No foreign key cascades (SQLite doesn't enforce them by default, and we handle integrity in application code).

**concepts** — canonical concept registry
**concept_mastery** — (concept_id, scope_type, scope_id) tuple is unique
**learning_events** — append-only, referenced by concept_id
**learner_preferences** — (scope_type, scope_id) tuple is unique
**term_impressions** — (concept_id, qa_record_id) tuple is unique per display instance

**Why not a single user_profile JSON column:** JSON blobs can't be queried efficiently for "which concepts does this user not know that are relevant to the current question." Normalized tables enable indexed lookups.

**Why not reuse document_terms for concept_mastery:** `document_terms` tracks which terms appear in which documents. `concept_mastery` tracks what a user knows. Different concerns, different access patterns, different lifetimes.

## Risks / Trade-offs

- **Table count growth**: Adding 5 tables to an already wide schema (20+ tables). Mitigation: these tables are independent and don't add JOIN complexity to existing queries.
- **Cold start**: New users have mastery=0.5 for all concepts. Term links will be noisy until evidence accumulates. Mitigation: exploration bonus surfaces uncertain terms; explicit "I know/don't know" buttons accelerate learning.
- **Scope granularity**: Three scope types (session, project, global) add complexity. Mitigation: query precedence is simple (session > project > global), and most users will only have project-scoped mastery initially.
- **Evidence quality**: Not all behaviors are equally informative. Clicking a term link might mean "I'm curious" rather than "I don't know." Mitigation: explicit feedback has 5× the weight of implicit signals.
- **Android SQLite differences**: Capacitor SQLite has slightly different API than Python's sqlite3. Mitigation: the abstracted `MobileDatabase` class already handles these differences; new tables follow the same pattern as existing ones.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React/TS)             │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │     frontend/src/personalization/         │   │
│  │                                          │   │
│  │  types.ts        — all interfaces        │   │
│  │  masteryEngine.ts — updateMastery()      │   │
│  │  eventRecorder.ts — recordEvent()        │   │
│  │  termLinkScorer.ts — scoreTermLink()     │   │
│  │  learnerContext.ts — buildContext()      │   │
│  │  preferenceTracker.ts — updatePrefs()    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Components:                                     │
│  ┌──────────────────────────────────────────┐   │
│  │  MarkdownViewer.tsx  (term link tiers)   │   │
│  │  ExplainPanel.tsx    (feedback buttons)  │   │
│  │  TermFeedbackPopover.tsx (new)           │   │
│  │  LearnerProfilePage.tsx  (new)           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  API:                                            │
│  ┌──────────────────────────────────────────┐   │
│  │  client.ts  (new API functions + types)  │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Platform:                                       │
│  ┌──────────────────────────────────────────┐   │
│  │  AndroidLocalProvider  (mirrors API)     │   │
│  │  MobileDatabase        (new tables)      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                              ▼
┌──────────────────┐    ┌─────────────────────────┐
│  Python Backend   │    │  Android (Capacitor)     │
│  (Desktop only)   │    │                          │
│                   │    │  Same TS engine           │
│  Thin API layer:  │    │  Direct SQLite via        │
│  - CRUD concepts  │    │  Capacitor plugin         │
│  - CRUD mastery   │    │                          │
│  - CRUD events    │    │                          │
│  - CRUD prefs     │    │                          │
│  - CRUD impressions│   │                          │
│                   │    │                          │
│  storage.py       │    │                          │
│  qa_service.py    │    │                          │
│  term_service.py  │    │                          │
└──────────────────┘    └─────────────────────────┘
         │                              │
         ▼                              ▼
┌──────────────────┐    ┌─────────────────────────┐
│  SQLite (app.db) │    │  SQLite (codecourse_mobile)│
│  workspace/      │    │  (encrypted)              │
└──────────────────┘    └─────────────────────────┘
```

### Data flow for a QA round:

```
User asks question
    ↓
Extract concepts from question text
    ↓
Query concept_mastery for these concepts (project > global scope)
    ↓
buildLearnerContext() → <learner_context> block
    ↓
Inject into QA prompt + send to LLM
    ↓
Render answer Markdown
    ↓
Extract term candidates from answer
    ↓
scoreTermLink() for each candidate
    ↓
Render terms at appropriate tier (link / subtle / hidden)
    ↓
User interacts (clicks, marks known/unknown)
    ↓
recordEvent() → INSERT into learning_events
    ↓
updateMastery() → UPDATE concept_mastery
    ↓
(Optional) updatePreferences() from answer feedback
```
