# Agent Memory: LINE OA Message UI Parity

Status: P1-P5 complete and accepted after Claude's host gate rerun and diff review. Lint exit 0; the three
changed specs 73/73. The full suite exits 1 on 3 `feature-launch` real-database failures that are **proven
pre-existing** (reproduced with this diff stashed) — see the final gate section. **Uncommitted** by design;
the working tree carries unrelated pre-existing changes that must not be swept in.
Owner: Claude (harness) / Codex (executor).
Scope: Adopt the owner's LINE OA bot prototype **presentation layer** — Flex greeting bubble with inline
bold, and a receipt-capture card with a dashed drop-zone image — into the existing `line-ai` staff menu.
Cosmetic only: no routing, OCR, persistence, permission, or schema change.

Decisions:
- The prototype's behaviour (webhook, signature check, `normalize()`, OCR stub, hard-coded profile) is a
  strict subset of what already ships; only `messages.js` had anything new. `server.js`, its
  `package.json`, and `.env.example` were deliberately NOT copied — copying them would fork the webhook.
- Asset placement: `apps/web/public/assets/line/receipt-dropzone.png` (folder is already public HTTPS in
  production, proven by the Rich Menu PNG), generator + Flex Simulator payloads under `scripts/line-oa/`.
- `LineReplyMessage`'s flex variant must gain `quickReply` — LINE allows it on any message type, and the
  card is useless without the camera buttons.
- Values shown in the greeting are never hard-coded: the menu count derives from the built Quick Reply
  items, unrestricted access renders `ทุกสาขา`, and restricted access resolves real branch names from
  the database with a truthful resolved-count fallback.
- Image block is omitted (not rendered broken) when `webBaseUrl` is unset, mirroring the approval card.
- Tests go into the three already-registered spec files, so `apps/api/package.json` — a hand-maintained
  test list that `AGENTS.md` forbids touching for non-dependency reasons — stays out of the diff.
- Owner scope: unit tests only, no E2E.
- P1 hoists `quickReply` onto the shared `LineReplyMessage` intersection while preserving the
  discriminated text/flex union; its lint gate passed.
- The P2 sequencing objection was adjudicated **ACCEPTED** on 2026-08-05. The existing receipt spec call
  was updated with the shared context as compile maintenance; substantive receipt assertions remained P3.
- P2 source changes follow D1-D7: existing Quick Reply filters/order are unchanged, menu count derives
  from built items, and draft-only safety copy is preserved.
- P4 owner decision supersedes the second adjudication amendment. `StaffMenuContext.branchScopeLabel` is
  required and the `· ดูข้อมูลได้ …` clause is unconditional in both the bubble and `altText`; the
  obsolete omitted-clause test was deleted.
- Restricted main-menu greetings query `branch.findMany` with both `companyId` and scoped branch ids,
  select only `name`, order by `createdAt`, and take 50. Up to two 80-character-bounded names render in
  order, followed by `และอีก N สาขา` when needed.
- The branch-name degradation ladder never breaks a greeting: zero usable rows or a query exception logs
  a warning and falls back to the true `${branchIds.length} สาขา`; unrestricted access needs no query.
  Branch names are resolved only for `menuCommand === 'main'`; query/approval/receipt paths perform no
  branch lookup.
- P3/P4 tests cover greeting values/count/bounds/always-present scope, receipt safety/image/camera
  behavior, top-level Flex Quick Reply serialization, real two-branch names, five-branch overflow,
  unrestricted access, lookup failure fallback, and the non-main no-query constraint, plus preview
  parity for `02_welcome` and `03_receipt_card`.
- P5 rewords only the receipt card to `แนบรูปใบเสร็จ`; the main menu's `📷 ถ่ายใบเสร็จ` action and
  `staffMenuCommand` remain unchanged so typed commands and older Rich Menus keep working.
