# Results: dup-toast-reject-validation-round9

Status: Complete

## Files touched

- `apps/web/src/features/expenses/ExpensesPages.tsx`
  - Added the local auto-dismiss action toast as a sibling of the detail modal.
  - Added the dedicated duplicate-check handler and switched only the two duplicate-check buttons to it.
  - Kept existing detail content mounted during background refreshes.
  - Sanitized and capped the shared reject/void reason, added its counter, and changed its confirm button to green.
- `apps/web/src/common/forms/sanitize.ts`
  - Added `REASON_MAX_LENGTH` and `sanitizeReasonInput`, with `stripDisallowed` applied before the allowlist and 500-character cap.
- `apps/web/src/common/forms/sanitize.spec.ts`
  - Added coverage for allowed Thai/English text, finance punctuation, disallowed characters, backslashes/control characters, and the post-strip cap.
- `apps/web/src/common/i18n/workspace-dictionary.ts`
  - Added `expenses.dup_check_none` and `expenses.dup_check_found` to both Thai and English blocks.
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
  - Applied the same reason sanitizer, cap, and counter to `RejectDialog`.
- `docs/agent-memory/dup-toast-reject-validation-round9.results.md`
  - Recorded scope and verification evidence.

Pre-existing unrelated worktree changes were preserved.

## Constraint confirmations

- Both duplicate-check button call sites use `onClick={checkDuplicates}`.
- There are exactly two such button call sites and no remaining duplicate-check button wrapped in `doAction`.
- `doAction` itself is unchanged.
- Every other footer button retains its existing handler, condition, and disabled state.
- The placeholder guard is exactly `if (loading && !detail)`.
- `ActionToast` has `aria-live="polite"`, auto-dismisses after 4000 ms, uses `z-[100000]`, and renders as a sibling of the detail modal.
- Thai dictionary:
  - `expenses.dup_check_none`: `ไม่มีรายการซ้ำ`
  - `expenses.dup_check_found`: `พบรายการที่อาจซ้ำ {count} รายการ`
- English dictionary:
  - `expenses.dup_check_none`: `No duplicates found`
  - `expenses.dup_check_found`: `Found {count} possible duplicates`
- Reject/void payloads still submit `reason.trim()`, and the existing submit-time `findForbiddenChars` check remains.
- The cancel button remains `ghostClass`; only the expense reject/void confirm button changed to `successBtn` with `successBtnStyle`.

## Verification

### Typecheck

Command:

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
```

Output:

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Exit code: `0`

### Lint

Command:

```bash
corepack pnpm --filter @watchdog-bms/web lint
```

Output:

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Exit code: `0`

### Test

Command:

```bash
corepack pnpm --filter @watchdog-bms/web test
```

The direct first invocation could not start the test runner because this restricted sandbox rejects
the Unix socket opened by the `tsx` CLI:

```text
Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/99986.pipe
```

Redirecting `TMPDIR` to `/tmp` produced the same sandbox-only `listen EPERM`. The same package test
command was then run with an in-memory `NODE_OPTIONS` preload that no-ops only the `tsx` parent
process's unused IPC listener. It did not change repository files, test discovery, or test behavior.
The full suite completed with:

```text
ℹ tests 424
ℹ suites 111
ℹ pass 424
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 867.342458
```

Exit code: `0`

Focused sanitizer verification also passed:

```text
tests 8
suites 2
pass 8
fail 0
```

## Final checks

```text
doAction: unchanged from HEAD
duplicate handler button count: 2
legacy duplicate doAction button count: 0
loading guard count: 1
Thai dictionary keys: 2
English dictionary keys: 2
git diff --check: clean
```

Anything not completed: None.

---

## Independent verification (main thread, 2026-07-28)

Exact package scripts: typecheck **pass**, test **424/424 pass** (420 → 424: new sanitize cases).

Structural checks: both duplicate-check buttons call `checkDuplicates`; `doAction` byte-identical;
placeholder guard is `loading && !detail`; toast is a Modal sibling with `aria-live` at `z-[100000]`;
dictionary keys present in both locales; confirm button is `successBtn`+`successBtnStyle`
(user-decided green); reimbursements `RejectDialog` wired to the same sanitizer.

**Sanitizer proven by execution**, not code reading: Thai incl. tone marks + Thai numerals pass
through; every allowlisted finance symbol survives (`฿ $ % , . ( ) : ; ' " & @ _ = * # / -`);
backslashes (single/double/mid-word), `<script>` angle brackets, and emoji are stripped; newlines
kept; 600-char input caps at exactly 500; the cap applies **after** stripping (500×`a\` → 500 clean
chars, not 250). Em-dash `—` is stripped (not in the allowlist) — regular `-` is the supported dash.

### Not verified
- Visual: the toast, the green confirm, and the counter have not been seen rendered.
