# Agent Memory: Official OA Flex replies — 2026-10-04

Status: Local implementation, mockup and LINE provider schema verified; Messaging API channel activated and dedicated token issued. AWS provisioning, reviewed CI and deployment remain pending. Native replies are still live; no Flex/customer messages sent.
Owner: Codex + product owner
Scope: Public marketing replies for MangmeePlus Official @107ewccg only; Contact and Social cards each have three compact actions. Owner explicitly authorized API/reply implementation after the earlier Manager-only scope.

Decisions:
- System OA @458wpnio, ERP/AI/OCR/identity/support and existing shared secrets are unchanged. Use a separate HMAC route `/v1/line/official/webhook`, default disabled, with dedicated Official secret/token.
- Public contact stays contact@mangmeeplus.com, 098-256-5628 and https://official.mangmeeplus.com/. Developer administrative email is admin_mangmee@mangmeeplus.com, saved and shown verified in LINE Developers profile. These addresses have different purposes.
- Owner completed Developer and Messaging API agreements personally. Provider MangmeePlus ID 2005600429; channel ID 2011854342; Manager shows กำลังใช้งาน.
- Owner accepted compact layout, requested less green, then stronger coordinated shades matching the menu. Latest draft uses warm cream with forest headings, gold/sage/teal Contact rows and rose/blue/mint Social rows. PNG platform icons remain recognizable on lighter surfaces.
- Contact has no duplicate body email/phone; address appears inside its clipboard row. Phone/website actions retain exact destinations. All supplied Social query parameters retained.
- Keep native Social 81694321 and Contact 81694430 active until webhook/assets/schema and owner phone acceptance pass. Then stop only those two. How-to 81694353, Package 81694407, welcome and manual chat remain native.
- Isolated managed worktree `/Users/thawatchai/.codex/worktrees/official-oa-flex/mangmeeplus`, base remote main b721e1b4d0e3e7c2f9d4454222ff7f26d5d56930. Primary checkout has unrelated owner changes and was not used for source edits.
- Dedicated channel credentials are saved mode 0600 outside Git under `/Users/thawatchai/.codex/secure/line-official-oa-2026-10-04/credentials.json`. GET bot info and both validate/reply payloads pass; no message API invoked. No package.json/dependency/DB changes or AWS reads/mutations/deployment yet.
- Tracked Production flag enables replies only after dedicated Secrets Manager resolution. Added bounded controller resolution/current-version freshness and native bot-ID preflight, following the existing Kamal/Postmark inventory pattern. UAT remains disabled; cannot use isolated hotfix because this changes runtime config contract. Review branch `codex/official-oa-flex` is prepared for a draft PR.

Open questions:
- Dedicated token/bot-ID and Flex schema validation are resolved: both provider validation calls returned HTTP 200 on 2026-10-04 09:26 UTC. Public icon URLs and webhook still await deployment.
- Need secure runtime injection and reviewed release according to current cloud/Kamal and deployment protocol. No run dispatched: UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID = NOT_DISPATCHED.

Artifacts:
- Spec `docs/specs/line-official-oa-flex-replies-spec-th.md`; plan `docs/plans/line-official-oa-flex-replies-plan-th.md`.
- API config, isolated controller, deterministic keyword mapper, two JSON cards and focused spec; three PNGs under apps/web/public/assets/line/official-oa-*.png.
- `/Users/thawatchai/Downloads/line/oa-official-rich-menu-2026-10-04/`: card JSON/contents, PNGs, generation/revision scripts and UI proof. URLs in JSON do not mean these assets are hosted yet.
- Inline mockup `/Users/thawatchai/.codex/visualizations/2026/10/02/01a0fafe-90e8-7493-ab20-40fc97d2e2fb/official-oa-compact-cards.html` — browser mockup, not a sent LINE card.
- Proof: developer-admin-email-proof.jpg, messaging-api-active-proof.jpg (cropped before credential fields), provider-terms-handoff.jpg and latest compact palette screenshot.

Verification:
- Config/contracts builds PASS; Prisma client generation PASS using a dummy local URL (no DB connection).
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/auth/line-official-webhook.controller.spec.ts`: PASS 5/5, mocked outbound fetch only.
- Shared line-webhook.controller.spec.ts: PASS 11/11.
- Kamal release_test.py: PASS 42/42, including separate secret names, Production-only use, bot identity mismatch rejection and secret-rotation freshness. Outbound AWS/LINE calls are mocked.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @watchdog-bms/api exec tsc --noEmit -p tsconfig.json`: PASS after repairing test-only request casts/parameter types. First attempt lacked Prisma; default-heap attempt ran out of memory; no baseline errors remain in final typecheck.
- Browser QA at iframe 320px: root/scroll width both 320px, six actions, each card 260px wide and about 278–280px high. Full email fits (164px content/scroll width); three PNGs load. Temporary viewport reset.
- git diff --check PASS before latest docs update; repeat at handoff.
- LINE provider schema PASS for Contact/Social; live webhook/assets/phone and signed deployment acceptance NOT RUN.

Next:
1. Finish review/CI and secure provisioning of the two fixed Official Secrets Manager names without printing credentials or replacing shared system keys.
2. Read applicable runbooks completely and complete exact release ledger before cloud operations/deployment; use normal UAT then Production promotion with signed/customer acceptance.
3. Publish/verify route and icons, enable webhook, then transition only two native replies after successful acceptance.
