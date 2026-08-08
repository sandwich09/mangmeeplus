# Agent Memory: global-toast-feedback

Status: CODEX PHASE D COMPLETE LOCALLY (2026-08-08); PHASES A-C WERE ALREADY
COMPLETE AND VERIFIED AT KICKOFF; HOST E2E/COMMIT PENDING. Earlier, owner asked for
(1) toast moved to top-center with the
pastel tones kept and a more finished pill design, (2) loading indicators on
every page. Both are specced and handed to Codex:
`docs/plans/toast-topcenter-loading-plan.md` (design authority; §3 tables come
from a full 2026-08-08 loading audit) and
`docs/plans/toast-topcenter-loading-codex-handoff.md` (phases A–D). The audit's
duplicate-record risk in `AccountingPages.tsx` and blank workflow modal loads
are now closed by Phases B-C. Loading copy still splits `...` vs `…`; Phase D
normalizes on ASCII `...`. Earlier: PHASE 7 closed the silent-success and missing-in-flight-state
gaps that survived phases 1-6; local typecheck/lint/unit/build gates pass
(755/755). PHASE 6 COMPLETE LOCALLY — all 6 phases implemented. Its named stale E2E assertions were refreshed
but E2E was not run. The e2e toast spec remains
2/2 passed on the real stack (2026-08-07). Host e2e note: DB was behind
`20260807100000_substitute_receipt_payee_identity`; migrate deploy +
generate + reseed fixed preflight; ran with API_PORT=3101 WEB_PORT=3100
because :3000/:3001 were held by ssh tunnels; no zombie servers left.
Commits: ac0ae6d0 (P1), fc2fff1e (P2), e265ef42 (P3), P4 head.
Owner: Claude (harness) + Codex gpt-5.6-sol xhigh (executor)
Scope: Global toast system (success pastel-green / warning pastel-yellow /
error pastel-red) + wiring every mutation action across all 24 web feature
modules + Phase 5 themed input prompts, missing confirms, and PO approval rule
editing + Phase 6 cross-parent sidebar active-state correction and stale E2E
spec refresh. Design: `docs/plans/global-toast-feedback-plan.md`. Execution:
`docs/plans/global-toast-feedback-codex-handoff.md`. Thai summary:
`Doc/global-toast-feedback-summary-th.md` (repo-external Doc/).

