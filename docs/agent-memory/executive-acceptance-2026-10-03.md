# Agent Memory: executive report — browser acceptance on a seeded local stack

Status: Done 2026-10-03. Branch `claude/executive-acceptance-20261003` (from the program head `3ddcf09f7`), not pushed. Eleven small defects fixed in eleven commits (tests red then green) plus an e2e spec; bigger findings listed below for the owner/controller. The Excel export was not part of this check.

Owner: browser-acceptance lane of 2026-10-03; the controller reviews, pushes and merges.

Scope: the System Admin's executive-account pages (E1/E4a) and the report labels on the partner pages (E4a); the executive's whole journey (sign-in, forced password change, legal release, landing, menus, denied URLs) and every report screen and state of E4b (UI spec §5–§8, §11), at 390 and 1280 px, on a throwaway local stack (Postgres/Redis/MinIO containers, API + `next dev`) with fictional data written the way the read pg spec writes it, and the build run through `POST /v1/internal/executive/rebuild` with a local worker token. Billing ran in TEST mode with a made-up account id so the build reads the written money rows.

Decisions:

- Data, all fictional (`exa-*`): 23 customer companies in several states (active, suspended, disabled, archived), one test, one unclassified, the seeded demo shops as test and the platform as internal; business types, owners with `example.test` contacts, expenses, assistant questions, receipt reading from 10 Aug, billing accounts from 5 Aug, paid invoices, one balance scan 1 Aug–3 Oct, one untied August charge, a full and a partial refund, a disputed invoice, seller credits (one flagged), 23 lifecycle rows on one company. The first round's time was moved back to 25 Aug ("report running since"), so September is complete, August partial (usage before the first round, untied money), July money unavailable, October running.
- Labels were set through the partner pages (each company's overview card), not SQL.
- Fixes stay inside the executive screens: no API, contract or migration change; the one shared file touched is the `SystemHeader` path check. Wording that needs the owner (one sentence for a reason code used in two meanings) is listed, not changed.

Defects fixed (commit — what):

- `9a02646c1` + `fba31da06` — every in-page control of the report (filters, month picker, views, tabs, sort, paging, compare sides, swap, clear) changed the URL but not the page: the history calls passed Next's own `__NA` key, so Next 16 skipped the router update. They pass only the report's keys; the URL clean-up stays URL-only so a page opens with one read.
- `b98087f0c` — the executive account pages had no page container (flush to the screen edge at 390, to the sidebar at 1280, no `<main>`).
- `cc5edaf51` — the admin menu turned "ตั้งค่า LINE"/"…ค่า AI" into Thai on `/system/executive-users` too (bare path prefix).
- `a9313e82d` — all "เลือกเพื่อเปรียบเทียบ" toggles shared one id: tapping the words on any row picked the page's first company; the table checkboxes had no name.
- `45a465ac7` — the list wrote "อันดับการใช้ 1" under "999.00 บาท" when sorted by money; now "อันดับ".
- `697113e12` — Instagram ("IG", label equal to its value) showed as "ไม่ระบุ" in the channel filter, table, chips and compare.
- `61dc0162c` — the channel/seller tables and the compare table headed their first column "กลุ่มธุรกิจ"; compare differences were bare numbers.
- `fadacc3c0` — "· เชียงใหม่": a stray separator before the province when a company has no registered name.
- `2dd113207` — company detail: "ไม่มีสิทธิ์ดูข้อมูลติดต่อ" for a reader without the right (UI spec §8.1); the "อื่น ๆ" line only for the "other" channel.
- `6310b89d0` — detail and compare repeated the page's "หน้านี้ไม่ใช้ตัวกรองของรายงาน" sentence inside the content.
- `f3d2db78d` — e2e `e2e/executive-report.spec.ts` EXEC-01 (create executive → sign in → overview → drill → detail).

Open questions (left for the owner/controller):

- D3 wording: `HISTORY_BEFORE_COLLECTION` has one sentence, "ยังไม่มีข้อมูลของช่วงนี้ เพราะเป็นช่วงก่อนที่ระบบเริ่มเก็บ" (plain-language spec line 216). It is true for an unavailable figure (July money) and untrue next to a number: the adoption chart's "ยังประเมินไม่ได้" group (companies older than receipt reading), usage "อย่างน้อย" in August, and the partial AI cost of August, which also carries the money qualifier "ยอดเฉพาะรายการที่ยืนยันแล้ว" although nothing is unconfirmed there (the meter began on 12 Aug). Needs one sentence per meaning in the plain-language spec.
- D10: on a partial month the company detail repeats the month's two reason sentences under every one of its ~14 figures (long at 390); show the month's reasons once?
- D13: after a round builds a month that was missing, the open page shows it (after its reload-once) but the month picker still disables it until a full reload (the context's `builtMonths` is read once).
- D14: when the read right is removed and the page is reloaded, the `/system` layout shows the admin-console denial ("…ส่วนผู้ดูแลแพลตฟอร์ม", "กลับไปยังพื้นที่ทำงาน") to an executive; the report layout's own Thai denial is never reached. The same page answers `/sales/deals`.
- D16/D17 (minor): a drill with no condition shows an empty "เงื่อนไขที่กดมา … ล้างเงื่อนไขที่กดมา" row and a drilled condition shows twice; the company list has two toggles both named "ตัวกรอง · N" (report filters and list filters).
- By design (backend spec §886), the sentence "มีอีก 3 บริษัทที่จ่ายเท่ากับลำดับสุดท้ายของกลุ่ม" opens the list of all 4 tied companies, the group's last one included.
- D19 (minor): every account status badge is the same green, "ถอนสิทธิ์แล้ว" and "ระงับ" included. Sign-in while suspended answers the shared "บริษัทถูกปิดใช้งานหรือสิทธิ์ของคุณถูกยกเลิก…".
- Noticed outside the executive screens: the shared `ThemedSelect` `<summary role="combobox">` is not labelled by its `<label for>` (its accessible name is the selected value); the legal page shows "Secure business workspace", "LEGAL ACCEPTANCE"; "ชำระในเดือน: ชำระในเดือน" on the detail repeats its label as the value.

Artifacts:

- Commits above on `claude/executive-acceptance-20261003`; e2e spec `e2e/executive-report.spec.ts`.
- Lane notes, scripts, seed scripts, probe specs, logs and screenshots (not in git): `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/exec-accept/` (`NOTES.md`, `seed-report*.ts`, `probe-specs/`, `shots/final-*`).

Verification:

- Browser (Playwright Chromium, real login form, 390 and 1280): first pass while fixing, then the whole set again on the final code from an empty stack (`final-run.sh`, logs `final-run-part1/2.log` and `final-run.log`): every journey probe passed; 335 screens recorded with no sideways scroll and no page error; the words sweep (20 report views + 3 admin pages at both widths) found no code tokens, internal ids, Gregorian/ISO dates or bare 4+ digit numbers.
- E2E `e2e/executive-report.spec.ts` EXEC-01: passed on a freshly seeded stack (8.9 s) and on the full data set (exit 0); ad-hoc native `tsc` of the spec exit 0.
- Focused web specs, red then green per fix (logs `d*-red.log` / `d*-green.log`): final executive specs 40/40 + account specs 10/10.
- Web typecheck (native tsc via the shared helper, under the heavy lock) exit 0; whole web suite under the heavy lock without S3_* variables exit 0, 2845/2845, 572 suites, 0 skipped; `git diff --check 3ddcf09f7..HEAD` exit 0; maintenance pins `--check` exit 0 (no pinned file touched).
- No API, contract or migration change, so no API typecheck or pg spec was run.

Next: controller review; owner wording for D3 (and D10/D14); push with the program branch.
