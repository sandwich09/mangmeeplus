# Results: reimbursements-ui-fixes-round2

Status: Sections A, B, and C implemented and verified. Typecheck and lint pass. The complete web test
suite passes 392/392 through the IPC-free `tsx` loader path; the repository's exact `test` script is
blocked by the managed sandbox before test discovery because the `tsx` CLI cannot open its local IPC
socket.

## Files touched

- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` — threaded roles into tab
  visibility, added mounted collapsible request lines with pre-validation expansion, and regrouped
  the existing policy controls into the two-column layout and live summary rail.
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` — narrowed the policy tab to
  permission plus `OWNER`/`ADMIN`, with `roles` defaulting to `[]`.
- `apps/web/src/features/reimbursements/reimbursements.logic.spec.ts` — added the specified
  owner/admin/custom-role/empty-role/missing-permission coverage and retained omitted-role coverage.
- `apps/web/app/(workspace)/companies/[companyId]/reimbursements/page.tsx` — passes session role keys
  to the reimbursement hub.
- `docs/agent-memory/reimbursements-ui-fixes-round2.results.md` — records implementation and
  verification evidence.

No API, Prisma, contract, dependency, or new component file changed. The pre-existing dirty worktree
was preserved. The stale generated Prisma client was not touched.

## Implementation confirmation

- The policy tab still requires `reimbursement.policy.manage`; `OWNER`/`ADMIN` is an additional UI
  narrowing, never a replacement permission check. A caller that omits `roles` still compiles and
  safely hides the tab.
- Collapsed line fields stay mounted. Only their existing fields grid receives the `hidden` class;
  no input or `required` constraint is conditionally rendered.
- The create-form submit button clears `collapsedLines` in `onClick`. A submit-button click runs
  before the browser's native constraint validation, so a collapsed invalid field becomes visible
  and focusable before validation tries to focus it. No `required` attribute or
  `validateRequestForm` call changed.
- Collapse state is cleared after successful creation, partial attachment failure, the outer form
  toggle, and the inner cancel action. A newly added line is explicitly marked expanded, including
  when a deleted line left a stale numeric key.
- The policy form still contains exactly these nine settings:
  `approvalRequiredFromAmount`, `approverMode`, `defaultApproverRole`, `allowSelfApproval`,
  `requireReceipt`, `allowMissingReceiptWithReason`, `duplicatePolicy`, `financeReviewRequired`, and
  `slaHours`. No setting was added, removed, or renamed.
- `updateReimbursementPolicy` receives the same nine-field payload with the same `slaHours`
  conversion. The form still has exactly one submit button.

## Round-1 invariant review

1. `visibleHubTabs` still feeds `parseHubTab`; only the specified permission-plus-role policy
   narrowing changed. The initial-tab-only rule remains unchanged.
2. `?focus=<requestId>` still calls `openDetail`.
3. The drawer Escape guard remains the round-1 expression, including the required `rejecting`
   top-layer guard.
4. Claim preview, signature, payment, and rejection dialogs remain siblings of `DetailDrawer`.
5. The drawer still starts at `top-[68px]`.
6. `drawerAction` still runs the mutation, reloads `getReimbursement`, and increments `refreshKey`;
   queue effects still reload from `refreshKey`.
7. `approvalSnapshotHash` and `claimSignatureAckHash` still come from the same request objects.
8. `isDraft`, `canApprove`, `canFinanceApprove`, `canPay`, `signableRoles`, and
   `canAttachSignedCopy` retain their expressions and action visibility.
9. `handleCreate` line mapping, create payload, receipt upload flow, and the partial-failure
   `บันทึกร่างแล้ว แต่แนบไฟล์ไม่สำเร็จ: …` branch are unchanged; only collapse-state cleanup was
   added beside existing form resets.
10. `validateRequestForm` and `validatePaymentForm` remain at the same points with the same inputs.
11. The zero-tabs guard still returns before `queueProps` and every queue render.

An independent read-only audit found and prompted the stale deleted-index/new-line fix, then reported
no remaining Section A–C or round-1 invariant defects.

## Verification

### Typecheck

