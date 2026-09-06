# Agent Memory: LINE บริษัทของฉัน context card — "เปิดเว็บบริษัทนี้"

Status: Implemented on `codex/line-context-card-open-web` (branch pushed, no PR, not deployed).
Stacked on `codex/line-company-picker-open-web` (PR #460, head `4c10f938`), merged in because it is not in
`develop` yet.

Owner: thawatchai (request 2026-09-06)

## Scope

Owner (verbatim): *"เจ้าของที่มีบริษัทเดียวจะไม่เห็นการ์ดเลือกบริษัท อยากให้การ์ดบริษัทเดียวมีปุ่มเปิดเว็บด้วย"*

The picker carousel that [[line-company-picker-open-web]] gave a `เปิดเว็บบริษัทนี้` button is only pushed
when `memberships.length > 1`, so a single-shop owner — the majority of บริษัทของฉัน — never saw that button
at all. The same button now sits on the บริษัทของฉัน **context card**, for the **current** company.

No schema, env, flag, deploy or `package.json` change.

## Decisions

- **Same surface, same mint.** `LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN` (`company_picker_open_web`) and
  `LineHandoffLinkService.linkFor(ctx, '/companies/<currentCompanyId>/dashboard')` — reused, not forked. It is
  the same "open this company's web" action, and the exchange-time context switch is a harmless no-op here: it
  re-selects the company the chat is already on.
- **Every member, not owner-only.** Opening the web on the company you are already in is not a shop-owner
  action; the web enforces its own permissions. `เปิดร้านใหม่` keeps its own rules untouched (owner-only,
  withheld while a signup application is travelling).
- **Order: `เปิดเว็บบริษัทนี้` (secondary) first, `เปิดร้านใหม่` (primary green) second** when both exist.
  Opening a shop stays the primary call to action.
- **No hint line.** The picker's `COMPANY_PICKER_OPEN_WEB_HINT` explains a *switch*; this card is already about
  the current company, so the sentence would describe a change that does not happen — the same reasoning that
  removed it from the picker's `✓ ใช้งานอยู่` bubble.
- **`altText` unchanged.** A button is not news the reader needs in the chat list, unlike the 🕒 pending line.
- **Two mints for a multi-company member, on purpose.** The current company gets one token for the context
  card and one for its own picker bubble. Tokens are single-use, so sharing one would make whichever button
  the reader tapped second land on `/login?line=handoff-expired`. One extra mint per view is the accepted cost.
- **Absent link ⇒ byte-identical.** Handoff feature off (`linkFor` → `null`) or a failed mint → no
  `openWebUrl` → the card is exactly the one shipped today, `footer` and all. The footer takes `spacing: 'sm'`
  only when it holds more than one button, so the one-button card is byte-identical too.

## Artifacts

- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` — `CompanyContextCard.openWebUrl`,
  `buildCompanyContextMessage` footer built from a `buttons` array.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — one `linkFor` call
  in `handleCompanyCommand`'s `list` branch.
- Specs: `line-staff-menu.logic.spec.ts`, `process-line-webhook.use-case.spec.ts` (two existing picker
  assertions updated for the extra context-card mint: `calls` now leads with the current company).
- Docs: `docs/specs/line-rich-menu-v2-spec.md` §6.2 delta 2026-09-06 (second bullet block);
  `docs/specs/line-web-deeplink-handoff-spec.md` §11 delta — mint accounting now names the context card.

## Verification

`pnpm exec tsx --test` from `apps/api` (after `pnpm install`, `contracts` build, `prisma generate`):

| spec | red | green |
|---|---|---|
| `line-staff-menu.logic.spec.ts` | 50 pass / 2 fail | 52 / 0 |
| `process-line-webhook.use-case.spec.ts` | 220 / 2 | 222 / 0 |
| `line-first-signup-webhook.spec.ts` | — | 67 / 0 |
| `line-intake-dispatch.use-case.spec.ts` | — | 183 / 0 |
| `spec-suite-coverage.spec.ts` | — | 3 / 0 |

- `pnpm --filter @watchdog-bms/api typecheck` — clean.
- `node apps/api/scripts/check-di-metadata.mjs` — 796 files, 870 decorated classes, all carry paramtypes.

Mutations (each restored):

| mutation | result |
|---|---|
| drop the `openWebUrl:` mint in `handleCompanyCommand` | `process-line-webhook.use-case.spec.ts` 218 / **4 fail** |
| render the web button as `...(false ? …)` in `buildCompanyContextMessage` | `line-staff-menu.logic.spec.ts` 50 / **2 fail** |

### Local full-stack proof — NOT run

Time-boxed at 15 minutes and skipped. The fake-LINE harness scripts do not survive between sessions
([[local-line-fake-harness]] says to rebuild them from the recipe), and a real run needs the preload fake plus
a `@watchdog-bms/config` + `contracts` + `api` swc build, an API boot and a Next dev boot — the ~40-minute path
[[line-company-picker-open-web]] already walked for this exact surface on 2026-09-06. That run's evidence row
*"bubble 1 (`✓ ใช้งานอยู่`) → one button: `uri` `เปิดเว็บบริษัทนี้` → `http://127.0.0.1:3020/l/…`"* is the
**identical** `{ companyId: current, targetPath: '/companies/<current>/dashboard', surface:
company_picker_open_web }` pair this card now mints, exchanged and switched end to end. What is new here is one
call site and Flex rendering, both covered by the specs above against the real `buildCompanyContextMessage` and
the real `handleCompanyCommand`.

## Open questions

- None blocking.

## Next

- Rides the same UAT deploy as the picker branch — no flag or `deploy.sh` change
  (`LINE_WEB_HANDOFF_ENABLED` is already on in UAT and production, see [[line-company-picker-open-web]]).
- Owner acceptance: a single-company owner taps บริษัทของฉัน and sees `เปิดเว็บบริษัทนี้` on the one card.