- The PNG remains Claude's paperclip/no-text asset. Its caption is now an unconditional Flex text line,
  and the receipt Quick Reply order is camera roll (`🖼 แนบรูปใบเสร็จ`), camera, then main menu.
- `branchScopeFallbackLabel` is the shared truthful lower rung: restricted access yields the branch
  count and only absent/empty restrictions yield `ทุกสาขา`. Non-main builders do not expose the context
  field in their payloads, so the helper is tested directly as P5 permits; their no-query regression
  test remains intact. No P5 objection was needed because this matches the existing architecture and
  the handoff's explicit unobservable-data allowance.

Open questions: None for this task.

Artifacts:
- `docs/plans/line-oa-message-ui-parity-plan.md`
- `docs/plans/line-oa-message-ui-codex-handoff.md`
- `apps/web/public/assets/line/receipt-dropzone.png`
- `scripts/line-oa/make-dropzone.py`, `scripts/line-oa/flex-preview.json`
- Changed source: `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts`,
  `.../domain/logic/line-staff-menu.logic.ts`,
  `.../application/use-cases/process-line-webhook.use-case.ts` (menu call site + P4/P5 branch-label helper).
- Extended registered specs: `.../domain/logic/line-staff-menu.logic.spec.ts`,
  `.../infrastructure/line-reply.adapter.spec.ts`,
  `.../application/use-cases/process-line-webhook.use-case.spec.ts`.

Verification:
- Literal `pnpm --filter @watchdog-bms/api lint` could not start because `pnpm` is absent from PATH:
  `zsh:1: command not found: pnpm` (exit 127). Node v24.14.0 and Corepack 0.34.6 are available, so the
  pinned package manager was invoked as `corepack pnpm`.
- P1: `corepack pnpm --filter @watchdog-bms/api lint` (exit 0):
  ```text
  > @watchdog-bms/api@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsc --noEmit
  ```
- P2: `corepack pnpm --filter @watchdog-bms/api lint` (exit 2):
  ```text
  > @watchdog-bms/api@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsc --noEmit

  src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts(71,21): error TS2554: Expected 1 arguments, but got 0.
  /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api:
   ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/api@0.1.0 lint: `tsc --noEmit`
  Exit status 2
  ```
- Final P2/P3 lint: `corepack pnpm --filter @watchdog-bms/api lint` (exit 0):
  ```text
  > @watchdog-bms/api@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsc --noEmit
  ```
- Literal full gate: `corepack pnpm --filter @watchdog-bms/api test` (exit 1 before any tests ran) hit the
  handoff's documented sandbox-only `tsx` IPC restriction:
  ```text
  > @watchdog-bms/api@0.1.0 pretest /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsx --test --test-reporter=dot src/modules/reports/application/report-entitlement.race.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/scripts/a5-readonly-evidence.logic.spec.ts src/scripts/a5-capacity-mutating.logic.spec.ts src/scripts/a5-capacity-mutating.pg.spec.ts

  Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/87343.pipe
  code: 'EPERM'
  syscall: 'listen'
  Node.js v24.14.0
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/api@0.1.0 pretest
  Exit status 1
  ```
- Prescribed fallback, run from `apps/api` with the exact registered `pretest` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). Real reporter output:
  ```text
  ....................
  ....................
  .
  ```
- Prescribed fallback, run from `apps/api` with the exact registered `test` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). The configured dot reporter emitted only
  dots; a repeat confirmation captured the real output shape exactly:
  ```json
  {"reporter":"dot","dots":5065,"lines":254,"nonWhitespaceNonDots":""}
  ```
- A preliminary repository-root targeted invocation was non-authoritative: two decorator-free suites
  passed 17/17, while the webhook spec could not transform because root `tsx` did not load the API's
  `experimentalDecorators` setting. The successful package-directory full fallback above includes all
  three changed specs and supersedes that invocation.
- Final hygiene: `git diff --check` (exit 0); `jq empty scripts/line-oa/flex-preview.json` (exit 0);
  `apps/api/package.json` absent from `git status`; no new API file, dependency, database command, or E2E.

