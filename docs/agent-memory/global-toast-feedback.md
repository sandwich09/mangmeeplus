# Agent Memory: global-toast-feedback

Status: PHASE 6 COMPLETE LOCALLY — all 6 phases implemented; the Phase 6 local
typecheck/unit/build gates pass. Its named stale E2E assertions were refreshed
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

Next:
- [x] Phase 1 foundation (Codex) → host gate → commit
- [x] Phase 2 finance rollout (Codex) → host gate → commit
- [x] Phase 3 ops+CRM rollout → host gate → commit
- [x] Phase 4 auth/settings/system + e2e spec → local gate
- [x] Phase 5 themed prompts + confirms + PO settings → local gate
- [x] Phase 6 sidebar active-state + stale E2E refresh → local gate
- [ ] Host E2E run → commit
