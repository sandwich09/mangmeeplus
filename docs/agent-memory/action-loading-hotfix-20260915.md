# Agent Memory: Action loading hotfix 2026-09-15

Status: Loading implementation, develop/main admin merges and signed UAT hotfix accepted.
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
- Live Chrome after fresh UAT reload: route status "กำลังเปิดหน้า..." observed. Existing Drtb
  SRC-202609-00002 read-only preview shows "กำลังเปิดเอกสาร..." and both row actions disabled
  while awaiting. It settles to a rendered 1191x1684 page and enabled print button; screenshot
  confirms readable layout. No upload/sign/approve/cancel/pay/period-close/customer data mutation.
  One premature image observation hit browser transport timeout while API was still pending;
  no duplicate preview activation or release dispatch, subsequent settled DOM/image check PASS.
  Original The sun coffee item is not accessible with this account and was not re-tested.
- Bounded 150-line/15-minute logs from exact new containers: strict SSH PASS, no missing-module,
  DOMMatrix or timeout pattern. Broad numeric 5xx regex matched three API lines but explicit
  HTTP-status and JSON-status classifiers matched zero; do not count arbitrary numbers as 500s.
  The initial supplemental SSH read used old aliases with the new known_hosts file and was
  rejected before command execution; unchanged original verified alias/key enrollment read PASS.
- Signed/customer OPEN smoke PASS; login/logout NOT_REQUIRED_BY_OWNER and live LINE
  DEFERRED_BY_OWNER. CI LINE fixture acceptance PASS is not live LINE acceptance.
  Static audit is not a claim that every product journey was browser-tested.
Next: Merge this docs-only acceptance ledger into develop and main after its exact CI gates pass.
No second deployment for documentation-only commits; Production remains unchanged.

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
  equal to reviewed main. Controller config SHA256:
  5b1853730bb96bc33b4ee962add22d01b47a181dd3a7b233b7c2096966553d1b.
- UAT_RUN_ID/READY_RUN_ID/PROD_RUN_ID NONE (no GitHub release workflows dispatched);
  local Kamal operation 20260914T182800Z-e3b8bc63, single dispatch, all eleven phases PASSED,
  terminal ACCEPTED_LINE_DEFERRED in 364.651s. Source f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9;
  docs-only local operator checkpoint 00f53793 was not the build source.
- Accepted at 2026-09-14T18:34:03.090095Z; releaseId
  0ee4d9c9c849bc06e669a61bc0c5fbb2e2248767e45804eb4431ac103dce9ef8.
  accepted.json SHA256 1a26a972757697603009f57852bedf8b2791bb1fbe33683b08073d8197499045;
  ECDSA_SHA_256 KMS key cb315bdc-b5ab-42fb-be32-fe9cee2a2d44, signature verified=true.
  Platform-access and /login return200 with effective OPEN; exact full service configs validated.
- Immutable published image digests (not pre-publication local build IDs):
  api-web sha256:4fb6f6820a04ab9d87ba62ad3597e47db27e2b5579b469be42269e6e9721c794;
  ai-gateway sha256:a41b27bf66b3fa9ef62ec3ea6f6dac6b98d64f4b935a866ba5212ba76b9794f1;
  workers sha256:58fbd2b7c9da4574c778ee003bcd96928d3a9c9d274ea6a56bd84d50d41055dc;
  tools sha256:015d79c6369a5fa578cfe447de7ead798ef456bcf53f94e12424ecf3c3d86481.
- Full runtime environment SHA256: api-web
  257e691210c76daad6b6b6bf9707919b6aae5f5a9f4ffbb885904feeef86940a; ai-gateway
  b7a8b031c75c2f902b02555eda28a2f28eab3ef3e66f1956b89ea66ca84a680a; workers
  62e660d18839cd1e5421551964a04d6adc66be5ceb294a23a39f1c316bd533c9.
  API/DB, AI and Workers/Redis/internal API status ok; exact source/digests running on enrolled hosts.
  AgentCore UPDATED_PINNED kamal_uat_b version6, same source, artifact SHA256
  271b09aa885b4afe700fc36d9cf17607cbf426df07ae4f6dff2d7efa20b1f7f0.
  Active operation marker cleared; launch retirement PASSED; ProductionMutated=false.
- Fresh non-root account/EC2/enrollment/strict SSH checks PASS: retained UAT hosts running,
  Dev stopped, same enrolled addresses/keys. Workstation IP matches owner-approved permanent
  allowlist; scoped deploy role intentionally cannot DescribeSecurityGroups, existing non-root
  reader exact-read confirms both /32 rules remain on both UAT groups. No IAM/SG change.
- Zero active local UAT operations across 159 existing worktrees. No active UAT/READY/Production
  workflow for this release; historical empty August12 READY ghost31611733340 is not this flow.
- Fresh post-release EC2 confirms both enrolled UAT hosts running at the same addresses and Dev
  stopped. Previous PDF/native-canvas and HEIC/upload-consistency fixes are retained in this source.