### Final gate run after P5 — Claude, on the host (2026-08-05)

- `corepack pnpm --filter @watchdog-bms/api lint` → exit 0, no diagnostics.
- The three changed specs, run from `apps/api`: **73/73 pass, 0 fail.**
- `corepack pnpm --filter @watchdog-bms/api test` → **exit 1**, 7284 pass with **3 failures, all in
  `src/modules/feature-launch/application/execution-attempt.service.race.spec.ts`** — a real-database
  suite this task never touched. Failure is
  `PrismaClientKnownRequestError: Foreign key constraint violated on ExecutionAttempt_companyId_fkey`.
- **Proven pre-existing, not caused by this change.** `git stash push -- apps/api/src/modules/line-ai/`
  then re-running that spec reproduces the identical failure with our diff removed (8 pass / 1 fail, same
  FK constraint); the stash was popped and the diff restored. `git status` also shows zero modifications
  under `apps/api/src/modules/feature-launch/`.
- Cause is local Postgres state (the suite creates and deletes companies; an interleaved or aborted run
  leaves the FK target missing), not repository code. The earlier pre-P4 full run passed on the same code,
  which is consistent with a state-dependent, not code-dependent, failure. **Left for the owner:** reseed
  the local database before treating a full-suite red as real. Do NOT "fix" the feature-launch spec as
  part of this task.

### Independent P1-P3 gate run — Claude, outside the Codex sandbox (2026-08-05, before P4)

The sandbox `tsx` IPC EPERM above is environmental, so the authoritative gates were re-run on the host:

- `corepack pnpm --filter @watchdog-bms/api lint` → exit 0, no diagnostics.
- `corepack pnpm --filter @watchdog-bms/api test` → **exit 0**, real full registered scope including
  `pretest`; 6133 dots, zero `X`, zero `fail`/`error` lines. The sandbox fallback's conclusion holds.
- Targeted spec reporter output for the record: `line-staff-menu.logic.spec.ts` +
  `line-reply.adapter.spec.ts` = 17/17 pass; `process-line-webhook.use-case.spec.ts` = 56/56 pass.

Diff audit (Claude): scope is exactly the six files named in Artifacts plus `flex-preview.json`. The
unrelated dirty paths in `git status` (`apps/web/src/features/expenses/*`, `apps/web/tsconfig.json`,
`infra/docker/compose.local.yml`, `docs/agent-memory/web-expense-review-step-completeness.md`) predate
this task — mtimes 18:37–19:32 versus 21:13+ for the LINE files — and must NOT be swept into a commit
for this change. Nothing is committed; the tree is left dirty for the owner's decision.

### P4 Codex sandbox gate run (2026-08-05)

- `corepack pnpm --filter @watchdog-bms/api lint` (exit 0):
  ```text
  > @watchdog-bms/api@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsc --noEmit
  ```
- Literal `corepack pnpm --filter @watchdog-bms/api test` (exit 1 before tests ran) hit the documented
  sandbox-only pretest restriction:
  ```text
  > @watchdog-bms/api@0.1.0 pretest /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsx --test --test-reporter=dot src/modules/reports/application/report-entitlement.race.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/scripts/a5-readonly-evidence.logic.spec.ts src/scripts/a5-capacity-mutating.logic.spec.ts src/scripts/a5-capacity-mutating.pg.spec.ts

  Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/90323.pipe
  code: 'EPERM'
  syscall: 'listen'
  Node.js v24.14.0
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/api@0.1.0 pretest
  Exit status 1
  ```
- Prescribed fallback from `apps/api`, using the exact registered `pretest` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). Real reporter output:
  ```text
  ....................
  ....................
  .
  ```
- Prescribed fallback from `apps/api`, using the exact registered `test` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). A repeat pass measured the reporter output:
  ```json
  {"reporter":"dot","dots":5065,"lines":254,"nonWhitespaceNonDots":""}
  ```
