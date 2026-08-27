# P27 Phase 3B — Local browser evidence (2026-08-27)

Environment: local web `127.0.0.1:3100`, local API `127.0.0.1:3101`, company `seed-local-company`. This run used the real in-app browser against the local PostgreSQL database; it did not call a cloud environment.

## Journeys and screenshots

| File | Viewport / proof |
|---|---|
| `01-mobile-income-mode.png` | 390×844 — two large, plain-language income choices |
| `02-mobile-rounding-invoice.png` | 390×844 — `0.0300 × 68.50` renders and submits as `฿2.06` |
| `03-mobile-issued-invoice-detail.png` | 390×844 — issued invoice detail after the real API mutation |
| `04-mobile-paid-invoice.png` | 390×844 — invoice settled from the payment form |
| `05-mobile-credit-note-draft.png` | 390×844 — source-first credit-note draft created with evidence |
| `06-mobile-issued-credit-note.png` | 390×844 — credit note issued successfully |
| `07-mobile-viewport-issued-credit-note.png` | exact visible viewport after responsive shrink fix; the previously unreachable action is usable |
| `08-desktop-income-mode.png` | 1280×900 — income landing on desktop |
| `09-desktop-issued-credit-note.png` | 1280×900 — issued credit-note detail on desktop |

## Persisted results

- Invoice `INV-202608-00028`: `ISSUED`, total `2.06`, payment status `PAID`, generic-create idempotency key present.
- Credit note `CN-202608-00001`: `ISSUED`, total `1.03`, source is the invoice above.
- Attachment link: `targetType=accounting.document`, `purpose=accounting.document.supporting`, MIME `image/png`, status `ACTIVE`, byte size `10043`; attachment branch equals the target branch (`null`, company-central in this unrestricted-owner run).
- Fresh browser-tab console contained no `error` or `warn`; only React DevTools/HMR development messages were present.

## Verification

- `pnpm --filter @watchdog-bms/contracts typecheck` — pass.
- `pnpm --filter api typecheck` — pass.
- `pnpm --filter web typecheck` — pass.
- `pnpm --filter @watchdog-bms/contracts test` — 196/196 pass.
- `pnpm --filter web test` — 1100/1100 pass.
- `pnpm --filter api test` — full pretest and test runners exit 0.
- Focused P27 API boundary/attachment/totals/DTO tests — 114/114 pass before the final test-file consolidation; consolidated update/spec-coverage run — 22/22 pass.
- `pnpm --filter api prisma:validate` and `git diff --check` — pass.

The local database had migration `20260827100000_accounting_document_create_idempotency` applied before this browser run. No UAT or Production deployment was performed.
