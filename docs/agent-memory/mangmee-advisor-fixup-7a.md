# Agent Memory: mangmee-advisor-fixup-7a

Status: implemented and locally verified; uncommitted, no deployment
Owner: Codex, fix-up 7A
Scope: first-ask evidence choices, capture truncation/retry and failure delivery, single action cards and category-confirm composition. Excludes line-substitute-receipt-* files.
Decisions:
- Follow ponytail full mode; no package.json, dependency, feature flag, final-mutation gate, cloud, commit or deployment changes.
- Spec and implementation sequence: docs/specs/mangmee-advisor-fixup-7a-spec.md.
- Interrupt before tool preparation rather than weakening revision checks.
- Finished-event requestId currently equals jobId on every attempt; OutboxAppendService deduplicates on that value, suppressing later results. Scope identities to the claimed attempt.
- Category-only selection dry-runs the real UpdateExpenseDraftUseCase in a rolled-back transaction and previews the existing ready/confirm validators against its resulting source. The signed action stores the category and original revision; apply rechecks the active company category and calls category update → ready → evidence review → confirm, preserving every committed revision. No new DI dependencies.
- Action-only gateway replies send one Flex card; multi-request turns retain their other answer. Payment previews use the existing derivePaymentStatus helper and show ยังไม่จ่าย / จ่ายบางส่วนแล้ว / จ่ายแล้ว.
- Failed capture notices use the existing complete text-card builder with the web link as a button; legacy push retry identities now distinguish read attempts.
Open questions: no product questions. Live LINE/provider UAT is unavailable. The supplied trace-g.jsonl contains gateway turns, not raw capture-read provider output; its owner-reported partial reason is replayed in a deterministic transport fixture.
Artifacts: .live-r6/ (read-only evidence, never commit); last-message.md.
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: exit 0; /private/tmp/fx7a-contracts-build.log.
- `pnpm --filter @watchdog-bms/api typecheck`: final exit 0; /private/tmp/fx7a-api-typecheck-final.log. Gateway package typecheck: final exit 0; /private/tmp/fx7a-gateway-typecheck-final.log.
- Full scripts.test lists read directly from unchanged package.json files and executed with `pnpm --filter <pkg> exec node --import tsx --test` (gateway concurrency 4): contracts 419 passed, 0 failed; gateway 1,669 passed, 0 failed, 46 cancelled by sandbox listener EPERM. Logs: /private/tmp/fx7a-full-contracts.log; /private/tmp/fx7a-full-gateway.log.
- Full gateway list repeated on pristine `git archive` of original base 2bf84b0368b1de2672aaa3d901f341e78c23ad0b (claude/advisor-all-20261015) at /private/tmp/fx7a-base-2bf84b036: 1,667 passed, 0 failed, the identical 46 cancelled tests / 3 cancelled suites, same `listen EPERM: operation not permitted 0.0.0.0`. Log: /private/tmp/fx7a-base-full-gateway.log. Compared all 49 cancelled test/suite names: byte-identical; lists in /private/tmp/fx7a-{full-gateway,base-full-gateway}-cancelled.txt. This is execution evidence, not an inferred pre-existing claim.
- All 77 registered API specs directly/transitively importing changed implementations (27 direct importers): 3,979 passed, 0 failed, 95 database cases skipped by their existing guards. Includes the real-module SWC/Nest DI spec. Command: node launcher → `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-concurrency=4` with /private/tmp/fx7a-api-specs.json. Full command/file list and results: /private/tmp/fx7a-affected-api.log.
- Focused four API specs: 714 passed, 0 failed; /private/tmp/fx7a-focused-api.log. Registered new cases cover Z1 first-ask order, Z2 narrative partial/incomplete JSON, Z3 real outbox dedupe + failure push, Z4 one card/payment labels/category chain and stale/permission/tamper refusals.
- `git diff --check`: passed. No package.json, dependency, feature/final-mutation flag or line-substitute-receipt-* changes; .live-r6 remains untracked.
Next: review the diff; real LINE/provider acceptance needs an environment permitting external delivery. No further local code work remains.