- P4 scope hygiene before the memory update: `git diff --check` exit 0; `apps/api/package.json` absent
  from the diff; no new API file, dependency, migration/database command, E2E, `git add`, or commit.

### P5 Codex sandbox gate run (2026-08-05)

- Focused changed-suite run from `apps/api`:
  `node --import tsx --test --test-reporter=spec src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
  exited 0 with 72 tests passed, 0 failed.
- `corepack pnpm --filter @watchdog-bms/api lint` (exit 0):
  ```text
  > @watchdog-bms/api@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsc --noEmit
  ```
- Literal `corepack pnpm --filter @watchdog-bms/api test` (exit 1 before tests ran) hit the documented
  sandbox-only pretest restriction:
  ```text
  > @watchdog-bms/api@0.1.0 pretest /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/api
  > tsx --test --test-reporter=dot src/modules/reports/application/report-entitlement.race.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/scripts/a5-readonly-evidence.logic.spec.ts src/scripts/a5-capacity-mutating.logic.spec.ts src/scripts/a5-capacity-mutating.pg.spec.ts

  Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/93823.pipe
  code: 'EPERM'
  syscall: 'listen'
  Node.js v24.14.0
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/api@0.1.0 pretest
  Exit status 1
  ```
- Prescribed fallback from `apps/api`, using the exact registered `pretest` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). Real reporter output:
  ```text
  ....................
  ....................
  .
  ```
- Prescribed fallback from `apps/api`, using the exact registered `test` file list through
  `node --import tsx --test --test-reporter=dot` (exit 0). The real dot reporter output contained
  5,065 dots across 254 lines and no non-dot output.
- Final P5 hygiene: `git diff --check` and `jq empty scripts/line-oa/flex-preview.json` both exit 0;
  `apps/api/package.json` is unchanged and there are no new files under `apps/api`. Source scan confirms
  the only remaining `ถ่ายใบเสร็จ` strings are the intentionally preserved main-menu action and
  typed-command parser. No dependency, migration/database command, E2E, `git add`, or commit.

## Objections

### 2026-08-05 — P2 cannot pass its required lint before the P3-owned spec edit

- Claim: the handoff's phase ordering is not TypeScript-atomic. P2 requires changing
  `buildReceiptCapturePrompt` to require `StaffMenuContext` and then passing lint, while the only
  existing zero-argument spec call is explicitly assigned to P3.
- Evidence: `docs/plans/line-oa-message-ui-codex-handoff.md:124` requires the signature change;
  `docs/plans/line-oa-message-ui-codex-handoff.md:141` requires the P2 lint gate;
  `docs/plans/line-oa-message-ui-codex-handoff.md:143` and `:147-159` defer the spec update to P3;
  `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts:71` still calls the builder
  without context; the required signature is now at
  `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:143`. The real lint output is
  TS2554 at the spec call.
- Impact on the business goal: no product-design or safety decision is disputed, but P2 cannot meet its
  mandated verification checkpoint and P3 cannot start without silently relaxing the stated sequence.
- Smallest correct alternative: update only the existing receipt spec call with the shared context as
  compile maintenance in P2, then add all new receipt assertions in P3; alternatively declare the P2
  lint checkpoint deferred until immediately after P3 and run both final gates unchanged.
- Adjudication: **ACCEPTED** 2026-08-05. The first alternative was authorized and implemented.

Next:
- Claude re-runs the authoritative lint/full-test gates on the host, reviews P5, and commits if accepted.
  Codex did not run `git add` or commit.
- Follow-up (deferred, needs its own decision): the prototype's `04_receipt_result` summary card. Today
  that reply is the string `formatPaypersReply()` (`process-line-webhook.use-case.ts:352`), used at four
  call sites and persisted as `replyText` for AI context and correction lookups — converting it to Flex
  changes a logging contract, not just pixels. See `docs/plans/line-oa-message-ui-parity-plan.md` §6.
