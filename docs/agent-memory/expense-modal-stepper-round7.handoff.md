# Handoff: expense-modal-stepper-round7 (implementation spec)

Read `AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Goal:** the expense detail modal's guided stepper reads as a real wizard (clear "you are here",
clear done/pending, visible instruction), and the footer separates the destructive action to the left.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/expenses/ExpensesPages.tsx`
- `docs/agent-memory/expense-modal-stepper-round7.results.md` (your report)

No API, no new dependency, no new file, no dictionary changes (all needed keys exist).

## THE HARD CONSTRAINT

The stepper's **behaviour** is settled and user-tested: `goToStep` (with its save-on-leave for the
details step), `deriveExpenseReviewSteps`, `initialExpenseReviewStep`, the `hidden`-not-unmounted step
panels, `stepSaving`, and every footer button's **condition, handler, `disabled` expression and
`title`** must not change. This round changes only presentation and placement.

---

## A. Stepper: chips → wizard progress bar

Replace the guided branch of the chip row (`ExpensesPages.tsx` ~L1332–L1343) — the `steps.map` that
renders pill buttons — with a connected progress bar. The non-guided `navChips` branch stays exactly
as it is.

```tsx
{guided ? (
  <div className="flex w-full items-start">
    {steps.map((entry, index) => {
      const active = step === entry.key;
      return (
        <Fragment key={entry.key}>
          {index > 0 && <div aria-hidden className={cx('mt-4 h-0.5 flex-1',
            steps[index - 1].state === 'done' ? 'bg-brand-300' : 'bg-gray-200')} />}
          <button type="button" disabled={stepSaving} onClick={() => void goToStep(entry.key)}
            aria-current={active ? 'step' : undefined}
            className="group flex w-16 flex-col items-center gap-1 sm:w-24">
            <span className={cx('flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition',
              active && 'ring-4 ring-brand-100',
              entry.state === 'done' ? 'bg-brand-500 text-white'
                : entry.state === 'attention' ? 'bg-warning-50 text-warning-700 border border-warning-300'
                : active ? 'bg-brand-500 text-white'
                : 'border-2 border-gray-300 bg-white text-gray-400 group-hover:border-brand-300')}>
              {entry.state === 'done' ? '✓' : entry.state === 'attention' ? '⚠' : index + 1}
            </span>
            <span className={cx('text-center text-[11px] leading-tight sm:text-xs',
              active ? 'font-bold text-brand-700' : 'font-medium text-gray-500')}>
              {t(STEP_LABEL_KEYS[entry.key], locale)}
            </span>
          </button>
        </Fragment>
      );
    })}
  </div>
) : ( …navChips branch unchanged… )}
```

- Import `Fragment` from react (extend the existing react import).
- The ring (`ring-4 ring-brand-100`) is what marks "you are here" **independently of** done/attention
  state — that ambiguity is the core complaint. A done step that is also active gets ✓ *and* the ring.
- Connectors are brand-tinted once the step before them is done, so completed progress reads as a
  filled line.
- Keep the wrapping `div`'s `sticky top-0 z-10 … border-b bg-white px-4 py-2.5` classes; adjust only
  the inner layout (`flex-wrap gap-1.5` no longer applies to the guided branch).
- Keep `disabled={stepSaving}`, `onClick={() => void goToStep(entry.key)}`, and `aria-current` exactly.

## B. Helper line: make the instruction visible

Replace (~L1350):

```tsx
{guided && <div className="border-b border-gray-100 bg-white px-4 py-2 text-xs font-medium text-gray-500">{t(STEP_HELPER_KEYS[step], locale)}</div>}
```

with an info strip that reads as the current step's instruction:

```tsx
{guided && (
  <div className="border-b border-gray-100 bg-brand-25 px-4 py-2.5 text-sm text-gray-700">
    <span className="font-bold text-brand-700">ขั้นที่ {stepIndex + 1}:</span>{' '}
    {t(STEP_HELPER_KEYS[step], locale)}
  </div>
)}
```

`stepIndex` already exists in scope. No new dictionary keys.

## C. Footer: destructive left, flow right

The footer wrapper (~L1085) is `flex w-full flex-wrap items-center justify-end gap-2`. Restructure to
two zones:

```tsx
<div className="flex w-full flex-wrap items-center gap-2">
  <div className="flex flex-wrap items-center gap-2">…destructive zone…</div>
  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">…flow zone…</div>
</div>
```

Move into the **destructive zone** (left), with `dangerClass`:

1. Guided review step, `status !== 'READY_FOR_CONFIRMATION'` — the ยกเลิกรายการ button (currently
   `ghostClass`, L1102). It becomes `dangerClass` so the destructive action is styled consistently in
   both statuses. Same `caps.canReject` gate, same handler, same `disabled`.
2. Guided review step, `status === 'READY_FOR_CONFIRMATION'` — the ยกเลิกรายการ button (L1108),
   already `dangerClass`.
3. `approverOnlyActions` — its ยกเลิกรายการ button (L1120).
4. `isConfirmed` — the ยกเลิกเอกสาร button (L1127).

Everything else stays in the **flow zone** (right) in its current order: ย้อนกลับ, อ่านเอกสารอีกครั้ง,
ตรวจหารายการซ้ำ, ส่งตรวจ, ยืนยันและลงบัญชี, ถัดไป, ดูสมุดบัญชี, เริ่มตรวจใหม่.

Note the step-review buttons are gated on `step === 'review'` — the destructive zone's guided buttons
keep that same `step === 'review'` gate (the reject button must not appear on other steps; it does not
today).

Every button keeps its exact condition, handler, `disabled` and `title`. This is a placement change
plus one class change (ghost→danger on #1).

## Constraints

- Shortest correct diff. No behaviour change anywhere.
- The non-guided continuous-scroll mode and its `navChips` are untouched.
- Do not weaken or delete existing tests.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

No new unit tests required (presentational). Existing suite must stay green.

## Report back

Write `docs/agent-memory/expense-modal-stepper-round7.results.md` with:

- Files touched; what changed and why.
- Explicit confirmation that every footer button kept its condition/handler/disabled/title, listing
  the one intentional class change (ghost→danger).
- Confirmation `goToStep` / save-on-leave / hidden panels / `navChips` are untouched.
- Verification commands with real output.
- Anything you could not do, with the reason.
