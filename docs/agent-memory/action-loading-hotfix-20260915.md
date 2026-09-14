# Agent Memory: Action loading hotfix 2026-09-15

Status: Implemented and locally verified; PR/CI/admin merge and UAT acceptance pending.
Owner: MangmeeDev; user authorizes admin merge into develop and main, then UAT hotfix.
Scope: Visible in-flight feedback on asynchronous action controls throughout the existing web
application, including menus/dialogs/file preparation, without changing API/permission/business
rules. Previous PDF-runtime and upload-consistency hotfix is already accepted on UAT operation
20260914T165647Z-f9ecf83a; do not repeat that work or deploy Production.

Decisions:
- Fresh branch codex/hotfix-action-loading-20260915 from origin/main6b7b5611 in a separate clean
  worktree. Preserve the unrelated dirty billing checkout and PR558.
- Follow existing approved toast-topcenter-loading-plan.md: reuse pending state and contextual
  labels; native buttons remain native, no loading toast/new dependency/global interaction lock.
- Existing Button loading, native aria-busy and one shared CSS spinner are sufficient; do not
  infer loading from permission/validation disabled states. Mechanically expose only positive
  pending-state predicates already used by action controls. Keep all original disabled predicates.
- Add real pending guards to newly identified missing waits, clear in finally. File pickers need
  explicit loading rather than treating every disabled picker as uploading. Image loading remains
  visible until preview pages are usable, not just until the API returns.
- Acceptance: pending action shows visible spinner and accessible busy state; duplicate activation
  is blocked; successful/rejected waits settle and allow retry; inactive permission locks never
  show spinner; no changes to request payloads, tenant boundaries, signing/approval rules or schema.

Open questions: None. Admin merge bypass applies only to reviewer requirement after actual CI passes.
Artifacts:
- scripts/qa/action-loading-coverage.mjs: reviewed pending-predicate audit/mechanical codemod;
  excludes permissions/validation locks and pure local cancel/navigation/setter actions.
- Shared Button/IconButton/ThemedFile plus native CSS spinner and route/loading states.
- Explicit read/preview/close-check pending guards in vendor bills, reimbursements, signature
  background preparation and period-close checks; receipt preview stays busy until images load.
- apps/web/src/common/components/button/action-loading.spec.ts: eleven focused tests exercising
  actual handler bodies with deferred/rejected promises, duplicates, retry and stale read responses.
Verification:
- Frozen-lock offline install and contracts build PASS; no package/lock/schema/API/workflow edits.
- Full web suite PASS: 1,714 tests, zero failed/skipped. Final web typecheck PASS; production build
  previously PASS and final reviewed clipboard/read additions build pending.
- Coverage audit PASS: 395 pending controls, zero missing indicators; codemod idempotent.
- git diff --check PASS. Maintenance pins current: exactFiles=45,
  validatorSha256=cee4f9e7e9a5a6d34e9d37b869f574844b6e0fd5318a96bb78c4e40a148a963d.
- Local full image-security chain initially reached migration tests without a generated Prisma
  client in this fresh worktree. Generated the unchanged schema client using CI's preparation
  command; prepared full-chain rerun PASS (including 26 migration/unit fixture tests). No live
  database connection/migration/write involved.
- Chrome read-only synthetic SSR of actual shared Button/IconButton/ThemedFile and native controls
  with production CSS PASS at default desktop and 390x844: visible single spinner, native icon
  replacement, filename/label retained, no mobile overflow, permission locks without spinner.
  Temporary viewport reset and preview server/tab stopped/closed.
- Final async-call audit found refresh/retry, CRM selection, reconciliation read and clipboard
  waits outside disabled-state scanning; wired those explicitly, AI usage retry now has real
  pending status. Clipboard/rejected AI/reconciliation handler checks added.
- Live browser acceptance and signed/customer OPEN acceptance remain pending; static audit is
  not a claim that every product journey was browser-tested.
Next: PR565 exact latest-head CI (old f0533a05 run34876324566 superseded by reviewed follow-up);
merge exact passing heads into develop/main; read mandatory runbooks again before a single retained
Kamal hotfix operation, then verify signature/readiness/public OPEN and browser read-only journey.

Release ledger: candidate/controller pending; UAT_RUN_ID/READY_RUN_ID/PROD_RUN_ID NONE (no GitHub
release workflows requested); local Kamal operation pending. No live mutation in this turn yet.
