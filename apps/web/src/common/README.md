# Web Common

Shared web code lives here.

Before creating a new helper, hook, API client, type, constant, or UI primitive inside a feature, check this folder first. If the code is used by two or more features, move it here.

Suggested folders:

- `api/` shared API client wrappers
- `components/` shared UI components
- `functions/` shared reusable pure functions
- `constants/` shared constants
- `models/` shared TypeScript models
- `styles/` shared theme tokens and global style primitives
- `utils/` shared pure functions

Common components should include reusable primitives such as modal, badge, alignment/layout helpers, buttons, inputs, and shared feedback states.

Feature CSS should use theme variables from `styles/theme.css` instead of hard-coded repeated colors and spacing.
