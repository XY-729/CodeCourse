## ADDED Requirements

### Requirement: color-scheme meta tag
The HTML `<head>` SHALL include `<meta name="color-scheme" content="light dark">` placed before any stylesheet link.

#### Scenario: Browser knows color-scheme before CSS loads
- **WHEN** the page begins loading in a user's dark-mode-preferring browser
- **THEN** the browser's default elements (scrollbars, form controls) render in dark scheme from first paint

### Requirement: Inline theme script before stylesheets
`index.html` SHALL include a blocking inline `<script>` before any `<link rel="stylesheet">` that synchronously reads localStorage and `prefers-color-scheme` and sets `data-theme` and `backgroundColor` on `<html>`.

#### Scenario: Dark mode user sees dark background on first paint
- **WHEN** a user with dark mode preference loads the page
- **THEN** the `<html>` element has `data-theme="dark"` and a dark background color before the first paint

#### Scenario: User's saved theme override is respected
- **WHEN** the user previously selected "light" in the app
- **THEN** the inline script sets `data-theme="light"` regardless of system preference

### Requirement: Transition suppression during startup
CSS transitions on `background-color` and `color` for `html`, `body`, `#root` SHALL be disabled during initial page load and re-enabled after React hydration.

#### Scenario: No visible transition from light to dark during startup
- **WHEN** the page loads in dark mode
- **THEN** no visible color interpolation from light to dark occurs

#### Scenario: Transitions enabled after hydration
- **WHEN** React has mounted and applied the theme
- **THEN** subsequent manual theme switches include smooth transitions

### Requirement: Base styles driven by CSS variables
`styles.css` global base styles SHALL use CSS variable fallbacks for desktop, so the first paint uses the correct dark values without waiting for Apple token overrides.

#### Scenario: Desktop dark mode has no light-color intermediate frame
- **WHEN** the page loads in desktop dark mode
- **THEN** the body, topbar, and input backgrounds are dark from the first rendered frame