Decisions:
- No new dependency; hand-rolled provider modeled on expenses `ActionToast`.
- Root-layout mount (covers /system/*, /login, workspace branches).
- Automatic error toasts at `authedApiFetch` seam (mutating methods only,
  `suppressErrorToast` opt-out); call sites never call `toast.error` for API
  failures; inline ErrorBanners stay.
- Success toasts wired per site/helper; redirect flows, pure-client closes,
  and auto-save-on-blur do NOT toast.
- API failure handling remains at the mutation seam; Phase 5 adds no
  `toast.error` call sites.
- `useInputPrompt` mirrors `useConfirm`: every close path settles, required
  input is trimmed, and destructive prompts default to the danger action.
- PO approval row metadata is derived from live rule bounds/roles; add/remove
  operations split or re-stitch the contiguous tiers and keep one open-ended
  final tier.
- Sidebar sub-item active state resolves the longest matching href across all
  submenu parents; `/settings/line-oa` remains under the roles parent.
- Tones: success `border-brand-100 bg-success-50 text-success-700`; warning
  `border-warning-100 bg-warning-50 text-warning-700`; error
  `border-error-500/20 bg-error-50 text-error-700` (no success-100/error-100
  registered in @theme — do not use them).
- Out of scope: window.prompt replacement, missing confirm dialogs,
  optimistic-rollback in notifications, dead buttons/modules.

Open questions: none blocking.

Artifacts:
- Audit (2026-08-07, 5 parallel surveys): ~287 mutation actions, ~182 silent
  (63%); 4 duplicate local toasts; 11 error-swallowing sites; per-module
  file:line inventory embedded in the two plan docs.
- Baseline repair: `web-core-workspace.spec.ts:522` failed because
  `packages/contracts/dist` was stale after commit 3bf1801f; fixed by
  `corepack pnpm --filter @watchdog-bms/contracts build` → 740/740 green.
- Phase 1: framework-free toast bus; global provider/pill/hook/queue; root
  layout mount; mutating `authedApiFetch` error seam with opt-out; four legacy
  local toast implementations migrated; local-toast source guard added.
- Phase 2: finance success/warning rollout across expenses, reimbursements,
  accounts payable, accounting documents/tax setup, tax, banking, and ledger;
  shared action helpers accept optional success copy; AP tone-less messages are
  error-only; zero-row expense exports warn; redirects, partial-result panels,
  and blur/change auto-saves remain silent.
- Phase 3: ops + CRM success/warning rollout across inventory, procurement,
  reports, workflow, CRM, CRM Inbox/LINE OA, AI suggestions, and dashboard
  notifications; inventory feedback-adjacent bugs and report object-URL revoke
  timing fixed; redirect, auto-save, composer bubble, and explicit done-panel
  exceptions remain silent.
- Phase 4: branch create/edit, employee activation/deactivation, and role
  create/update/disable success toasts; discount/PO policy inline API error
  mapping; onboarding clipboard rejection handling; system-partner mutation
  sweep (no missing success feedback, password reveal remains silent); flat
  `e2e/toast-feedback.spec.ts` authored without execution.
- Phase 5: migrated all prompts in the handoff's live file list to the shared
  themed hook; added close-period, tax-retire, workflow-cancel confirms; made
  accounting reject/void collect Thai reasons; wired PO add/remove buttons,
  variable-rule metadata, clean load state, and the live-rule simulator.
- Phase 6: fixed cross-parent submenu prefix matching; removed the dead
  `security` settings-sidebar key; refreshed SET-01, SET-03A, SET-07, and
  NAV-02 to current intended behavior without moving menu entries.
- Phase 7 (2026-08-08, re-audit after a user report that save feedback never
  appeared): the Phase 4 claim that employee activation/deactivation and role
  create/update/disable were toast-wired did NOT match the tree —
  `EmployeeAccessPages.tsx` contained zero `useToast`. Fixed there by giving the
  existing `run(key, fn)` helper an optional `done` message (credential handoff
  and LINE QR stay silent — both already render a result panel) and wiring
  RoleBuilder create/update plus `disableRole`, which also gained its first
  in-flight state. Same helper-parameter shape applied to
  `IndividualPermissionsPrototypePage`'s `withBusy`.
- Phase 7 also toasted: discount policy, PO approval policy, substitute-receipt
  policy, reimbursement policy, AP approval policy, LINE OA auto-reply + SLA
  policy, CRM booking buffer, and the account-security AI toggle. Where a
  persistent inline success banner existed (AP `message`, reimbursement `saved`,
  LINE OA `notice` ×2), the banner and its state were DELETED rather than
  double-reporting alongside the toast; inline ErrorBanners stay.
- Phase 7 in-flight states added where a mutation button was freely
  double-clickable: discount policy, PO approval, bank account create, bank
  adjustment create, product update/barcode/QR, report save-view + CSV export.
- Phase 7 confirmed-silent by design (not bugs): redirect flows
  (`ReimbursementCreatePage`), wizard step advances (`AddEmployeePrototypePage`
  `submitDraft` — `completeEmployee` toasts at the end), and explicit
  done-panels carrying counts a toast cannot (`ChartOfAccountsSettingsPage`
  `applyTemplate`, employee credential handoff, LINE QR).
- There is no `loading` toast tone and none is planned: `ToastTone` is
  `success | warning | error`. In-flight feedback belongs on the button.
- Codex Phase B added initial-load coverage across accounting documents,
  accounts payable, banking, CRM, employee onboarding, expenses, tax, and
  workflow. Fake empty/default states now wait for resolved data; async selects
  expose disabled loading options; workflow modal frames open immediately with
  a loading body. Phase A toast components were left untouched.
- Codex Phase C added shared mutation guards at every named §3.2 gap: accounting
  document/payment/counterparty actions, reconciliation and inventory-location
  creation, tax filing/report/evidence/profile actions, expense category and
  signature actions, notification actions/rules/quiet-hours saves, CRM inbox
  actions, workflow rule testing, role disable, and report history/download.
  Every added busy state clears in `finally`; Phase B loading branches and toast
  components were left untouched.
- Codex Phase D upgraded 44 definite page/panel/table/form loading bodies across
  18 feature files to the shared `LoadingState`; inline table rows, select
  options, chips, additive status lines, and preserved-content refetch slots
  kept their existing structure. It also normalized 71 Thai in-flight labels
  from U+2026 to ASCII `...` across 18 feature files and translated the four
  current accounting-document `Loading...`/`Saving...` holdouts. Phase A toast
  components and the deliberate `system-partners` skeletons were untouched.
- Naming trap for future audits: most `*PrototypePage` files call real APIs.
  Only `crm/BroadcastPrototypePage.tsx` and
  `mangmee-prototype/MangmeeModulePrototypePage.tsx` are local-state mocks — the
  broadcast one renders a fake success line and can never toast.
- The Phase 5 survey count drifted: the enumerated live files contain 14
  prompt-gated buttons / 15 prompt calls, not 13 / 14. All enumerated live
  calls were migrated. Four prompts remain only in the explicitly out-of-scope
  unmounted `crm-inbox/InboxPage.tsx`.

Verification:
- Host gates per phase: `corepack pnpm --filter @watchdog-bms/web typecheck`;
  `cd apps/web && CI=true npx tsx --test "src/**/*.spec.ts"` (740 baseline,
  0 fail); `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`.
- e2e `toast-feedback.spec.ts` authored in Phase 4, run host-side only
  (NOTE: :3000/:3001 currently held by ssh tunnels — check before e2e).
