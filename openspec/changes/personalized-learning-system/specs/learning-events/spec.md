## ADDED Requirements

### Requirement: Immutable learning event log
The system SHALL record every user action that reveals knowledge state as an immutable row in the `learning_events` table.

#### Scenario: Event recorded with full context
- **WHEN** a user clicks "I don't know this" on a term
- **THEN** a `learning_event` row is inserted with:
  - `concept_id` referencing the term's concept
  - `event_type = "marked_unknown"`
  - `direction = "unknown"`
  - `strength = 1.0`
  - `evidence_text` containing the surrounding context (question text, answer excerpt)
  - `session_id` linking to the current QA session
  - `qa_record_id` linking to the specific QA record
  - `created_at` timestamp

#### Scenario: Events are append-only
- **WHEN** a learning event is recorded
- **THEN** it cannot be modified (no UPDATE on learning_events after insert)
- **AND** it can only be marked as "voided" via a separate void flag, preserving the original record

### Requirement: Event type taxonomy
The system SHALL support a fixed set of event types, each with predefined direction and default strength.

#### Scenario: Supported event types
- **WHEN** the system processes a learning event
- **THEN** the `event_type` must be one of:
  - `asked_definition` (direction: unknown, default strength: 0.75)
  - `asked_clarification` (direction: unknown, default strength: 0.6)
  - `used_correctly` (direction: known, default strength: 0.6)
  - `opened_explanation` (direction: unknown, default strength: 0.5)
  - `marked_known` (direction: known, default strength: 1.0)
  - `marked_unknown` (direction: unknown, default strength: 1.0)
  - `completed_exercise` (direction: known, default strength: 0.8)
  - `saved_learning_anchor` (direction: known, default strength: 0.7)
  - `manual_override` (direction: known or unknown, default strength: 1.0)

### Requirement: Event-to-mastery pipeline
After a learning event is recorded, `updateMastery()` SHALL be called to recompute the affected concept's mastery state.

#### Scenario: Event triggers mastery update
- **WHEN** `recordEvent()` is called with a valid learning event
- **THEN** the event is inserted into `learning_events`
- **AND** `updateMastery(conceptId, scopeType, scopeId)` is called immediately after
- **AND** the corresponding `concept_mastery` row is updated with new evidence counts, mastery, uncertainty, and `last_seen_at`

#### Scenario: Multiple events in same session
- **WHEN** a user triggers 3 learning events for the same concept in one session
- **THEN** each event is recorded separately
- **AND** mastery is recalculated after each event
- **AND** the cumulative evidence reflects all 3 events

### Requirement: Event replay capability
The system SHALL support recomputing all mastery states from the event log, enabling algorithm changes to take effect retroactively.

#### Scenario: Replay all events for a concept
- **WHEN** `replayMastery(conceptId, scopeType, scopeId)` is called
- **THEN** the concept's evidence counts are reset to (1, 1)
- **AND** all non-voided events for that concept are re-applied in chronological order
- **AND** the final mastery and uncertainty are recomputed

#### Scenario: Replay all events for a user
- **WHEN** `replayAllMastery()` is called (e.g., after an algorithm change)
- **THEN** all concept_mastery rows are reset and replayed from the event log
- **AND** manual overrides are preserved and applied last

### Requirement: Event attribution
Each learning event SHALL include enough context to explain the system's reasoning to the user.

#### Scenario: Evidence trail for a mastery state
- **WHEN** a user views their learner profile
- **AND** looks at why a concept has mastery 0.8
- **THEN** the system can list the contributing events:
  - "You marked this as known on 2026-07-20"
  - "You used this term correctly in a question on 2026-07-22"
  - "You saved a learning anchor for this on 2026-07-25"
