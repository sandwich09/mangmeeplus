# Results: expense-modal-stepper-round7

Status: Complete

## Files touched

- `apps/web/src/features/expenses/ExpensesPages.tsx`
  - Replaced the guided chips with the specified connected wizard progress bar.
  - Added an active-step ring independently of done/attention state, so active+done keeps both `✓` and the ring and active+attention keeps both `⚠` and the ring.
  - Replaced the muted helper line with the current-step instruction strip.
  - Split the footer into a left destructive zone and a right flow zone.
- `docs/agent-memory/expense-modal-stepper-round7.results.md`
  - Recorded scope, preservation checks, and verification evidence.

## Footer contract preservation

All 14 existing footer button instances keep their effective condition, handler, `disabled` expression, and `title` unchanged:

- Guided: ย้อนกลับ, อ่านเอกสารอีกครั้ง, ตรวจหารายการซ้ำ, non-ready ยกเลิกรายการ, ส่งตรวจ, ready ยกเลิกรายการ, ยืนยันและลงบัญชี, and ถัดไป.
- Approver-only: ยกเลิกรายการ and ยืนยันและลงบัญชี.
- Confirmed: ตรวจหารายการซ้ำ, ยกเลิกเอกสาร, and ดูสมุดบัญชี.
- Rejected/restart: เริ่มตรวจใหม่.

The confirm buttons also retain `style={successBtnStyle}`, ดูสมุดบัญชี still has no `disabled` or `title`, and the existing send/confirm title ternaries are byte-for-byte unchanged.

The only intentional footer button class change is the guided review-step reject button when `status !== 'READY_FOR_CONFIRMATION'`: `ghostClass` → `dangerClass`. The four destructive buttons moved left; all flow buttons remain right-aligned in their existing relative order.

## Hard-constraint audit

- `goToStep`, including details-step save-on-leave and failed-save stay-on-step behavior, is untouched.
- `deriveExpenseReviewSteps`, `initialExpenseReviewStep`, `stepSaving`, and the guarded initial-step effect are untouched.
- All guided step panels remain mounted and retain their original `hidden` class behavior.
- The non-guided `navChips` branch, its scroll handler/classes, and continuous-scroll content/order are untouched.
- Guided step buttons retain `disabled={stepSaving}`, `onClick={() => void goToStep(entry.key)}`, and `aria-current`.
- Connectors use the preceding step's done state. The active ring is a separate `cx` argument from the done/attention/pending state styling.
- Two independent read-only diff audits found no footer or stepper preservation violations.

## Verification

### Typecheck

Command:

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
```

Exit code: `0`

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Lint

Command:

```bash
corepack pnpm --filter @watchdog-bms/web lint
```

Exit code: `0`

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Test

Command:

```bash
corepack pnpm --filter @watchdog-bms/web test
```

Exit code: `0`

Verbatim command header and final TAP totals:

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

ℹ tests 416
ℹ suites 109
ℹ pass 416
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 889.569958
```

Runner note: the sandbox forbids Unix-socket listeners, so the installed `tsx` CLI initially stopped before test discovery with `listen EPERM` while creating its IPC pipe. The final successful invocation kept the exact pnpm command and package-script arguments but used a process-local exported `tsx` shell function that executes Node's equivalent no-IPC loader:

```bash
node --import tsx --test "src/**/*.spec.ts"
```

No repository script, dependency, test, or configuration was changed for this runner workaround.

## Could not do

- The installed `tsx` CLI's IPC wrapper itself cannot run inside this sandbox because socket listening is prohibited. No tests were skipped: the same 416-test glob ran through the equivalent loader and all passed.

---

## Independent verification (main thread, 2026-07-28)

Exact package scripts outside the Codex sandbox: typecheck **pass**, test **416/416 pass**.

Spot-checks: `Fragment` imported and keyed correctly; the active ring is a standalone `cx` argument
(applies independently of done/attention — the core fix); helper strip carries `ขั้นที่ {stepIndex+1}`;
reject buttons 3 → 3 with identical gates/handlers; void button byte-identical.

A 3-lens adversarial workflow audit (footer parity / stepper parity / regression hunt, findings
cross-verified) confirmed parity on all 14 footer buttons, `goToStep` + save-on-leave untouched,
`hidden` panels and `navChips` byte-identical, no DOM-nesting or key issues, and narrow-viewport
math safe at 320px.

**One defect found and fixed in the main thread — a spec defect, not implementation drift:** the
handoff's own snippet used `border-warning-300`, a token that does not exist (warning scale is
50/100/500/600/700), so the attention circle's border silently fell back to `currentColor`. Two
audit lenses found it independently; fixed to `border-warning-500`; typecheck + 416/416 re-run green.

**Pre-existing, out of scope:** `border-warning-200` at `ExpensesPages.tsx:658` has the same
dead-token problem but predates this round. Left for a future pass.

### Not verified
- No visual check — the new wizard bar, helper strip, and footer zones have not been seen rendered.
