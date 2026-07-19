## ADDED Requirements

### Requirement: Monaco code viewer Ctrl+scroll zoom
The MonacoCodeViewer on desktop SHALL respond to Ctrl+mouseWheel by scaling the editor font size.

#### Scenario: Ctrl+scroll up increases font size
- **WHEN** the user holds Ctrl and scrolls up inside the Monaco editor area
- **THEN** the editor font size increases by one step (e.g., +1px)

#### Scenario: Ctrl+scroll down decreases font size
- **WHEN** the user holds Ctrl and scrolls down inside the Monaco editor area
- **THEN** the editor font size decreases by one step (e.g., -1px)

#### Scenario: Scroll without Ctrl does not zoom
- **WHEN** the user scrolls without holding Ctrl inside the Monaco editor
- **THEN** the editor scrolls content normally without changing font size

### Requirement: Markdown viewer Ctrl+scroll zoom
The MarkdownViewer on desktop SHALL respond to Ctrl+mouseWheel by scaling the document font size.

#### Scenario: Ctrl+scroll in Markdown viewer changes font size
- **WHEN** the user holds Ctrl and scrolls inside the Markdown reading area
- **THEN** the reading area font size changes and the event is prevented from propagating to the container

#### Scenario: Scroll without Ctrl in Markdown viewer scrolls normally
- **WHEN** the user scrolls without holding Ctrl inside the Markdown area
- **THEN** the content scrolls normally without changing font size

### Requirement: Font size persistence
Desktop font size preferences SHALL persist across sessions via localStorage.

#### Scenario: Font size survives page reload
- **WHEN** the user changes the code or document font size
- **AND** reloads the page
- **THEN** the previously selected font size is restored

### Requirement: CSS variables for reader typography
Desktop reader styles SHALL use CSS variables `--reader-font-size`, `--reader-code-font-size`, `--reader-line-height` scoped to `html:not(.platform-android)`.

#### Scenario: Changing --reader-font-size updates all body text
- **WHEN** `--reader-font-size` is changed on `.markdown-body`
- **THEN** all body text, headings, and inline code scale proportionally

#### Scenario: Markdown code blocks use --reader-code-font-size
- **WHEN** `--reader-code-font-size` is changed
- **THEN** only code blocks and inline code scale, independently of body text

### Requirement: Zoom step bounds
Font zoom SHALL be clamped to a configurable range to prevent unusable sizes.

#### Scenario: Font size cannot go below minimum
- **WHEN** the user attempts to zoom out below the minimum (e.g., 8px)
- **THEN** the font size remains at the minimum

#### Scenario: Font size cannot exceed maximum
- **WHEN** the user attempts to zoom in above the maximum (e.g., 36px)
- **THEN** the font size remains at the maximum
