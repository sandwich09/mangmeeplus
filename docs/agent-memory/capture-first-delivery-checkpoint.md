# Agent Memory: Capture-first delivery checkpoint

Status: ROOT-REVIEWED DOCS-ONLY CHECKPOINT on develop `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`; phase PR and its own exact-head CI pending. P11 Phase 0 and corrected AI PR288 are merged after exact-head CI SUCCESS. P24-2b remains in progress; no main/Production completion claim.
Owner: Codex / phase6_launch_review; root owns integration and later phase status.
Scope: Preserve the existing P11 Phase 2 generic-error acceptance and refresh delivery status only. No runtime/package/DB/cloud/browser/PR mutation.

Decisions:

- Created `codex/capture-first-delivery-checkpoint` in its own worktree from P11 head `6f85339d6179a456957a7db77a3fc161047b8647`. After root merged PR290, fetched develop and fast-forwarded to `d8d9808e`; the two trees have zero changed paths and the checkpoint had zero dirty files. No stash/reset or edit to primary, old capture audit, P11 or AI worktrees.
- After root merged PR288, fetched develop and checked all8 incoming AI paths were disjoint from the nine dirty documents. Fast-forwarded `d8d9808e→c6f3d06f` without stash/reset and asserted every original dirty file was byte-identical immediately afterward. Only the assigned documentation was then updated.
- [PR290](https://github.com/MangmeeDev/mangmeeplus/pull/290) merged at `d8d9808e41d15360810ed67e9169ade0cd5605ab`, 2026-08-27T05:08:55Z, after [CI33040896057](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33040896057) SUCCESS on exact head `6f85339d6179a456957a7db77a3fc161047b8647`. Only disabled-safe provider foundation is delivered; claim/send lifecycle and activation remain gated.
- Restore the existing [old canonical Phase 2 acceptance at line37](https://github.com/MangmeeDev/mangmeeplus/blob/384d72a5720a58efde943831124e85765ebbc5cb/docs/plans/mangmee-email-delivery-claim-plan-th.md#L37): expired, used and unknown claim tokens receive the same generic public message. Future Phase 2 tests compare all three messages. This does not choose TTL, token representation, wording, HTTP status or resend/revoke authority, and adds no claim route.
- [PR288](https://github.com/MangmeeDev/mangmeeplus/pull/288) old head `70033af22415d59424fa3415448e150404262e48` was held despite [CI33040537029](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33040537029) SUCCESS: root reproduced an amount-only answer of2026 from date/year context when the authoritative amount was85. Root accepted deterministic amount fix `86c72e7f46a1a66becb9c5132bce5f1e5ca757df`; integrated head `29a0605b10102cc6efc0802ba90abe4e5482b6d7` passed [CI33041868515](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33041868515) SUCCESS and root merged it at `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`, 2026-08-27T05:30:29Z. Root's post-integration focused118/118, API/Gateway types/builds,45 maintenance pins and diff checks plus fresh independent combined checks below support this scoped delivery; the old green run does not approve the correction.
- [Fresh final report](capture-integration-final.md), exact29a0605b: NO BLOCKERS in bounded source review; API5327/5425 pass (98 skipped, not DB proof), Gateway984/984 and Web1139/1139 zero skipped; three typechecks and45pins PASS. Six actual-class/fake-dependency chain cases preserve count7 versus preview5 and amount85 despite date2026, context150 and candidate60, with zero provider calls. This is local combined-source evidence, not live AI, browser or main acceptance.
- Next bounded P24-2b selector44px work is uncommitted/in progress on `codex/p24-scope-selector-targets` fromd8d9808e. Root owns its implementation/manual UI acceptance; no test, review or delivery pass is claimed here.
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

Verification:

- Read AGENTS and repository ponytail full; the legacy `/Users/spare058/...` skill path is unavailable. Small docs-only edits reuse canonical spec/plan/memory; no new abstraction or dependency.
- Read-only git/gh confirms the exact PR290 merge/head/CI pair and PR288 old-head green-but-held history. Final `gh pr view 288` / `gh run view 33041868515` confirms MERGED at `c6f3d06f0558ef9dd3a0944ae2065bbae67946a0`, 2026-08-27T05:30:29Z, exact head `29a0605b10102cc6efc0802ba90abe4e5482b6d7`, CI completed/SUCCESS. Root supplied the scoped post-integration results above. Blob comparisons are source evidence, not runtime tests or live acceptance.
- Historical eight-file freeze:153 relative targets/22 anchors and scope/diff checks PASS. Subsequent report-copy checkpoint is verified below; these older counts are not relabeled as the expanded diff.
- Verbatim report copy:9,261 bytes; source and checkpoint SHA256 both `8792c9edc55c6f81366fecffe1e1e51df4b2c117fc0447df795581c2cc408b6c`. Original report/worktree untouched. Historical report-copy freeze:9 Markdown files (7 modified +2 new),159 relative targets/22 anchors and scoped diff checks PASS; final expanded checkpoint verification is recorded separately below.
- Agent freeze on `c6f3d06f`:12 Markdown files (10 modified +2 new),167 relative targets/22 anchors resolve; docs-only scope and `git diff --check` PASS. AI contract and historical findings/test counts match merged source, apart from labeling the old hold section historical. Report still matches the original byte-for-byte. The agent performed no runtime test, provider call, cloud/DB/browser action, commit, push or PR mutation; root owns the later delivery.

Next:

- Root reviewed the scoped diff, rechecked both exact-head GitHub CI/merge pairs and independently verified the unchanged report hash; deliver this docs-only checkpoint through its own PR/CI. P11 Phase0 and the bounded AI correction are merged; do not repeat runtime work or close old PRs here. P24-2b remains in progress and this checkpoint does not wait for it. Existing Owner/security/human/live gates still prevent a full-product/main/Production completion claim.
