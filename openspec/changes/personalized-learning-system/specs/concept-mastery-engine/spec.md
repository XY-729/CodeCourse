## ADDED Requirements

### Requirement: Concept registry
The system SHALL maintain a canonical concept registry (`concepts` table) with unique canonical names, display names, domain categorization, concept type, aliases, and a static difficulty score.

#### Scenario: Concept created with required fields
- **WHEN** a new concept is registered
- **THEN** it has a unique `canonical_name`, `display_name`, `domain`, `concept_type`, and `difficulty` (0–1)
- **AND** `aliases_json` stores alternative names as a JSON array of strings

#### Scenario: Concept lookup by alias
- **WHEN** a term "HOC" appears in content
- **AND** the concepts table has "higher-order-component" with alias "HOC"
- **THEN** the system resolves "HOC" to the canonical concept "higher-order-component"

#### Scenario: Concept difficulty is static
- **WHEN** a concept is created
- **THEN** its `difficulty` value is set based on general programming education norms (e.g., "variable" = 0.1, "React" = 0.3, "closure" = 0.5, "dependency injection" = 0.6, "MVCC" = 0.8)
- **AND** difficulty does not change based on any individual user's interactions

### Requirement: Concept mastery per scope
The system SHALL track each user's mastery of each concept at three scope levels: `global`, `project`, and `session`. The `concept_mastery` table stores known/unknown evidence counts, computed mastery probability, uncertainty, and optional manual override status.

#### Scenario: Initial mastery state
- **WHEN** a concept is first encountered by a user
- **THEN** `known_evidence = 1`, `unknown_evidence = 1`
- **AND** `mastery = 0.5`, `uncertainty ≈ 0.71`

#### Scenario: Mastery computed from evidence ratio
- **WHEN** a concept has `known_evidence = 11` and `unknown_evidence = 1`
- **THEN** `mastery = 11 / (11 + 1) = 0.917`

#### Scenario: Uncertainty decreases with more evidence
- **WHEN** a concept has `known_evidence = 1` and `unknown_evidence = 1` (2 total)
- **THEN** `uncertainty = 1 / sqrt(2) ≈ 0.71`
- **WHEN** the same concept later has `known_evidence = 50` and `unknown_evidence = 10` (60 total)
- **THEN** `uncertainty = 1 / sqrt(60) ≈ 0.13`

#### Scenario: Manual override sets mastery directly
- **WHEN** a user manually marks a concept as "known" in the profile UI
- **THEN** `manual_status = "known"`, `mastery = 0.99`, `uncertainty = 0.01`, `known_evidence = 100`, `unknown_evidence = 1`

#### Scenario: Manual override blocks automatic updates
- **WHEN** a concept has `manual_status = "known"` or `"unknown"`
- **THEN** automatic evidence accumulation from events is skipped
- **AND** only another manual override or "clear manual status" action can resume automatic updates

#### Scenario: Scope-based lookup precedence
- **WHEN** querying mastery for a concept
- **THEN** the system checks `session` scope first, then `project` scope, then `global` scope
- **AND** returns the first match found

### Requirement: Deterministic mastery update
The `updateMastery()` function SHALL accept a learning event and update the corresponding `concept_mastery` row using fixed evidence deltas. No ML model is involved.

#### Scenario: Explicit "I know" feedback
- **WHEN** a learning event of type `marked_known` with strength 1.0 is processed
- **THEN** `known_evidence` increases by 5
- **AND** `mastery` and `uncertainty` are recomputed

#### Scenario: Explicit "I don't know" feedback
- **WHEN** a learning event of type `marked_unknown` with strength 1.0 is processed
- **THEN** `unknown_evidence` increases by 5

#### Scenario: User asks for definition
- **WHEN** a learning event of type `asked_definition` with strength 0.75 is processed
- **THEN** `unknown_evidence` increases by 3

#### Scenario: User clicks term for explanation
- **WHEN** a learning event of type `opened_explanation` with strength 0.5 is processed
- **THEN** `unknown_evidence` increases by 1

#### Scenario: User uses term correctly
- **WHEN** a learning event of type `used_correctly` with strength 0.6 is processed
- **THEN** `known_evidence` increases by 1

#### Scenario: Model-inferred evidence is capped
- **WHEN** any event with `direction = "known"` or `"unknown"` has a non-user source
- **THEN** the evidence delta SHALL NOT exceed ±1
- **AND** only explicit user actions (clicks, manual overrides) can produce deltas ≥ 3

#### Scenario: Learning anchor saved
- **WHEN** a user saves a learning anchor (understanding milestone) linked to a concept
- **THEN** `known_evidence` increases by 2

### Requirement: Evidence decay for stale concepts
Concepts not encountered for an extended period SHALL have increased uncertainty but unchanged mastery.

#### Scenario: Concept not seen for 30 days
- **WHEN** a concept's `last_seen_at` is more than 30 days ago
- **AND** the mastery is queried
- **THEN** `uncertainty` is multiplied by a decay factor (e.g., `1 + 0.1 × floor(days_since / 30)`)
- **AND** `mastery` remains unchanged
