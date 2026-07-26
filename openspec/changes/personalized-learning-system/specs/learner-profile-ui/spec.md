## ADDED Requirements

### Requirement: Learner profile page
The system SHALL provide a dedicated learner profile page where users can view and manage their concept mastery, preferences, and evidence history.

#### Scenario: Profile page shows concept categories
- **WHEN** a user opens the learner profile page
- **THEN** concepts are grouped into tabs or sections:
  - "已掌握" (mastery > 0.8, uncertainty < 0.2)
  - "正在学习" (mastery 0.4–0.8 or uncertainty > 0.3)
  - "系统不确定" (uncertainty > 0.4, any mastery)
  - "标记为陌生" (manual_status = "unknown" or mastery < 0.3 with high confidence)
- **AND** each group shows the concept count

#### Scenario: Concept detail view
- **WHEN** a user clicks on a concept in the profile
- **THEN** the system shows:
  - Display name and domain
  - Current mastery (as a percentage bar)
  - Uncertainty level
  - Evidence count (known vs unknown)
  - List of contributing events with dates and descriptions
  - Manual override status (if any)
  - Last seen date

#### Scenario: Manual status change
- **WHEN** a user changes a concept's status to "known" via the profile
- **THEN** a `manual_override` learning event is recorded
- **AND** the concept's mastery is set to 0.99, uncertainty to 0.01
- **AND** the manual status is displayed on the concept

#### Scenario: Clear manual override
- **WHEN** a user clears a manual override on a concept
- **THEN** the concept reverts to evidence-based mastery calculation
- **AND** all past events are replayed to recompute the natural mastery state

### Requirement: Term feedback in answer view
The system SHALL provide inline feedback buttons when a user interacts with a term link in an answer.

#### Scenario: Term popover with feedback options
- **WHEN** a user clicks or hovers on a term link in a Markdown answer
- **THEN** a popover appears showing:
  - The term's display name
  - A brief definition (1–2 sentences)
  - A "[详细解释]" button that opens the full ExplainPanel
  - An "[我认识]" button
  - An "[我不认识]" button
  - A "[以后少提示这类词]" button

#### Scenario: "I know this" button pressed
- **WHEN** a user clicks "[我认识]" on a term popover
- **THEN** the popover shows a brief confirmation ("已记录")
- **AND** a `marked_known` learning event is recorded
- **AND** the term link styling changes to indicate "known" status

#### Scenario: "I don't know this" button pressed
- **WHEN** a user clicks "[我不认识]" on a term popover
- **THEN** the popover expands to show the full explanation
- **AND** a `marked_unknown` learning event is recorded

### Requirement: Lightweight answer feedback
The system SHALL display answer depth feedback options at the end of an answer when the system significantly adjusted the explanation depth.

#### Scenario: Feedback shown after depth adjustment
- **WHEN** an answer was generated with significantly adjusted depth (many concepts at mastery extremes)
- **THEN** a subtle feedback bar appears at the bottom of the answer:
  - "这次解释是否合适？"
  - [太基础] [正合适] [再深入一点]

#### Scenario: "Too basic" feedback
- **WHEN** a user clicks [太基础]
- **THEN** the user's `answer_depth` preference is nudged higher (e.g., +0.1, clamped to [0, 1])
- **AND** the `prerequisite_detail` preference is nudged lower (−0.05)
- **AND** the feedback bar shows "已记录，下次会调整"

#### Scenario: "Go deeper" feedback
- **WHEN** a user clicks [再深入一点]
- **THEN** the user's `answer_depth` preference is nudged higher
- **AND** the `prerequisite_detail` preference is nudged higher
- **AND** the feedback bar shows "已记录，下次会调整"

#### Scenario: Feedback not shown for standard answers
- **WHEN** an answer was generated with no significant depth adjustments
- **THEN** the feedback bar is NOT displayed
- **AND** the user is not prompted for feedback

### Requirement: Profile scope controls
The user SHALL be able to manage their learning profile at different scope levels.

#### Scenario: Reset project-level profile
- **WHEN** a user chooses to reset the project-level learning profile
- **THEN** all `concept_mastery` rows with `scope_type = "project"` and matching `scope_id` are deleted
- **AND** all `learning_events` for that project scope are voided
- **AND** global-level mastery remains unchanged

#### Scenario: Reset entire profile
- **WHEN** a user chooses to reset their entire learning profile
- **THEN** all `concept_mastery` rows are deleted
- **AND** all `learning_events` are voided
- **AND** all `learner_preferences` are reset to defaults
- **AND** a confirmation dialog is shown before execution

#### Scenario: Toggle automatic learning
- **WHEN** a user disables automatic learning
- **THEN** no new `learning_events` are created from implicit behaviors (clicks, views, model inferences)
- **AND** explicit actions ([我认识], [我不认识], manual overrides) still work
- **AND** existing mastery data is preserved

### Requirement: Profile export and import
The user SHALL be able to export and import their learning profile for backup or cross-device transfer.

#### Scenario: Export profile as JSON
- **WHEN** a user exports their profile
- **THEN** a JSON file is generated containing all `concept_mastery`, `learner_preferences`, and `learning_events` (excluding voided)
- **AND** the file includes a version field for future compatibility

#### Scenario: Import profile
- **WHEN** a user imports a previously exported profile JSON
- **THEN** existing mastery and preference data is merged (not replaced)
- **AND** manual overrides in the import take precedence
- **AND** events from the import are appended with their original timestamps
