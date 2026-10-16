# Agent Memory: mangmee-advisor-fixup-4-gateway-regressions

Status: regression fixes implemented; complete registered gateway/contracts suites have zero assertion failures. Gateway runtime HTTP tests remain sandbox-cancelled, reproduced on the untouched base.
Owner: Codex
Scope: gateway preview classification, permission/feature-scoped capability help and matching API follow-up; no commits, package.json edits, flags, final-mutation gates, or cloud operations.
Decisions:
- Starting commit: ef244f5b6038c5de76832476e46e6bf554e6053b, from claude/advisor-all-20261015.
- Follow the existing capability-help spec/plan and full-capability plan; user instruction supersedes their stale web-only final-action copy.
- Shared counterparty tools accept expenses OR sales_documents but do not grant sales reporting. Explicit tool ownership keeps counterparties and sold WHT documents separate from sales/general tax; feature matches use the enabled feature itself. Reimbursement module matching retains its feature-independent read path.
- คู่ค้า, ทีมงาน, ใบสำคัญจ่าย/50 ทวิ and package purchases have mirrored Thai/English copy and current permission/feature checks. Existing no-context legacy output remains the same size and omits newly scoped groups.
- Gateway and API follow-up explain human confirmation cards, including approval teaching.
- User explicitly authorized adding counterparty.action.preview to the test's literal preview allowlist and updating old exact capability expectations. The category=draft_update requirement and all read-only/preview boundaries remain unchanged. The contracts all-features fixture now includes WHT features, so legacy/all-on equality still tests its original rule.
- Existing production preview registration already matches expense.action.preview; no runtime registration refactor is needed. The five expense draft tools remain unchanged.
Open questions: none in the implementation. Full runtime HTTP execution requires an environment allowing socket binding; no skips or exclusions were introduced.
Artifacts:
- docs/plans/line-ai-capability-help-entitlement-plan.md; docs/specs/line-ai-capability-help-entitlement-spec.md; docs/plans/mangmee-advisor-full-capability-plan-th.md.
- /private/tmp/fixup-4-last-message.md; /private/tmp/fx4-*.log; /private/tmp/fx4-run-script.mjs.
- Untouched base snapshot: /private/tmp/fx4-original-base (git archive of exact starting commit, with local dependency links and its own built contracts).
Verification:
- contracts build: exit 0. Gateway final typecheck: exit 0. API final typecheck: exit 0, verified by EXIT_CODE=0 in /private/tmp/fx4-api-typecheck-final.log.
- Literal gateway/contracts package test scripts both hit tsx CLI IPC listen EPERM. The temporary runner reads each unmodified package test script and runs its COMPLETE file list using pnpm --filter <package> exec node --import tsx --test; no file exclusions or skips.
- `node /private/tmp/fx4-run-script.mjs apps/ai-gateway @watchdog-bms/ai-gateway`: all 51 registered files; 1,612 pass, 0 fail, 46 cancelled, 0 skipped. Process exit 1 solely for cancellations. Log /private/tmp/fx4-gateway-final.log.
- `node /private/tmp/fx4-run-script.mjs packages/contracts @watchdog-bms/contracts`: all 13 registered files; 412 pass, 0 fail, 0 cancelled, 0 skipped; exit 0. Log /private/tmp/fx4-contracts-final.log.
- API registered direct importers: `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`: 825 pass, 0 fail. Log /private/tmp/fx4-api-full.log.
- Router preview rule, composer AC-1/R2/AC-12/AC-13/AC-15/F1, permission-only leak checks, mirrored new groups and contracts ownership/reach checks all pass in the final full suites.
- FULL original-base gateway: 1,603 pass, 8 fail, 46 cancelled. FULL original-base contracts: 407 pass, 3 fail. Logs /private/tmp/fx4-original-{gateway,contracts}-full.log.
- Runtime cancellations reproduce identically on original base: global before hook cannot bind 0.0.0.0 (listen EPERM); isolated original runtime 46 cancelled, 0 assertion failures. No network permission is available.
- git diff --check: passed. .gw-failures.log untouched and ignored.
Next: review the uncommitted diff. Full runtime HTTP acceptance needs a socket-capable environment; no further code changes are identified.
