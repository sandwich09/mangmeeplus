# Common Styles

Shared style primitives live here.

- `theme.css` imports generated CSS variables from `@watchdog-bms/design-tokens`.
- `packages/design-tokens/tokens.json` owns color, spacing, radius, typography, shadow, and z-index tokens.
- Feature CSS modules should use theme variables instead of repeating raw values.
- Keep component-specific styles inside component CSS modules.