Command:

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
```

Real output (exit 0):

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

Real output (exit 0):

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Test command from the handoff

Command:

```bash
corepack pnpm --filter @watchdog-bms/web test
```

Real output (exit 1 before test discovery):

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/82169.pipe
    at Server.setupListenHandle [as _listen2] (node:net:1926:21)
    at listenInCluster (node:net:2005:12)
    at Server.listen (node:net:2127:5)
    at file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31537
    at new Promise (<anonymous>)
    at createIpcServer (file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31515)
    at async file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:55:459 {
  code: 'EPERM',
  errno: -1,
  syscall: 'listen',
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/82169.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

This is the same managed-sandbox `tsx` IPC restriction already recorded for round 1. It occurs
before any test or application file is imported. The IPC-free equivalent ran the same glob and
complete suite:

```bash
corepack pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"
```

Real output summary (exit 0):

```text
ℹ tests 392
ℹ suites 105
ℹ pass 392
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 819.81875
```

The full run includes every new `visibleHubTabs` role case. The line-summary helper remains local, so
the handoff's conditional exported-helper tests do not apply.

### Diff hygiene

Command:

```bash
git diff --check -- apps/web/src/features/reimbursements/ReimbursementsPages.tsx \
  apps/web/src/features/reimbursements/reimbursements.logic.ts \
  apps/web/src/features/reimbursements/reimbursements.logic.spec.ts \
  'apps/web/app/(workspace)/companies/[companyId]/reimbursements/page.tsx'
```

Real output (exit 0): no output.

## Could not perform

- The exact package `test` script cannot bind the `tsx` IPC socket in this managed sandbox. No test
  failed: the complete IPC-free run passed 392/392.

---

## Independent verification (main thread, 2026-07-28)

Run outside the Codex sandbox, so the **exact** package scripts were used (no `tsx` IPC workaround):

| Command | Result |
|---|---|
| `corepack pnpm --filter @watchdog-bms/web typecheck` | pass |
| `corepack pnpm --filter @watchdog-bms/web lint` | pass (same script as typecheck in this package) |
| `corepack pnpm --filter @watchdog-bms/web test` | **392 pass / 0 fail** (388 → 392, i.e. 4 new) |

Mechanical checks:

- **Policy payload** — `updateReimbursementPolicy(companyId, {…})` diffed against `HEAD`: **identical**.
- **Policy settings** — all 9 `form.*` fields present before and after, none added or dropped; only
  layout and grouping changed.
- **API inventory** — 21 functions / 29 call sites, identical counts vs `HEAD`. No drift from round 1.
- **`handleCreate` partial-failure branch** — still present.
- **Role gate (A)** — permission is checked first and independently; the `OWNER`/`ADMIN` role test only
  narrows the `policy` tab. `roles` defaults to `[]`, so a caller omitting it hides the tab (safe
  direction) rather than failing to compile.
- **Collapse state hygiene** — `setCollapsedLines({})` fires on both `emptyForm()` reset paths
  (success and partial-failure), on the show/hide toggle, and on cancel. No stale collapse state.
- **B3** — the collapsible region is `cx('mt-3 grid …', collapsedLines[i] && 'hidden')` on the fields
  wrapper only; the panel stays **mounted**. Header stays visible.
- **B5** — the submit button carries `onClick={() => setCollapsedLines({})}`, and the `<form>` wraps
  **both** grid columns with the submit button inside it (verified by locating the `<form>`/`</form>`
  boundaries around the button).

### Not verified — needs one click-test

**B5's timing is reasoned, not measured.** Three `required` inputs (`วันที่`, `รายการ`, `จำนวนเงิน`) live
inside the collapsible region, and a `required` control under `display:none` makes Chrome log
*"An invalid form control … is not focusable"* and **silently refuse to submit**. The fix relies on
React 19 flushing the discrete `click` update to the DOM before the browser performs the form's default
action. That ordering is sound in principle — default actions run only after event dispatch completes,
and React 19 flushes discrete-priority updates synchronously — but it was **not empirically measured**
here; driving a real browser would have required installing a global CLI and a managed Chrome, which
was out of scope.

**Test this specific interaction:** collapse a line, then press `บันทึกร่าง`.
- Expected: the lines expand and the form submits (or shows normal field validation).
- If instead the button appears to do nothing and the console shows the "not focusable" message, the
  deterministic fix is one line — wrap the handler in `flushSync`:
  `onClick={() => flushSync(() => setCollapsedLines({}))}` (import `flushSync` from `react-dom`).

Also unverified visually: the new policy two-column layout and the collapsed-line summary rendering.
