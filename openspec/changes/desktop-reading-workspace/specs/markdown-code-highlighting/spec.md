## ADDED Requirements

### Requirement: Fenced code blocks receive syntax highlighting
Markdown fenced code blocks with a language tag SHALL render with token-level syntax highlighting via highlight.js.

#### Scenario: JavaScript code block is highlighted
- **WHEN** a Markdown document contains ```` ```js ... ``` ````
- **THEN** the rendered code block shows colored tokens (keywords, strings, comments, etc.)

#### Scenario: Code block without language tag is auto-detected
- **WHEN** a Markdown document contains a fenced code block without a language tag
- **THEN** highlight.js auto-detects the language and applies highlighting

#### Scenario: Plain text code block renders monochrome
- **WHEN** a Markdown document contains ```` ```text ... ``` ````
- **THEN** the code block renders with a single text color, no token colors

### Requirement: Custom code/pre components in react-markdown
The react-markdown pipeline SHALL use custom `code` and `pre` components to integrate highlight.js, replacing the default HTML output.

#### Scenario: Fenced code block uses custom pre component
- **WHEN** react-markdown encounters a fenced code block
- **THEN** the custom `pre` component renders it with highlight.js token spans

#### Scenario: Inline code does NOT trigger highlighting
- **WHEN** react-markdown encounters inline `code` (single backtick)
- **THEN** it renders as plain `<code>` without highlight.js token spans

### Requirement: Token-level CSS theme
Highlighted code blocks SHALL have CSS rules for `.hljs` container and common token scopes (`.hljs-keyword`, `.hljs-string`, `.hljs-comment`, `.hljs-title`, `.hljs-number`, `.hljs-attr`, `.hljs-built_in`, `.hljs-type`, `.hljs-literal`, `.hljs-meta`) in a desktop-scoped stylesheet.

#### Scenario: Dark theme token colors
- **WHEN** the desktop is in dark mode (`data-theme="dark"`)
- **THEN** code token colors use a dark-appropriate palette that harmonizes with Apple dark tokens

#### Scenario: Light theme token colors
- **WHEN** the desktop is in light mode (`data-theme="light"`)
- **THEN** code token colors use a light-appropriate palette

### Requirement: Code blocks excluded from text highlight processing
The custom code renderer SHALL NOT pass code content through `highlightChildren` (text highlight / knowledge-point linking), preventing token-span pollution.

#### Scenario: Code block spans are not wrapped by highlightChildren
- **WHEN** a fenced code block is rendered with token spans
- **THEN** no knowledge-point links or text highlights are injected into the code content
