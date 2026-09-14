# Agent Memory: Action loading hotfix 2026-09-15

Status: Loading implementation and develop/main admin merges complete; single UAT operation next.
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
- Full web suite PASS: 1,714 tests, zero failed/skipped. Final web typecheck and final production
  build PASS on reviewed clipboard/read additions.
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
Next: Commit this docs-only operator checkpoint after fast-forwarding the owned worktree to
accepted main f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9; keep the local controller clean.
Its application/controller inputs must still equal fresh main.
Build/deploy uses the independently pinned origin/main source, never the docs-only checkpoint.
Read mandatory runbooks again before a single retained
Kamal hotfix operation, then verify signature/readiness/public OPEN and browser read-only journey.

Release ledger:
- Reviewed candidate: c8800655a598e95ab8a2a1a7659b95ea9bd39854; superseded f0533a05 CI34876324566
  cancelled after source changed (CI only, not a release).
- PR565 actual full CI34876912709 PASS: real Typecheck and Test, PostgreSQL, workspace tests,
  LINE whole-chain, image-security/maintenance/immutable identity and artifact checks ran.
- PR565 admin MERGED into develop at 2026-09-14T18:07:57Z, merge commit
  a852f06d748ce5508d16d51407ef26a97f02c4c7. Develop tree exactly equals reviewed candidate.
- PR566 develop→main head a852f06d748ce5508d16d51407ef26a97f02c4c7; full CI34878949174 PASS,
  real workspace/PostgreSQL/LINE/security checks ran. Admin MERGED at 2026-09-14T18:27:20Z,
  main merge/source f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9. Main tree exactly equals c8800655.
  No unrelated billing code in its tree. Billing PR558 is still open, not merged/modified here.
- Functional controllerSha256: 1d3f408450f03d28c4406125b7ecf183b853d387c5fe867a3f9967090821efb2,
  equal to reviewed main. Config contract unchanged; final serving source/digests pending.
- UAT_RUN_ID/READY_RUN_ID/PROD_RUN_ID NONE (no GitHub release workflows dispatched);
  local Kamal operation pending. No live release mutation this turn yet.
- Fresh non-root account/EC2/enrollment/strict SSH checks PASS: retained UAT hosts running,
  Dev stopped, same enrolled addresses/keys. Workstation IP matches owner-approved permanent
  allowlist; scoped deploy role intentionally cannot DescribeSecurityGroups, existing non-root
  reader exact-read confirms both /32 rules remain on both UAT groups. No IAM/SG change.
- Zero active local UAT operations across 159 existing worktrees. No active UAT/READY/Production
  workflow for this release; historical empty August12 READY ghost31611733340 is not this flow.
