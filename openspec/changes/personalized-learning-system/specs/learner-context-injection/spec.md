## ADDED Requirements

### Requirement: Dynamic learner context block
Before each QA request, the system SHALL generate a `<learner_context>` XML block containing concepts relevant to the current question, formatted for injection into the LLM prompt.

#### Scenario: Context block structure
- **WHEN** `buildLearnerContext(projectId, questionText)` is called
- **THEN** it returns a string in the format:
```
<learner_context>
当前学习目标：
- [active learning goals for this project]

回答偏好：
- [principle-first / example-first / code-first]
- [other active preferences]

本轮相关已掌握概念：
- React (mastery: 0.93)
- TypeScript (mastery: 0.88)

本轮相关可能陌生概念：
- FTS5 (mastery: 0.18)
- 倒排索引 (mastery: 0.22)

本轮相关不确定概念：
- 知识追踪 (mastery: 0.52, uncertainty: 0.45)
</learner_context>
```

#### Scenario: Only relevant concepts included
- **WHEN** a user asks about "FTS5 ranking in SQLite"
- **AND** the user has mastery data for 200 concepts
- **THEN** only concepts related to FTS5, SQLite, full-text search, and ranking are included
- **AND** unrelated concepts (e.g., "React hooks", "CSS Grid") are excluded

#### Scenario: Empty context for new users
- **WHEN** a user has no mastery data for any concept in the question
- **THEN** the `<learner_context>` block is generated with empty concept lists
- **AND** a note is included: "No prior knowledge data available for concepts in this question."

### Requirement: Concept extraction from question
The system SHALL extract candidate concepts from the user's question text before building the learner context.

#### Scenario: Extract from question text
- **WHEN** a user asks "How does FTS5's bm25 ranking compare to PostgreSQL's tsvector?"
- **THEN** the system extracts candidate concepts: ["FTS5", "bm25", "ranking", "PostgreSQL", "tsvector", "full-text search"]
- **AND** resolves them against the `concepts` table by canonical name and aliases

#### Scenario: Prefix matching for compound terms
- **WHEN** a question contains "Android WebView ActionMode"
- **THEN** the system checks for concepts matching the full term, then sub-terms
- **AND** resolves "Android WebView" and "ActionMode" as separate concepts if both exist

### Requirement: Preference-aware context
The learner context SHALL include the user's active learning preferences to guide the LLM's answer style.

#### Scenario: Principle-first preference reflected
- **WHEN** the user's `learner_preferences` has `explanation_style = "principle-first"`
- **THEN** the context block includes: "回答偏好：先解释根因，再给修改步骤"

#### Scenario: Code ratio preference reflected
- **WHEN** the user's `code_ratio > 0.6`
- **THEN** the context block includes: "回答偏好：倾向于更多代码示例"

#### Scenario: Prerequisite detail for new domains
- **WHEN** the user's `prerequisite_detail > 0.5`
- **AND** the question involves concepts with mastery < 0.3
- **THEN** the context block includes: "回答偏好：对于不熟悉的领域，需要补充前置背景知识"

### Requirement: Context injection point
The learner context SHALL be injected into the user message, not the system prompt.

#### Scenario: Context prepended to user message
- **WHEN** the QA service constructs the prompt for an LLM call
- **THEN** the system prompt remains unchanged (stable teaching strategy)
- **AND** the `<learner_context>` block is prepended to the user's question text
- **AND** the final user message format is: `<learner_context>\n...\n</learner_context>\n\n{user question}`

### Requirement: Context caching awareness
The learner context SHALL be designed to avoid unnecessary cache breaks when the same concept set appears.

#### Scenario: Consistent ordering
- **WHEN** multiple concepts appear in the same category (e.g., "已掌握概念")
- **THEN** they are sorted alphabetically by canonical name
- **AND** the output is deterministic for the same input state
