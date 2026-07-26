## ADDED Requirements

### Requirement: Term link scoring
The system SHALL compute a `linkScore` for each candidate term in an answer, combining user unfamiliarity, concept difficulty, context relevance, and an exploration bonus.

#### Scenario: linkScore formula
- **WHEN** computing whether to display a term link
- **THEN** `linkScore = 0.50 × (1 - mastery) + 0.20 × difficulty + 0.20 × contextRelevance + 0.10 × explorationBonus`
- **AND** all values are normalized to [0, 1]

#### Scenario: Known concept gets low score
- **WHEN** a user has `mastery = 0.93` for "React"
- **AND** the concept difficulty is 0.3
- **AND** context relevance is 0.5
- **AND** exploration bonus is 0.0
- **THEN** `linkScore = 0.50 × 0.07 + 0.20 × 0.3 + 0.20 × 0.5 + 0.10 × 0.0 = 0.035 + 0.06 + 0.10 = 0.195`
- **AND** the term is NOT displayed as a link

#### Scenario: Unknown concept gets high score
- **WHEN** a user has `mastery = 0.18` for "FTS5"
- **AND** the concept difficulty is 0.6
- **AND** context relevance is 0.9 (central to the answer)
- **THEN** `linkScore = 0.50 × 0.82 + 0.20 × 0.6 + 0.20 × 0.9 + 0.10 × 0.05 = 0.41 + 0.12 + 0.18 + 0.005 = 0.715`
- **AND** the term is displayed as a subtle hint (0.55–0.72 tier)

### Requirement: Three-tier display
Term links SHALL be rendered at one of three tiers based on linkScore thresholds.

#### Scenario: Prominent term link (score ≥ 0.72)
- **WHEN** a term's linkScore ≥ 0.72
- **THEN** it is rendered as a clearly visible link with underline and distinct color
- **AND** hovering/clicking opens the full term explanation panel

#### Scenario: Subtle term hint (0.55 ≤ score < 0.72)
- **WHEN** a term's linkScore is between 0.55 and 0.72
- **THEN** it is rendered with a light dashed underline
- **AND** hovering reveals a brief definition tooltip
- **AND** clicking opens the full term explanation panel

#### Scenario: No link (score < 0.55)
- **WHEN** a term's linkScore < 0.55
- **THEN** the term is rendered as plain text
- **AND** no interaction is attached

### Requirement: Display caps
The system SHALL enforce limits on term link density to prevent overwhelming the user.

#### Scenario: Maximum terms per paragraph
- **WHEN** a paragraph has more than 2 candidate terms with linkScore ≥ 0.55
- **THEN** only the top 2 by linkScore are displayed as links
- **AND** the rest are rendered as plain text

#### Scenario: Maximum terms per answer
- **WHEN** an answer has more than 6 candidate terms with linkScore ≥ 0.55 per 1000 characters
- **THEN** only the top-scoring terms are displayed, respecting the per-1000-char density limit

#### Scenario: First occurrence only
- **WHEN** the same concept appears multiple times in an answer
- **THEN** only the first occurrence is linked
- **AND** subsequent occurrences are rendered as plain text

### Requirement: Override rules
Hard rules SHALL override the linkScore calculation in specific situations.

#### Scenario: Explicitly asked concept always linked
- **WHEN** the user's current question explicitly mentions a concept
- **THEN** that concept is always displayed as a prominent link (score forced to 1.0)
- **REGARDLESS OF** the user's mastery level

#### Scenario: Manually marked "known" concepts are suppressed
- **WHEN** a user has manually marked a concept as `known`
- **THEN** it is NOT displayed as a term link
- **UNLESS** the user's current question explicitly asks about it

#### Scenario: Manually marked "unknown" concepts are boosted
- **WHEN** a user has manually marked a concept as `unknown`
- **THEN** it is always displayed as at least a subtle hint (score floored at 0.55)

#### Scenario: Already explained in body text
- **WHEN** the answer Markdown already contains a substantial inline explanation of a concept
- **THEN** a separate term link is NOT generated for that concept

### Requirement: Exploration bonus
The system SHALL occasionally surface terms with uncertain mastery state to gather feedback and prevent cold-start lockout.

#### Scenario: Exploration surfaces uncertain term
- **WHEN** a concept has `uncertainty > 0.3` and `mastery` between 0.4 and 0.6
- **AND** the concept hasn't been shown to this user in the last 5 QA rounds
- **THEN** `explorationBonus` is set to a random value in [0.05, 0.10]
- **AND** the term may cross the display threshold if other factors are favorable

### Requirement: Term impression tracking
Every term display decision SHALL be recorded in the `term_impressions` table for later analysis.

#### Scenario: Term displayed and clicked
- **WHEN** a term is displayed as a link
- **THEN** a `term_impressions` row is created with `was_displayed = 1`
- **WHEN** the user clicks the term link
- **THEN** `was_opened = 1` is set

#### Scenario: Term displayed and marked known
- **WHEN** a user clicks "I know this" on a displayed term
- **THEN** the `feedback` field is set to `"known"`
- **AND** a corresponding `learning_event` of type `marked_known` is created