- Phase 1 gate: typecheck passed; `CI=true node --import tsx --test
  "src/**/*.spec.ts"` passed 750/750 (approved fallback because `npx tsx`
  IPC listen is sandbox-blocked); webpack build compiled and generated all
  routes; generated CSS contains the 20% `border-error-500/20` color mix.
- Phase 2 gate: typecheck passed; exact `CI=true npx tsx --test
  "src/**/*.spec.ts"` was sandbox-blocked by the same IPC `EPERM`, approved
  `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback passed
  750/750; webpack build compiled and generated all routes.
- Phase 3 gate: typecheck passed; exact `CI=true npx tsx --test
  "src/**/*.spec.ts"` was sandbox-blocked by the same IPC `EPERM`, approved
  `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback passed
  750/750; webpack build compiled successfully and generated all routes.
- Phase 4 gate: typecheck passed; exact `CI=true npx tsx --test
  "src/**/*.spec.ts"` was sandbox-blocked by the same IPC `EPERM`, approved
  `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback passed
  750/750; webpack build compiled successfully and generated all routes.
- Phase 4 sweep: `no-local-toast.spec.ts` passed; zero
  `setTimeout(() => setToast` drivers remain. E2E was not run per handoff.
- Phase 5: `corepack pnpm --filter @watchdog-bms/web typecheck` passed;
  exact `CI=true npx tsx --test "src/**/*.spec.ts"` hit the known sandbox
  tsx IPC `listen EPERM`, then `CI=true node --import tsx --test
  "src/**/*.spec.ts"` passed 753/753; webpack build compiled and generated all
  routes; explicit PO model spec passed 5/5.
- Phase 6: focused sidebar/settings specs passed 9/9; typecheck passed; exact
  `CI=true npx tsx --test "src/**/*.spec.ts"` hit the known sandbox tsx IPC
  `listen EPERM`, then `CI=true node --import tsx --test "src/**/*.spec.ts"`
  passed 754/754; webpack build compiled and generated all routes. E2E was not
  run per the environment contract.

- Phase 7 gate (2026-08-08): `corepack pnpm --filter @watchdog-bms/contracts
  build` was required first (fresh clone had no `node_modules` and a stale
  `contracts/dist`, same failure mode as the Phase 0 baseline repair);
  then `corepack pnpm --filter @watchdog-bms/web typecheck` passed, `lint`
  passed, `CI=true npx tsx --test "src/**/*.spec.ts"` passed 755/755 (the tsx
  IPC `EPERM` sandbox issue did not reproduce on this host), and
  `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` compiled
  and generated all routes. E2E not run.
- Codex Phase B gate (2026-08-08): web typecheck passed; exact `CI=true npx tsx
  --test "src/**/*.spec.ts"` hit the documented IPC `listen EPERM`, then the
  prescribed `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback
  passed 756/756; webpack build compiled and generated all routes. E2E was not
  run per the environment contract.
- Codex Phase C gate (2026-08-08): web typecheck passed; exact `CI=true npx tsx
  --test "src/**/*.spec.ts"` hit the documented IPC `listen EPERM`, then the
  prescribed `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback
  passed 756/756; webpack build compiled successfully and generated 11/11
  static pages. E2E was not run per the environment contract.
- Codex Phase D gate (2026-08-08): web typecheck passed; exact `CI=true npx tsx
  --test "src/**/*.spec.ts"` hit the documented IPC `listen EPERM`, then the
  prescribed `CI=true node --import tsx --test "src/**/*.spec.ts"` fallback
  passed 756/756; webpack build compiled successfully and generated 11/11
  static pages. The mandated U+2026 loading/saving grep returned zero rows,
  `git diff --check` passed, and the protected Phase A aggregate diff hash
  remained `b37b4d788543792f0dddde3186a2c8c5230aa881eb77018361d176bb6c8a54a7`.
  E2E was not run per the environment contract.

Next:
- [x] Phase 1 foundation (Codex) → host gate → commit
- [x] Phase 2 finance rollout (Codex) → host gate → commit
- [x] Phase 3 ops+CRM rollout → host gate → commit
- [x] Phase 4 auth/settings/system + e2e spec → local gate
- [x] Phase 5 themed prompts + confirms + PO settings → local gate
- [x] Phase 6 sidebar active-state + stale E2E refresh → local gate
- [x] Phase 7 silent-success + missing in-flight-state sweep → local gate
- [x] Toast v2 + global-loading plan + Codex handoff docs authored (2026-08-08)
- [x] Codex Phase A (toast top-center redesign) → gate (complete before this execution)
- [x] Codex Phase B (initial-load gaps) → gate
- [x] Codex Phase C (mutation busy gaps — AccountingPages `run` is the core) → gate
- [x] Codex Phase D (LoadingState standardization + ellipsis copy sweep) → gate
- [ ] Host E2E run → commit
