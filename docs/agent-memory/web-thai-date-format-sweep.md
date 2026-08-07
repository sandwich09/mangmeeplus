# Agent Memory: web-thai-date-format-sweep

Status: Done (2026-07-25)

Owner: Owner request — "แก้ Format date ทั้งหมดในระบบที่แสดงบนหน้าจอเป็น DD M.M. YYYY … ถ้ามีเวลาด้วยให้เป็น HH:MM น."

Scope: Every on-screen date/time in `apps/web`, plus the one customer-facing LINE reply date in `apps/api`. Applied to BOTH working copies (`WatchDog-BMS-fix-bug-20260718` on `fix-bug-20260718` and `WatchDog-BMS` on `20260711`) at the owner's request.

Decisions:

- Single source of truth stays `apps/web/src/common/i18n/thai-date.ts`. Added two helpers next to the existing pair:
  - `formatThaiTime` → `16:04 น.` (time-only fields)
  - `formatThaiMonth` → `ก.ค. 2569` (accounting/tax period keys, `yearMonth` filters)
- Day is **not** zero-padded (`5 ก.ค. 2569`) — matches Thai convention, `ThemedDate`'s picker label, and the pre-existing `formatThaiDate`.
- Report tables format by the column's declared `ReportFieldType` (`date` / `datetime`) rather than sniffing string shapes.
- `<input type="date">` / `ThemedDate` values stay ISO (`.slice(0, 10)`); only rendered text changed.
- Booking week-grid headers (`จ 20 ก.ค.`, `19 ก.ค. – 25 ก.ค.`) left as-is — calendar chrome, not date fields.
- `formatRelativeTime` / `relativeTimeTh` ("5 นาทีที่แล้ว") left as-is — relative, not absolute dates.
- `apps/api` keeps its own tiny formatters (`substitute-receipt.logic.ts`, `crm-booking.logic.ts` already emit the same shape); added a matching one for the LINE expense reply instead of introducing a shared API date util for one call site.

Open questions: none.

Artifacts:

- `apps/web/src/common/i18n/thai-date.ts` + `.spec.ts`
- ~25 feature files routed onto the shared helpers (the `20260711` copy needed the full migration; the `fix-bug` copy only had stragglers)
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`

Verification:

- `tsx --test src/**/*.spec.ts` in `WatchDog-BMS/apps/web` → 245 pass / 0 fail (includes 5 `thai-date` cases, green under `TZ=Asia/Bangkok` and `TZ=UTC`).
- `tsc --noEmit` in `WatchDog-BMS/apps/web`: 55 error lines vs 56 on the reverted baseline — all pre-existing stale-`@watchdog-bms/contracts` mismatches, none in touched date code.
- `tsc --noEmit` in `WatchDog-BMS/apps/api`: no errors in the edited webhook file.
- `WatchDog-BMS-fix-bug-20260718` has no installed `node_modules`; its `thai-date.spec.ts` was run with the sibling copy's `tsx` (5 pass).

Next: nothing outstanding. If the app ever needs an English date surface, add a locale-aware wrapper rather than reintroducing per-file `toLocaleDateString`.
