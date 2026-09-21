# Agent Memory: settings usability polish

Status: Complete
Owner: Codex
Scope: Branch package-limit error, Thai address autofill, personal-signature navigation, sidebar hover/route scrolling, and customer-facing expiry notification wording.
Decisions:
- Return a stable `plan_branch_limit_exceeded` API code with bounded capacity details; Thai UI copy says the package capacity is full instead of reporting an unsupported screen payload.
- Reuse `ThaiAddressMaster`: postal code lookup, unique-value autofill, cascading choices when ambiguous, and manual fallback when no master row is available. The shared catalog read also permits company-profile readers/editors.
- Keep the existing personal-signature route, data, and permission boundary. Remove its permanent Expenses submenu entry and link to it from the personal account area; contextual signing links remain unchanged.
- A hover-expanded collapsed sidebar overlays content. Main-content margin follows only the pinned expanded state. Route changes reveal an active item only when it is outside the scroll viewport and do not force-centre it repeatedly.
- Keep notification severity keys unchanged. Customer copy uses `สำคัญ` instead of `วิกฤต`, and plan-term notices say `แพ็กเกจใกล้หมดอายุ` / `แพ็กเกจหมดอายุแล้ว`.
- After the main/develop sync, compare all 189 paths captured by the safety stash against both the
  new main and the active working tree. Keep newer main implementations for billing, auth, AI, and
  closed signup flows; port the expiry wording into the new shared Web and LINE card seams instead
  of restoring older whole files.
- Clean the post-merge working tree by recency and implementation state: restore 20 tracked docs
  whose local copies predated the current main evidence, and remove 11 untracked docs that were
  superseded or recorded unresolved work outside the accepted scope. Both safety stashes remain.
- Keep the current-main `ExpenseReviewPage` implementation and port only the cancelled-certificate
  confirmation rule onto it; do not retain the older whole-file version from the backup.
Open questions: None.
Artifacts: This memory plus the scoped API/web/worker changes and focused tests.
Verification:
- Final focused Web behavior/render tests: 373/373 passed.
- Final focused API branch/plan-term/notification tests: 71/71 passed.
- Contracts expense-evidence tests: 11/11 passed.
- Worker notification tests: 5/5 passed (460 focused tests total).
- Contracts build and Web, API, and worker typechecks passed.
- `git diff --check` passed.
- Authenticated browser UAT was not run because no local runtime was started for this task.
- Post-merge stash audit initially found 53 paths using the main version. After porting the three
  expiry-copy paths into the new main architecture, the final split is 71 active-exact, 48 already
  in main, 50 intentionally using main, and 20 active merged paths; no stash-only file is missing.
  The recovered expiry-copy slice passed 72 API/LINE tests and 20 Web tests; contracts build plus
  API/Web typechecks passed.
- Cleanup reduced the working tree from 97 to 66 paths: 55 tracked implementation/docs changes and
  11 current untracked files. Removed material remains recoverable from
  `stash@{0}` (`codex-pre-unstaged-clean-20260921`); the original merge backup remains at
  `stash@{1}` (`codex-pre-main-develop-sync-20260921`).
- Exact-main CI `35623421180` exposed two stale expectations after the final direct commit: the
  shared address catalog now intentionally permits company-profile readers/editors, and
  `tax_profile_incomplete` now names the tax settings set instead of the old generic profile. The
  expectations were aligned without changing runtime behavior; the two focused suites passed 51/51.
  Exact replacement CI is required before release.
Next: Run exact replacement CI, then prepare and release the accepted main source to UAT.
