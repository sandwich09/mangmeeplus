# WatchDog-BMS Design Tokens

Shared theme source for web and LIFF.

`tokens.json` is the source of truth. Generated outputs:

- `generated/web/theme.css`

Run:

```bash
pnpm --filter @watchdog-bms/design-tokens build
```

Web and LIFF surfaces import tokens through `apps/web/src/common/styles/theme.css`.
