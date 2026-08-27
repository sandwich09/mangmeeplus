# Agent Memory: Capture-first delivery checkpoint

Status: DELIVERY SNAPSHOT verified on develop `a2d8e793de11eb60077e63bb1a7ccf0303b390c6`. Original docs checkpoint PR291 and P24-2b PR292 are merged; approved-origin capture33/33 + selector61/61, manual draft/reload and exact-head CI passed. P11 Phase0 and corrected AI PR288 remain merged. Full P24 stays PARTIAL; no main/Production completion claim.
Owner: Codex / phase6_launch_review; root owns integration and later phase status.
Scope: Preserve P11 Phase2 generic-error acceptance and historical AI/capture evidence; refresh bounded P24 delivery status only. No runtime/package/DB/cloud/browser/PR mutation by this docs task.

Decisions:

- Created `codex/capture-first-delivery-checkpoint` in its own worktree from P11 head `6f85339d6179a456957a7db77a3fc161047b8647`. After root merged PR290, fetched develop and fast-forwarded to `d8d9808e`; the two trees have zero changed paths and the checkpoint had zero dirty files. No stash/reset or edit to primary, old capture audit, P11 or AI worktrees.
- After root merged PR288, fetched develop and checked all8 incoming AI paths were disjoint from the nine dirty documents. Fast-forwarded `d8d9808e→c6f3d06f` without stash/reset and asserted every original dirty file was byte-identical immediately afterward. Only the assigned documentation was then updated.
- [PR290](https://github.com/MangmeeDev/mangmeeplus/pull/290) merged at `d8d9808e41d15360810ed67e9169ade0cd5605ab`, 2026-08-27T05:08:55Z, after [CI33040896057](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33040896057) SUCCESS on exact head `6f85339d6179a456957a7db77a3fc161047b8647`. Only disabled-safe provider foundation is delivered; claim/send lifecycle and activation remain gated.
- Restore the existing [old canonical Phase 2 acceptance at line37](https://github.com/MangmeeDev/mangmeeplus/blob/384d72a5720a58efde943831124e85765ebbc5cb/docs/plans/mangmee-email-delivery-claim-plan-th.md#L37): expired, used and unknown claim tokens receive the same generic public message. Future Phase 2 tests compare all three messages. This does not choose TTL, token representation, wording, HTTP status or resend/revoke authority, and adds no claim route.
- [PR288](https://github.com/MangmeeDev/mangmeeplus/pull/288) old head `70033af22415d59424fa3415448e150404262e48` was held despite [CI33040537029](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33040537029) SUCCESS: root reproduced an amount-only answer of2026 from date/year context when the authoritative amount was85. Root accepted deterministic amount fix `86c72e7f46a1a66becb9c5132bce5f1e5ca757df`; integrated head `29a0605b10102cc6efc0802ba90abe4e5482b6d7` passed [CI33041868515](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33041868515) SUCCESS and root merged it at `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`, 2026-08-27T05:30:29Z. Root's post-integration focused118/118, API/Gateway types/builds,45 maintenance pins and diff checks plus fresh independent combined checks below support this scoped delivery; the old green run does not approve the correction.
- [Fresh final report](capture-integration-final.md), exact29a0605b: NO BLOCKERS in bounded source review; API5327/5425 pass (98 skipped, not DB proof), Gateway984/984 and Web1139/1139 zero skipped; three typechecks and45pins PASS. Six actual-class/fake-dependency chain cases preserve count7 versus preview5 and amount85 despite date2026, context150 and candidate60, with zero provider calls. This is local combined-source evidence, not live AI, browser or main acceptance.
- P24-2b [PR292](https://github.com/MangmeeDev/mangmeeplus/pull/292) MERGED at `a2d8e793de11eb60077e63bb1a7ccf0303b390c6`, 2026-08-27T06:08:41Z, after [CI33043955626](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33043955626) completed/SUCCESS on exact head `d3a531d69d2ef1ee2259b51228aa6e676b22eb91`. Root accepted scoped source/61 E2E/1140 web/89 focused/typechecks and eight images, then approved-origin capture33/33 + selector61/61 and manual draft/reload with a ninth image. All six CI validation jobs passed; production image/publish jobs were skipped as expected, not deployment evidence.
- [Capture-first scope](mangmee-capture-first-scope.md) is unchanged: P15–20/matching-dependent revenue automation DEFERRED and not main blockers; subscription excluded. P27 VAT-unknown, P28 policy, identity/security, expert/live and human/device gates remain. PR265 keeps its five security findings and unresolved one-time contract.

Read-only old-PR disposition evidence:

- PR268: all9 feature-file postimages match `ff024262`, already a develop ancestor; merge predecessor has no combined-resolution diff and `01d11410` is an empty retry commit. Fully superseded; old CI is not new acceptance.
- P10 `4f6600bb→394251d9`: all7 runtime/test postimages identical; CompanySignupState/CompanySignupRequest still match on develop. P27 `03648ce0→a0b616e3`:18/18 identical; `8ee52df3→3cb16603`:6/7 identical, the only contract difference adds optional correctionBasisAmount; `cef527f7→2076f0c2`:2/2 identical. Current descendants retain these behaviors with later fixes.
- PR272/273/274/275 runtime is now superseded in full by existing P10/P27 plus merged PR290 SES, including explicit frontend-base hardening. The raw-link/key lifecycle gate from `384d72a5` remains; the generic-message acceptance is carried forward here, not a new policy. No old PR was closed or edited by this audit.
- PR264 runtime is now superseded in full by merged PR288 at `c6f3d06f`: broad-summary/contextual-heading behavior is retained with count/truncation/mixed-topic/capture-truthfulness and amount/date corrections. Exact-head CI on `29a0605b` and fresh combined checks passed. Its omitted `line-ai-concise-contextual-card-heading.md` is historical memory, not missing runtime; replacement spec/plan/memory are on develop. No old PR was closed or edited; `70033af2` remains historical, not final acceptance.

Open questions:

- No new Owner question from this checkpoint. Existing P11 secret/TTL/sender/region and active-scope gates remain unanswered unless explicitly recorded elsewhere by root.

Artifacts:

- [P11 spec](../specs/mangmee-email-delivery-claim-spec-th.md), [P11 plan](../plans/mangmee-email-delivery-claim-plan-th.md), [P11 delivery memory](p11-email-provider-foundation.md).
- [Master index](../plans/mangmee-master-plan-index-th.md), [closure plan](../plans/mangmee-four-lane-gap-closure-plan-th.md), [progress audit](capture-first-progress-audit.md).
- [Capture integration final](capture-integration-final.md) copied verbatim from root's independent review worktree, not rewritten or rerun by this checkpoint.
- [AI spec](../specs/line-ai-owner-summary-count-spec.md), [AI plan](../plans/line-ai-owner-summary-count-plan.md), [AI delivery memory](line-ai-owner-summary-count.md) retain historical findings and record the final exact-head delivery separately.
- [P24-2b spec](../specs/p24-scope-selector-targets-spec.md), [plan](../plans/p24-scope-selector-targets-plan.md), [memory](p24-scope-selector-targets.md) and [image evidence](../evidence/p24-scope-selector-targets/README.md) distinguish eight original selector images from the ninth manual draft, and real controls from mocked error/long-list geometry.

Verification:

- Read AGENTS and repository ponytail full; the legacy `/Users/spare058/...` skill path is unavailable. Small docs-only edits reuse canonical spec/plan/memory; no new abstraction or dependency.
- Read-only git/gh confirms the exact PR290 merge/head/CI pair and PR288 old-head green-but-held history. Final `gh pr view 288` / `gh run view 33041868515` confirms MERGED at `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`, 2026-08-27T05:30:29Z, exact head `29a0605b10102cc6efc0802ba90abe4e5482b6d7`, CI completed/SUCCESS. Root supplied the scoped post-integration results above. Blob comparisons are source evidence, not runtime tests or live acceptance.
- Historical eight-file freeze:153 relative targets/22 anchors and scope/diff checks PASS. Subsequent report-copy checkpoint is verified below; these older counts are not relabeled as the expanded diff.
- Verbatim report copy:9,261 bytes; source and checkpoint SHA256 both `8792c9edc55c6f81366fecffe1e1e51df4b2c117fc0447df795581c2cc408b6c`. Original report/worktree untouched. Historical report-copy freeze:9 Markdown files (7 modified +2 new),159 relative targets/22 anchors and scoped diff checks PASS; final expanded checkpoint verification is recorded separately below.
- Agent freeze on `c6f3d06f`:12 Markdown files (10 modified +2 new),167 relative targets/22 anchors resolve; docs-only scope and `git diff --check` PASS. AI contract and historical findings/test counts match merged source, apart from labeling the old hold section historical. Report still matches the original byte-for-byte. The agent performed no runtime test, provider call, cloud/DB/browser action, commit, push or PR mutation; root owns the later delivery.

## P24 delivery-doc follow-up — 2026-08-27

- Read-only GitHub confirms [PR291](https://github.com/MangmeeDev/mangmeeplus/pull/291)
  MERGED at `d8f1a8536145beb24118dff901f18a4b92b08583`, 2026-08-27T05:43:09Z;
  [CI33043341836](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33043341836)
  SUCCESS on `bd88a14e1bbb1bf8bd46364d30c71343b679499b`. Runtime jobs were skipped as
  designed for docs-only changes; this is not a fresh runtime test or P24 CI acceptance.
- Created separate `codex/capture-first-p24-delivery` / `mangmeeplus-capture-first-p24-delivery`
  from frozen P24 candidate `d3a531d69d2ef1ee2259b51228aa6e676b22eb91`, after confirming
  path/branch were unused. Read AGENTS/Ponytail full and scoped docs. Primary, earlier
  docs worktrees and P24 runtime worktree are untouched; no new abstraction or dependency.
- After root merged PR292, fetched develop and verified `d3a531d6→a2d8e793` has zero
  incoming tree paths. Fast-forwarded only this docs worktree without stash/reset;
  all nine dirty Markdown files plus root's new JPEG were byte-identical afterward.
  Read-only GitHub independently confirmed the exact head/merge/time/CI pair above.
- P24 memory records root's independent final JSON61/61 and focused89/89 checks,
  real Chrome branch/company switching restored to original company/all-branches,
  and post-FF TypeScript passes. Root's FF `d8d9808e→d8f1a853` had17 incoming paths
  disjoint from15 owned files, all byte-identical afterward. Frontend production SHA256
  remains `9181d1970c85a844a049e9137a9a642302b4389bbb703eece1812af326ce242f`.
  This docs task checked bytes, not browser/runtime behavior.

<a id="p24-post-scope-capture-rerun"></a>
### Additional capture rerun — local-origin finding and approved-origin acceptance

- Root's additional33-case capture run on web3004 finished **24 passed/9 failed**;
  initial observed failures included ACCT02/06, AP03/04 and EXP04. Keep the failed
  `test-results/p24-capture-integration-report/` and `test-results/p24-capture-integration.json`
  in the original P24 worktree; start2026-08-27T05:54:22.303Z,77.998s, zero skipped/flaky
  or report errors. They are not a pass or replacements for earlier evidence.
- Root proved local CORS origin mismatch: isolated helper
  `/tmp/expense-payment-capture-local-20260827.cjs:38` allows port3000 at
  `http://127.0.0.1:3000` and `http://localhost:3000`, not3004;
  `apps/api/src/main.ts:87–93` rejects other origins. Root's read-only `GET /v1/health`
  returned200 with no Origin and Origin3000, but500 with Origin3004. This docs task
  checked those source lines; it did not rerun HTTP/browser tests. This is an environment
  finding, not a selector-source regression or a reason to weaken the CORS guard.
- Root moved only its own web from3004 to vacant3000 at the same `d3a531d6`
  source and existing environment allowlist. No API/CORS guard, policy, DB/bootstrap or
  provider change; API3003 is unchanged.
- Fresh allowed-origin capture **33/33 passed**, zero skipped/unexpected/flaky/report errors;
  start2026-08-27T06:00:07.943Z,38.558s. The separate JSON is
  `test-results/p24-capture-approved-origin.json` in the original P24 worktree.
  This docs task read both report summaries directly and confirmed the distinct counts
  and timestamps; no runtime test was rerun here.
- Fresh allowed-origin selector **61/61 passed**, zero skipped/unexpected/flaky/report errors;
  start2026-08-27T06:00:07.944Z,89.793503s, `test-results/p24-scope-approved-origin.json`.
  The docs follow-up read this JSON too: **94 cases in two runs**, not one94-case suite.
- Root's real Chrome on3000 saved synthetic expense `cmtb47c9d02rzq6k1r4bs9vmf` once,
  then hard-navigated to its persisted route. After loading it retained description,
  quantity1/unit100/total100/unpaid100, DRAFT/tax-evidence-pending and existing NO_VAT;
  next action stayed disabled for missing vendor/receipt. No confirm/payment/posting/OCR,
  horizontal overflow or error logs. [Ninth image and precise proof limits](../evidence/p24-scope-selector-targets/README.md#approved-origin-integration-and-manual-draft--2026-08-27)
  show the draft header; total100 is below the screenshot viewport and proved by DOM,
  not image alone or independent API readback. Existing NOT_REGISTERED/NO_VAT behavior
  does not resolve P27 VAT-unknown policy. Earlier draft `cmtazlakn001sq6k1ladnx7yz` is preserved.
- The earlier capture33/33 was on web3000 with the expense-capture launch configuration;
  its evidence stays historical and is not relabelled as this rerun. Earlier selector61/61
  remains scoped read/geometry evidence, not capture-write acceptance. PR292's final
  acceptance uses the new local runs/manual proof plus exact-head CI, without erasing
  the failed-origin run or implying full-P24/main readiness.

Documentary verification on `a2d8e793`:

- Nine Markdown files and one root-created JPEG only;189 relative targets/33 anchors
  resolve and `git diff --check` passes. Original P24 contract/history, eight image bytes,
  frontend SHA256 and the 9,261-byte AI report (`8792c9ed…408b6c`) remain unchanged.
- Ninth JPEG is1126×796,69,060 bytes, SHA256
  `ade58a6f2a27aa06ebf63c961517c26ac7e2acf30ad3f82e62248269e6991c55`;
  root saved/visually inspected it, this docs task only verified its file/hash. No new
  runtime test or DB/cloud/browser mutation by this docs task. P21-0/P23 product-help
  readiness and all existing active-scope gates are retained, not recast as all Owner-blocked.
- Root independently reviewed all nine document diffs and confirmed189 relative targets,
  33 anchors, all eight original image bytes and the unchanged AI report hash. The evidence
  README explicitly limits its original eight-image statement to the selector run.

Next:

- P24-2b delivery is complete on develop; do not repeat this runtime slice or close old
  PRs from this documentary snapshot. P15–20 stay deferred, subscription excluded, and
  Owner/security/human/physical-device/live gates remain open before broader acceptance.
