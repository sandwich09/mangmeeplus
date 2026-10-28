# Campaign popup verification — 2026-10-28

- Sol: `corepack pnpm exec tsx --test 'src/features/public-home/*.spec.ts'`: 57/57; `corepack pnpm exec next typegen && corepack pnpm exec tsc --noEmit`: pass.
- Sol: `corepack pnpm --filter @watchdog-bms/web test`: 5,083 tests, zero failures/skips/cancellations, exit0; full log `web-tests.tap`.
- Root: real in-app browser at390×844 and1280×900. Bare `/halloween?preview=events&event=halloween` opens chooser after hydration; X/Escape/backdrop close; homepage pricing/brand navigation works while closed; manual entry reopens; refresh reopens; ordinary homepage stays manual. Both widths have document scrollWidth equal clientWidth. Screenshots: chooser/closed/theme-off for both widths.
- Theme-off bare route renders the real normal homepage, without activity/game. Theme-off card URL and active unknown-card URL show not-found. Active known-card URL retains result preview and share controls. No live theme mutations.
- Actual copy action resolves to `caption.txt`: `https://mangmeeplus.com/halloween` plus unchanged approved quote/LINE. The clipboard operation completes only after the preview is visible/focused; initial immediate read returned previous clipboard contents and was not accepted as evidence.
- Static QR uses existing installed qrcode-generator2.0.4, M correction, auto version, four-module margin; no dependency change. Native Vision decode after resizing to148px (actual export placement) returns exactly `https://mangmeeplus.com/halloween`. Visible canvas footer still says `mangmeeplus.com`. No original PNG edits.
- Browser logs included development-only React Performance.measure negative-timestamp warnings on navigation. No product error state or interaction failure; built-UAT verification remains required. No physical iPhone/Android or social posting claim.
- `production-alarms-before.json`: current read-only Production alarm snapshot; owner permits root read only and accepts the unchanged October9 API security alarm for this release. Deployment remains scoped non-root.

Release ledger and exact IDs: [task memory](../../agent-memory/halloween-event-popup.md).

## UAT correction

First UAT operation `20261028T062112Z-902951de` passed infrastructure signing/readiness but exposed React418 text hydration recovery on both `/` and `/halloween`. Browser initially saw three Cloudflare email-protection anchors, which React replaced on recovery. Retained actual error logs: `uat-hydration-before.json`. No Production promotion of this source.

The [official per-email guard](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/#prevent-cloudflare-from-obfuscating-email) protects the entire static contact anchor from edge rewriting without changing Cloudflare configuration or weakening CSP. One trusted-literal helper is reused at all3sites; a rendered regression verifies exactly3guarded unchanged mailto links for both themes. Public-home58/58, fullweb5084/0 and TypeScript pass. Actual local DOM retains all guards. Full correction log `web-tests-correction.tap` remains local; compact summary committed. Corrected UAT and Production verification completed below.

## Accepted UAT and Production

- Exact source `8ee5e737e0b90ded61fb7955a5fe9c583dfd2f3c`. Corrected UAT `20261028T064018Z-08c3a82d` accepted in251.606s; Production `20261028T064841Z-6cd1214c` accepted in1,038.175s including739.921s operator/browser stage. Both KMS signatures verified, customerOPEN/deep readiness passed, all2UAT/4Production owned SSM sessions terminated.
- `release-summary.json` records exact IDs, source/controller/receipt hashes, phases and published digests. All four published image digests and AgentCore artifact match UAT; no Production rebuild. Private signed receipts and authentication observations remain in ignored `.env.kamal` storage.
- `uat-hydration-after.json` plus corrected UAT screenshots: zero error logs on both routes and actual draw17-turbo-granny. `production-browser-checks.json` and Production screenshots: automatic campaign chooser, dismissal preserving URL, manual reopening, refresh, ordinary homepage manual entry, actual19-jiangshi draw and loaded image pass at390/1280. No horizontal overflow;3proper mailto anchors, no email-protection rewrites/errors.
- Current owner-admin login/identity/permission, live/canOpen/OPEN, logout and401 after logout passed. Backend request logs corroborate login200/gate200/logout204/me401; no browser Network capture is claimed. Flags came from actual authenticated /auth/me, not a captured login response. No password/legal/gate mutation.
- `production-alarms-pre-promotion.json` and `production-alarms-after.json`:15OK plus only the owner-accepted unchanged October9 API-security alarm. No suppression or cause/delivery recheck. LINE messaging, physical iPhone/Android and actual social posting remain unexercised.
