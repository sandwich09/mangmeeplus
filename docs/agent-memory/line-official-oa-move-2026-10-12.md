# Agent Memory: LINE Official OA move to @695ultfm

Status: LIVE on Production since 2026-10-12 16:54 Bangkok (operation `20261012T094806Z-fe95e8a1`, source `de8389ce3`); LINE's webhook test on the new channel answered 200. Owed: the owner's phone check of the two cards and of one "ติดต่อทีมงาน" button; the billing rounds back on `main` when he allows (see below).
Owner: thawatchai (owner request 2026-10-12: "กำลังย้าย line official ไปที่ใหม่ (@695ultfm)"; then "ไปช่องทางปกติ ไม่ hotfix แล้ว").
Scope: the public Official OA moves from `@107ewccg` to `@695ultfm`. Two things follow it: the link behind the three "talk to the team" buttons of the System OA cards, and the account the Production release tool accepts for the Official OA reply route. The two cards (contact, social), the webhook controller and `infra/kamal/config.json` do not change: none of them names the account.

Decisions:
- Normal release path (UAT, then promotion). A Production hotfix preserves the serving configuration, so it would keep the old channel secret and token; only a normal release reads the two secrets again.
- `STAFF_OA_URL` is the owner's short link `https://lin.ee/6Sc38L6` (given 2026-10-12; it redirects to `https://line.me/R/ti/p/@695ultfm`). The account also has the premium id `@mangmeeplus`; the release tool compares the basic id, which LINE reports separately.
- `infra/line-official/` (the deleted 2026-10-04 service) keeps the old id: history only.

Cutover order (the API holds ONE secret and ONE token, so the old account's two buttons stop answering at step 3):
1. Owner, at LINE for `@695ultfm`: Messaging API on; issue channel secret and long-lived token; rich menu whose buttons send exactly `ติดต่อมั่งมีทีม` (or `ติดต่อเรา`) and `โซเชียล` (or `ติดตามน้องมั่งมี`); LINE's own auto-reply off for those words.
2. Owner puts the new values into `watchdog-bms/production/line-official/channel-secret` and `channel-access-token` (the deploy role cannot). From this moment a normal Production release built WITHOUT this branch stops at "Official OA token belongs to a different bot".
3. UAT round, then promotion of this branch. The release checks the token against `@695ultfm` before any mutation (`official-oa-readiness.json`).
4. Set and test the webhook address on the new channel with its token: `PUT /v2/bot/channel/webhook/endpoint` to `https://origin.mangmeeplus.com/v1/line/official/webhook`, then `POST /v2/bot/channel/webhook/test`.
5. Owner presses both buttons on a phone in the new account, and one "ติดต่อทีมงาน" button in the System OA.

Billing rounds held back on main (owner 2026-10-12: "งานเรียกเก็บเงินที่ค้างอยู่ ไม่ต้องขึ้น ขึ้นแค่เรื่อง line", then "ทาง ก ... stash ของทางนั้นไว้ก่อน"): a UAT round always builds `origin/main`, so the three billing merges of 2026-10-10 (#1075, #1077, #1079) are reverted on `main` only, by three revert commits in the same PR as this change. Proven before the LINE commit: the tree equalled `3c8922ffb` (the serving source `9d9473b55` plus its release record). `develop` keeps the billing rounds. **To put them back on `main` when the owner allows the deploy: revert the three revert commits (newest revert last), do NOT expect a develop-to-main merge to bring them back**, then check `git diff origin/develop origin/main` is empty apart from what is meant to differ.

Done at LINE for `@695ultfm` on 2026-10-12 (owner's Chrome, his word): rich menu copied (same image, six areas, same actions, shown until 2027-10-04); keyword replies "Package" (3 keywords) and "วิธีใช้งาน" (2 keywords) with the same images, active; the default reply-to-everything off; webhook address entered. The owner replaced the two secret values himself the same afternoon.

Open questions: none.
Artifacts: `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` (`STAFF_OA_URL`), three spec files, `infra/kamal/release.py` (`official_configuration`), `infra/kamal/release_test.py`.
Verification: `tsx --test` of the three touched API spec files: 598 pass, 0 fail. `python3 -m unittest discover -s infra/kamal -p release_test.py`: 45 pass.
Next: owner inputs, then PR to develop and main, UAT round, ask for the Production go.
