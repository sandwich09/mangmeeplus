# Agent Memory: Official OA Flex replies — 2026-10-04

Status: Isolated OA-only publication implemented and locally verified; waiting for authorized non-root platform session. PR #999 admin-merged to main at owner instruction; exact source c4e6a7a815ee9b797ef34d39a6beb43b6f62e65e, merge 6865e27ec9099a0dfadb43f77855ba24b44e3d85. Local checks and LINE schema pass. Remote CI cannot start because GitHub reports account payment/spending-limit failure. Deployment blocked pending CI; native replies remain live and no Flex/customer messages sent.
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
- Tracked Production flag enables replies only after dedicated Secrets Manager resolution. Added bounded controller resolution/current-version freshness and native bot-ID preflight, following the existing Kamal/Postmark inventory pattern. UAT remains disabled; cannot use isolated hotfix because this changes runtime config contract. PR https://github.com/MangmeeDev/mangmeeplus/pull/999 was marked ready then merged with --admin --merge and --match-head-commit after the owner wrote “admin merge ได้เลย” (Thai typed with English keyboard). This explicit merge override does not waive deployment CI/signature/customer acceptance requirements.

Open questions:
- Dedicated token/bot-ID and Flex schema validation are resolved: both provider validation calls returned HTTP 200 on 2026-10-04 09:26 UTC. Public icon URLs and webhook still await deployment.
- CI run 37192973823 ended startup_failure with zero jobs/check runs. Its GitHub UI annotation says recent account payments failed or spending limit must be increased; this is an account blocker, not a test failure. Ready/merge-related automatic runs 37193465618 and 37193469440 also ended startup_failure; no manual rerun was dispatched. Need owner to resolve GitHub Actions billing, then secure runtime injection and reviewed release according to current cloud/Kamal and deployment protocol. No run dispatched: UAT_RUN_ID, READY_RUN_ID, PROD_RUN_ID = NOT_DISPATCHED.

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
- GitHub PR readback: MERGED by MangmeeDev at 2026-10-04T09:51:06Z, merge SHA 6865e27ec9099a0dfadb43f77855ba24b44e3d85. Exact head is an ancestor of origin/main. No merge into develop performed.
- Security release-pin check and production-image-security.spec.sh PASS; git diff --check PASS before commit. No AWS/environment read/mutation was done.

Next:
1. Resolve owner-side GitHub Actions billing blocker, obtain exact-head passing CI, and securely provision of the two fixed Official Secrets Manager names without printing credentials or replacing shared system keys.
2. Read applicable runbooks completely and complete exact release ledger before cloud operations/deployment; use normal UAT then Production promotion with signed/customer acceptance.
3. Publish/verify route and icons, enable webhook, then transition only two native replies after successful acceptance.

## Owner-authorized local publication continuation — 2026-10-04

Owner instructed “ให้ใช้วิธีรันในเครื่อง ส่วนการ์ดใหม่ก็ pubplish ได้เลย”: local validation/release is authorized in place of GitHub Actions; no billing changes or manual CI rerun. Signature/current-admin/customer acceptance remain required. Read current cloud runbook and deployment/Kamal instructions before cloud calls.

- Non-root Production and UAT STS identities match account 311414082667. Production target preflight 20261004T095837Z-3d8e143e PASSED_NO_DEPLOYMENT in 20.094 s; no runtime change and controller transport closed. The first invocation without browser acceptance stopped before creating an operation because old acceptance-credential file is missing; correct canonical browser flag resolved it.
- UAT hosts i-0eb581c5ac3b3d7ba and i-011918b0d49534d1c read back stopped. Exact non-root StartInstances dry run denied; no IAM escalation/start performed.
- Dedicated channel-secret is absent in Secrets Manager. Production deploy role can read the canonical production namespace; create authority is being checked under existing non-root watchdog-bedrock-dev. IAM simulation is denied, which does not establish CreateSecret authority.
- Current retained Production source 908e7aab vs merged main 6865e27e differs in 891 files / 10 migrations, including unrelated payout/reports/runtime features. Asked owner whether to deploy all main or isolate OA; no dependent build/deployment until scope reply. All UAT/READY/PROD workflow run IDs remain NOT_DISPATCHED.

Owner scope reply: isolate only the OA cards. Independent Function URL publication spec/plan supersedes the full-main Kamal plan for this task. Existing non-root watchdog-bedrock-dev denied CreateSecret, so no credentials/infrastructure changed. The prior macOS stdin JSON call failed locally before AWS; private-file parsing resolved that CLI issue. Preparing exact scoped source and deployment bundle before requesting missing platform session.

## Isolated source/build evidence

- Branch codex/official-oa-isolated-publish from merged main 6865e27e; four new infra/line-official files. Existing mapper/verifier/card JSON/PNGs are reused, not copied into a second product definition. No package/lock/dependency changes.
- Bundle local check: handler.spec.cjs PASS 5/5 (three PNGs, missing/system HMAC, base64, staging no-send, unknown/group no-send, live exact three actions/platform URLs, provider failure/reused-token handling). Native SDK loading/live Lambda/provider tests still pending; mocks are not sent messages.
- Local template boundary assertions PASS: 14 resources exclusively new Secrets/Logs/IAM/Lambda, two exact runtime secret refs, both public invocation permissions URL-scoped, conditional live alias; generated template 48,020 bytes. Provider ValidateTemplate denied, so do not claim AWS validated it.
- Release-pin check PASS/current48; git diff --check PASS. No repeat full ERP typecheck/security suite because isolated source does not touch ERP/controller/build inputs already checked in PR999.
- Non-root CreateSecret denied after private-file CLI parsing; no Secrets Manager write succeeded. Channel-secret absence is verified; access-token absence has not been independently checked. Do not assume or overwrite an existing dedicated resource before deployment. No CF change set, function, role, staging/live endpoint, ERP deployment, native-reply change or customer message created/sent.
- Missing authority request: owner to open a non-root platform-admin session for account311414082667 and provide its CLI profile name. Requirement source is cloud-environment-operations.md non-root bootstrap guidance; no root attempt/IAM privilege escalation. Native replies remain live; endpoint remains unset.
