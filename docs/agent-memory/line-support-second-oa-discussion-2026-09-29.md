# Agent Memory: line-support-second-oa-discussion-2026-09-29

Status: implementation and integration verification complete; publication scope main/develop only; deployment belongs to the owner
Owner: Codex + product owner
Scope: ปุ่ม “ติดต่อเจ้าหน้าที่” ไป LINE OA อีกบัญชี; impact, bug risks, gaps และ dependency modules
Decisions:
- Owner's latest instruction supersedes the earlier deployment request: put the change in `main` and `develop` only; do not deploy UAT/Production or dispatch release workflows
- Integration uses isolated worktree `/Users/thawatchai/.codex/worktrees/line-support-oa-link/mangmeeplus` from `origin/main` `68f0de58`; `origin/develop` `a94acf18` has an identical tree at verification. Only this task's hunks/docs are carried over from the dirty primary checkout
- Latest main has an outbound URL-rewrite helper absent from the older primary checkout: add `lin.ee` to its existing LINE-host exclusions so the supplied add-friend URI is not given `openExternalBrowser=1`; cover it in the existing helper test
- Owner clarified the desired journey: กดปุ่ม → หน้าเพิ่มเพื่อน LINE Official ปลายทาง → คุยกับเจ้าหน้าที่ใน OA นั้น ไม่ได้ขอให้รับ OA ใหม่เข้าสู่ support inbox เดิม
- Owner supplied `@107ewccg` and `https://lin.ee/UU9pbOI`; scoped implementation changes the existing contact-card button to that URI
- ช่วงแรกตรวจ impact ตามคำขอคุยก่อน; หลังยืนยัน journey และให้ปลายทางแล้วจึงแก้เฉพาะปุ่ม ไม่เปลี่ยน schema, package.json, credentials หรือ provider settings
- Existing typed command, old message actions, signup/LIFF support entry points and open cases retain their behavior
- Ponytail full mode: ใช้ URI action รูปแบบเดียวกับปุ่มข้างเคียง; อ่าน skill จาก `.agents/skills/ponytail/SKILL.md` เพราะ absolute path เก่าไม่มีอยู่
- ประเมิน local working tree ที่มีงานค้างเดิม บน HEAD `4a5817b4`; ไม่อนุมานสถานะ UAT/Production
- แยกผลกระทบของการเพิ่ม URI แยก, ย้ายทางเข้า support และการรับ OA ใหม่เข้าสู่ support inbox เดิม
- URI-only ไม่ต้องเปลี่ยน shared LINE credentials และไม่สร้างเคส/แจ้งทีมงาน/พัก AI จากการกดเอง
- Shared support path ยังใช้ credential เดียวและ state หลายส่วน keyed by LINE user; CRM multi-channel ใช้คนละ tenant/permission boundary
- รายการความเสี่ยงในรายงานมีเงื่อนไขชัด ไม่ถือเป็น production bugs ที่เกิดแล้ว
Open questions:
- None for the scoped local button change
Plan:
- [x] Update contact-card/support entry-point specs with the confirmed external OA journey
- [x] Replace the one message action with the supplied URI; preserve unrelated pre-existing changes in the same file
- [x] Run the existing contact-card and webhook regression suites; verify the outbound card and record delivery limitations
Artifacts:
- `docs/research/line-support-second-oa-impact-audit-2026-09-29-th.md`
- `docs/specs/line-rich-menu-v2-spec.md` §6.6 and support spec entry-point exception
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` contact card
- Existing contact-card test now checks the URI action and preserves the typed support-command assertion
- `packages/contracts/src/line-external-browser.ts` and existing spec (integration worktree): keep LINE short links inside LINE
Verification:
- Integration: `pnpm --filter @watchdog-bms/contracts build` and `pnpm --filter @watchdog-bms/config build` passed; local Prisma client generated without database access
- Integration: `pnpm --filter @watchdog-bms/contracts exec tsx --test --test-reporter=spec src/line-external-browser.spec.ts`: 5/5 passed
- Integration from `apps/api`: `pnpm exec tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/line-first-signup-webhook.spec.ts src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts`: 184/184 passed, 27 suites, 0 fail/skipped
- `git diff --name-only origin/main origin/develop` returned no differences before integrating; both bases share the tested source tree
- Installed cached dependencies with `pnpm install --offline --frozen-lockfile --ignore-scripts --filter @watchdog-bms/api...`; no manifest/lockfile changes
- Post-change: `pnpm exec tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/line-first-signup-webhook.spec.ts` from `apps/api`: PASS 159 tests, 21 suites, 0 fail/skipped. Includes the exact contact-card URI and signed contact-menu → reply regression
- `git diff --check` on changed tracked code/spec files passed
- `curl --head --location --max-redirs 5 --max-time 30 https://lin.ee/UU9pbOI`: HTTP 301 to `https://line.me/R/ti/p/@107ewccg?...`, then HTTP 200; target matches the supplied OA ID. Web reader could not access the short URL, so HTTP readback was used
- API existing focused tests: 179/179 ผ่าน (contact/menu, signup webhook/support lifecycle, support admin replies/thread)
- Web existing focused tests: 67/67 ผ่าน (rendered inbox/thread/action, logic, source QA)
- อ่าน current spec v2/v3/v4, support plans, Prisma/contracts, webhook/credentials, buffer, signup/notify/admin, web, CRM endpoint, outbound URL policy และ official LINE docs
- The 179 API + 67 web checks belong to the impact-audit stage; the 159 API checks above are post-change. Native LINE add-friend/chat acceptance has not been performed
- ไม่อ่านสถานะ cloud หรือ deploy
Next: owner handles UAT/Production under the mandatory deployment protocol. After release request a fresh “ติดต่อเรา” card and verify add-friend/chat on a phone; previously sent cards retain their old message action
