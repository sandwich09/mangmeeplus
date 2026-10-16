# Agent Memory: OCR round C

Status: Complete locally, 2026-10-16; base 23a598badd238225017684c93523f411f5a12dbc.
Owner: Codex
Scope: C1 LINE PDF flow, C2 VAT totals, C3 issuer identity, C4 extract retry, C5 registry vendor name.
Decisions:
- Follow repo ponytail full mode; existing guards/use cases, no package.json/dependency/flag/final-mutation changes.
- Spec/plan: `docs/specs/ocr-round-c-spec.md`, `docs/plans/ocr-round-c-plan.md`.
- C1 direct LINE files use guarded upload/shared capture jobs; pending PDF receipt resolution now queues that same reader and retains original media/delivery metadata.
- C3 benchmark missing IDs are rejected before merge because normalized IDs meet dash-separated text.
Open questions: None currently; no network/docker/live provider verification available.
Artifacts: `.ocr-bench/` remains untracked; final report `/private/tmp/mangmee-ocrc-20261015-last-message.md`.
Verification:
- PASS `pnpm --filter @watchdog-bms/api typecheck` on final source (session 67329, exit 0 at 18:29 UTC); log `/private/tmp/ocrc-api-typecheck-done.log`.
- PASS contracts build; full contracts test file list: 419 passed, 0 failed.
- PASS gateway package typecheck; full gateway test file list: 1,663 passed, 0 failed, 46 cancelled.
- PASS 21 registered API specs covering every direct importer of changed API implementations plus integration/accounting checks: 1,570 passed, 0 failed, 77 skipped (DATABASE_URL absent). No additional direct importers in other package test scripts.
- Literal gateway/contracts package test scripts fail at tsx IPC `listen EPERM`; complete script lists rerun with `pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 <files>`.
- Gateway's 46 AgentCore runtime test cancellations (3 cancelled suites) reproduce identically on original base 23a598badd238225017684c93523f411f5a12dbc, extracted independently with its own contracts build. Same literal-script IPC errors reproduced there too. No unexplained failure remains.
- Evidence outside repo: `/private/tmp/ocrc-{api,gateway,contracts}-full.log`, exact file/command JSON, `/private/tmp/ocrc-baseline-comparison.json`, `/private/tmp/ocrc-base-runtime.log`, baseline literal-script logs.
- C1: lane-parity PDF/pending/redelivery → shared EXPENSE job; runner actual 2-page PDF → one-page requests → guarded photo apply/outbox; notifier → ordinary review card with 599,586.00 / 39,225.25.
- C2/C3: registered assembly spec covers all four benchmark VAT gaps, inclusive/exclusive/mismatch, first valid issuer/evidence and conflicting ID; gateway capture spec covers three dash-separated benchmark tax IDs, address and buyer-ID refusal.
- C4: receipt controller spec proves eight physical read/extract calls with four timeout retries and all usage entries; runner/client specs prove one capture extract retry, distinct attempt, call ceiling and failed-attempt cost absorption.
- C5: repository spec proves company/ACTIVE/exact-one query across branches; ensure-vendor spec proves legal/display resolution; OCR apply spec proves Thai typo/doubled-syllable correction, raw retention and reviewer/no-ID/no-match protections.
- PASS git diff --check; no package.json edits, flags, final-mutation changes or commits. `.ocr-bench/` untouched.
Next: Owner review of the uncommitted diff; no implementation work remains. All required checks completed within the 60-minute cap, with sandbox-only exceptions reproduced on the exact base.
