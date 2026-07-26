## ADDED Requirements

### Requirement: Learning preference storage
The system SHALL store per-scope learning preferences in the `learner_preferences` table, separate from concept mastery data.

#### Scenario: Default preferences
- **WHEN** a new user starts using the system
- **THEN** default preferences are:
  - `answer_depth = 0.5` (moderate)
  - `code_ratio = 0.5` (balanced)
  - `example_preference = 0.5` (balanced)
  - `principle_preference = 0.5` (balanced)
  - `prerequisite_detail = 0.5` (moderate)
  - `terminology_density = 0.5` (moderate)

#### Scenario: Preferences scoped like mastery
- **WHEN** `learner_preferences` is queried
- **THEN** the lookup follows the same scope precedence as concept mastery: session → project → global
- **AND** missing scopes fall back to the next broader scope

### Requirement: Slow preference auto-update
Preferences SHALL update slowly based on user feedback, with safeguards against overfitting.

#### Scenario: Single feedback causes small adjustment
- **WHEN** a user clicks [再深入一点] once
- **THEN** `answer_depth` increases by at most 0.05
- **AND** it takes multiple consistent feedbacks to reach a significant preference shift

#### Scenario: Contradictory feedback cancels out
- **WHEN** a user alternately clicks [太基础] and [再深入一点] across sessions
- **THEN** `answer_depth` oscillates slightly but stays near the center
- **AND** the system does NOT conclude anything from contradictory signals

#### Scenario: Preference update rate decays over time
- **WHEN** a user has provided 20+ feedback events
- **THEN** each subsequent feedback has a smaller effect (learning rate decay)
- **AND** preferences stabilize rather than continuing to drift

### Requirement: Explanation style preference
The system SHALL track the user's preferred explanation order: principle-first, example-first, or code-first.

#### Scenario: Principle-first detected
- **WHEN** a user consistently asks "why" questions before "how" questions
- **AND** gives positive feedback to principle-heavy answers
- **THEN** `principle_preference` gradually increases

#### Scenario: Code-first detected
- **WHEN** a user consistently gives positive feedback to code-heavy answers
- **AND** asks for code examples explicitly
- **THEN** `code_ratio` gradually increases

### Requirement: Preference independence from mastery
Preferences and mastery SHALL be updated independently. A user's preference for detailed explanations does not imply low mastery, and high mastery does not imply preference for terse answers.

#### Scenario: Expert who likes detailed explanations
- **WHEN** a user has high mastery across many concepts
- **AND** consistently requests detailed explanations
- **THEN** `answer_depth` remains high
- **AND** mastery values are unaffected by the depth preference

#### Scenario: Beginner who prefers code-first
- **WHEN** a user has low mastery across many concepts
- **AND** prefers to see code before explanations
- **THEN** `code_ratio` increases
- **AND** the system still provides prerequisite context for unfamiliar concepts (driven by mastery, not preference)

### Requirement: Manual preference control
All preferences SHALL be manually adjustable in the learner profile page.

#### Scenario: User sets answer depth directly
- **WHEN** a user adjusts the "Answer Depth" slider in the profile page
- **THEN** `answer_depth` is set to the chosen value
- **AND** automatic updates continue from this new baseline
- **AND** the manual adjustment is recorded as an event for traceability

#### Scenario: User resets preferences to defaults
- **WHEN** a user clicks "Reset preferences to defaults"
- **THEN** all preference values return to 0.5
- **AND** all preference update history for that scope is cleared
