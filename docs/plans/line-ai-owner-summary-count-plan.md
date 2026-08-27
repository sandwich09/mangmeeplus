# LINE AI owner summary count plan

Spec: [response contract](../specs/line-ai-owner-summary-count-spec.md).

- [x] Inspect exact PR #264 commit/diff and current develop callers/API count basis.
- [x] Create a clean branch from fetched develop; do not modify the old PR branch.
- [x] Port only the intended composer and Flex-heading behavior using current files.
- [x] Preserve explicit counts with the existing count predicate and raw API total;
  fail closed for invalid/missing counts and incomplete aggregation.
- [x] Keep distinct-vendor/payment/status-subset counts explicitly unavailable rather
  than substituting the global record count; preserve grounded detail context.
- [x] Add synthetic golden/regression cases to existing registered composer,
  orchestrator and card specs; preserve all original intent/security boundaries.
- [x] Run focused and full relevant suites, typechecks, registration and diff checks.
- [x] Update memory with exact results and freeze for root review; no commit/push/PR.
- [x] Root follow-up: stop over-refusing possessive store/company context and explicit
  matching exclusions; prove original counterexamples plus genuine subset guards, rerun
  gateway checks and refreeze.
- [x] Root follow-up: remove capture-intent success-like heading; preserve explicit titles
  and body; run registered API card/source, LINE coverage and typecheck before refreeze.
- [x] Root follow-up: make supported expense counts deterministic before provider
  composition, preventing count/money/date relabelling; preserve amount-only and other-tool
  model paths at that stage, update golden expectations, rerun checks and refreeze.
  The amount-model contract is superseded by the PR #288 follow-up below.
- [x] Root follow-up: distinguish Thai `กี่บาท`/`จำนวนเงิน` from record counts, keep mixed
  count+amount deterministic, align model count guard with projected data at that stage;
  rerun gateway checks and refreeze without changing the API. Projection is now removed.
- [x] Root fast-forward to develop `11153296` with no path overlap; regenerate/build,
  API/gateway typechecks, gateway977/977 and API source/card37/37 passed, zero skipped.
- [x] Independent bounded review and real-class in-memory source→presentation/card probe;
  no blockers, composer/orchestrator111/111 and source/card37/37, zero skipped.
- [x] Root PR #288 hold follow-up at `70033af2`: make the existing sole-expense amount-only
  path authoritative before provider composition; remove its unreachable projection,
  preserve full-source detail/other-tool model paths, and prove date/context/candidate
  amounts cannot replace the current total. Supersedes the earlier amount-model contract.
- [x] Rerun registered focused118/118/full gateway984/984 (zero skip), API/gateway types
  and diff check; record exact evidence and refreeze for root review. Earlier green
  review/CI is not proof for this follow-up.
- [ ] Exact-head PR CI and root approval before merge.

Ponytail full: reuse the composer (already has source data and fallback), existing
model/provider stubs, and renderer. No new router, harness, dependency or schema.
Root owns later browser/live-provider validation and any release decision.
