# Handoff: dup-toast-reject-validation-round9 (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `apps/web/src/common/forms/sanitize.ts` (+ co-located `sanitize.spec.ts` — create if absent, extend if present)
- `apps/web/src/common/i18n/workspace-dictionary.ts` (new keys in **both** `th` and `en`)
- `apps/web/src/features/reimbursements/RejectDialog` inside `ReimbursementsPages.tsx` (section C3 only)
- `docs/agent-memory/dup-toast-reject-validation-round9.results.md` (your report)

No API changes, no new dependency, no new file besides the spec.

## Diagnosis (verified in the main thread)

- `runDuplicateCheck` already returns `{ candidatesCreated: number }`
  (`expenses.api.ts:209`, use-case returns `matches.length`) — the data for the toast exists; the UI
  just discards it (`doAction(() => runDuplicateCheck(…))`).
- **The flicker**: `load()` sets `loading=true` on every call and `if (loading)` (~L990) swaps the
  whole modal for a "กำลังโหลด" placeholder — so every footer action blanks and re-mounts the popup.
- The reject/void inline dialog (~L1443–L1462) shares one `reason` textarea for both actions;
  confirm is `dangerClass`; sanitation is `stripDisallowed` (strips `\` + control chars) plus a
  submit-time `findForbiddenChars` check; no length cap, no charset restriction.

---

## A. Toast + no-blank refresh

### A1. Local toast (no toast infra exists — keep it in-file, house style)

In `ExpensesPages.tsx` add a small local component + state in `ExpenseDetailModal`:

```tsx
type ToastState = { tone: 'success' | 'warning'; message: string } | null;

function ActionToast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[100000] flex justify-center px-4">
      <div className={cx('pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-lg',
        toast.tone === 'success' ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-warning-100 bg-warning-50 text-warning-700')}>
        {toast.tone === 'success' ? '✓' : '⚠'} {toast.message}
      </div>
    </div>
  );
}
```

`z-[100000]` floats above the `Modal` portal (`z-[99999]`). Render `<ActionToast toast={toast}
onDone={() => setToast(null)} />` as a **sibling** of the detail `Modal` (next to the preview modal),
so closing the modal does not orphan it.

### A2. Dedicated duplicate-check handler

Replace **both** `doAction(() => runDuplicateCheck(companyId, expenseId))` call sites (~L1127 review
step, ~L1150 isConfirmed) with one handler:

```ts
const checkDuplicates = async () => {
  setActionLoading(true); setError(null);
  try {
    const { candidatesCreated } = await runDuplicateCheck(companyId, expenseId);
    await load(); onRefresh();
    setToast(candidatesCreated === 0
      ? { tone: 'success', message: t('expenses.dup_check_none', locale) }
      : { tone: 'warning', message: t('expenses.dup_check_found', locale).replace('{count}', String(candidatesCreated)) });
  } catch (e) { setError(err(e)); }
  finally { setActionLoading(false); }
};
```

Same order as `doAction` (load → onRefresh) so nothing else changes. Buttons keep their
conditions/`disabled`; only `onClick` switches to `checkDuplicates`.

### A3. Kill the blank-flash on refresh

Change the placeholder guard so only the **first** load (no data yet) blanks the modal:

```ts
if (loading && !detail) { …existing placeholder Modal… }
```

Background refreshes (`doAction`, `checkDuplicates`, step saves) keep the current content rendered;
`actionLoading` already disables the buttons meanwhile. Do not add any other loading UI.

### A4. Dictionary keys (both `th` and `en` blocks)

```
'expenses.dup_check_none':  'ไม่มีรายการซ้ำ'                     / 'No duplicates found'
'expenses.dup_check_found': 'พบรายการที่อาจซ้ำ {count} รายการ'   / 'Found {count} possible duplicates'
```

`{count}` via `.replace('{count}', …)` — same pattern as `common.forbidden_chars`'s `{chars}`.

## B. Reject/void confirm button → green

In the inline dialog (~L1452): confirm changes `dangerClass` → `successBtn` + `style={successBtnStyle}`.
Same handler, same `disabled={actionLoading || !reason.trim()}`. *(User decision 2026-07-28: the
confirm in this flow must be green.)* Both imports already exist in the file. The ยกเลิก button stays
`ghostClass`.

## C. Reason validation — ≤500 chars, finance-symbol allowlist, `\` stripped

### C1. Pure helper in `sanitize.ts`

```ts
/**
 * Reject/void reasons: Thai and English letters, digits, whitespace, and common
 * finance/accounting punctuation only. Backslash and control characters are always
 * stripped (they are unsafe for downstream storage); everything else outside the
 * allowlist is dropped as it is typed. Hard cap 500 characters.
 */
export const REASON_MAX_LENGTH = 500;
const REASON_DISALLOWED = /[^฀-๿a-zA-Z0-9\s.,\-+/()%#:;'"&@_=*฿$€£¥]/g;

export function sanitizeReasonInput(value: string): string {
  return stripDisallowed(value).replace(REASON_DISALLOWED, '').slice(0, REASON_MAX_LENGTH);
}
```

Notes: `฀-๿` covers Thai letters, vowels, tone marks and Thai numerals; `\s` keeps
newlines (it is a textarea); `stripDisallowed` already removes `\` and control chars first.

### C2. Wire into the expense dialog

- Textarea: `onChange={(e) => setReason(sanitizeReasonInput(e.target.value))}` and
  `maxLength={REASON_MAX_LENGTH}`.
- Add a counter under the textarea, right-aligned:
  `<div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>`
- Keep the existing submit-time `findForbiddenChars` check as belt-and-braces (it can no longer
  fire, but it guards future regressions). Applies to both reject **and** void — they share the field.

### C3. Same sanitizer in the reimbursements `RejectDialog`

`ReimbursementsPages.tssx`'s `RejectDialog` textarea currently sets raw input. Same DB-safety
rationale → `onChange={e => setReason(sanitizeReasonInput(e.target.value))}`,
`maxLength={REASON_MAX_LENGTH}`, same counter line (hardcoded Thai in that feature — no `t()`).
Import from `@/common/forms/sanitize`. Nothing else in that dialog changes.

### C4. Tests (`sanitize.spec.ts`, node:test style)

1. Passes through Thai (incl. ๐-๙ and tone marks), English, digits, spaces and newlines unchanged.
2. Keeps every allowlisted finance symbol: `. , - + / ( ) % # : ; ' " & @ _ = * ฿ $ € £ ¥`.
3. Strips `\` (single and repeated, mid-word), `< > { } | ^ ` `, emoji, and control chars.
4. Caps at exactly 500 (501-char input → 500) and the cap applies **after** stripping.
5. Existing `stripDisallowed` / `findForbiddenChars` behaviour still covered (add cases if the spec
   file is new).

## Constraints

- Shortest correct diff. No behaviour change beyond what is specified — every footer button keeps
  its condition/handler/disabled; `doAction` itself is untouched; step logic untouched.
- `rejectExpense` / `voidExpense` payloads unchanged (`reason.trim()`).
- Do not weaken or delete existing tests.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

## Report back

Write `docs/agent-memory/dup-toast-reject-validation-round9.results.md` with: files touched and why;
confirmation both duplicate-check call sites use the new handler and `doAction` is untouched;
confirmation the placeholder guard is `loading && !detail`; the dictionary keys added (th+en);
verification output (real); anything you could not do and why.
