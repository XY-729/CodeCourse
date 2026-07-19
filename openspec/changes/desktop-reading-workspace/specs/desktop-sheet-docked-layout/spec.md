## ADDED Requirements

### Requirement: Large sheets dock as workspace column
Large desktop panels (GenerationSheet) SHALL render as an in-flow right column inside `.reader-workspace` instead of a `position: fixed` overlay.

#### Scenario: Opening a large sheet shrinks the reading area
- **WHEN** the user opens GenerationSheet on desktop
- **THEN** `.reader-workspace` becomes a two-column grid: reading area + sheet panel
- **AND** the reading area width shrinks by `var(--sheet-width)`

#### Scenario: Reading area scrollbar moves with the content edge
- **WHEN** a sheet panel is open
- **THEN** the document scrollbar is at the right edge of the reading column (not hidden behind the panel)

#### Scenario: Closing a sheet restores full-width reading
- **WHEN** the user closes the docked sheet
- **THEN** `.reader-workspace` returns to a single-column layout

### Requirement: scrollbar-gutter stable
Scroll containers in the desktop reading workspace SHALL use `scrollbar-gutter: stable` to prevent horizontal layout shift when scrollbars appear or disappear.

#### Scenario: Content does not jump when scrollbar appears
- **WHEN** a document's content height exceeds the viewport and a scrollbar appears
- **THEN** the content width does not shift horizontally

### Requirement: Existing overlay behavior preserved for non-reading contexts
Small overlays (notifications, tooltips, context menus) SHALL continue to use `position: fixed` / `position: absolute` as before. Only large workspace panels are affected.

#### Scenario: Small tooltips remain as overlays
- **WHEN** a tooltip or context menu appears
- **THEN** it renders as a positioned overlay, not a layout column
