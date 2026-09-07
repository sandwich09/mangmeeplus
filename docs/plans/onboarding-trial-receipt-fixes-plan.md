# New-shop onboarding and trial receipt fix plan

Status: Discovery complete enough for scoped implementation; spec precedes code. Owner requested the same delivery workflow as the previous round.

Spec: [five-issue contract](../specs/onboarding-trial-receipt-fixes-spec.md). Memory: [task state](../agent-memory/onboarding-trial-receipt-fixes.md).

## Baseline and ownership

- Develop pulled with fast-forward; base `ca36d69751ad37629bb512b0d0d3585afdcf010e`. Existing remediation #473/#474 is included.
- Branch `codex/onboarding-trial-receipt-fixes-20260907`; dedicated worktree `../mangmeeplus-onboarding-trial-receipt-fixes-20260907`. Original checkout's user documents and local deployment notes remain untouched by Git staging.
- Coordinator alone handles Git, docs, shared integration, final evidence and deployment-pin generation. No package.json/dependency changes planned. No live deployment or customer mutation.

| Lane / model | Responsibility | Ownership boundary |
|---|---|---|
| Receipt allowance — GPT-6 Astra xhigh | Issues 1/2/4: first-shop receipt proof, effective trial15, shared commercial count, result-based compensation/retry and adjacent integrity | OCR governance/clients/receipt use cases/LINE orchestration, quota logic, plan-term contracts/config/deploy defaults, related tests. Provisioning edits are supplied to the email owner; coordinate shared trial copy files. |
| Signup email — GPT-6 Astra xhigh | Issue3: LIFF HTML/script/DTO/command, contact storage and safe provisioning for new/existing users | Signup contracts, API-hosted LIFF/auth page, signup domain/controller/use cases, onboarding and tests. Owns provision-signup.use-case.ts; applies the receipt lane's agreed trial-guard edits. |
| Clear actions — GPT-5.6 Sol xhigh | Issue5 dashboard buttons/navigation/snooze; LINE contact-email admin hint | Company-profile web component and tests; narrow source-aware signup-queue hint/test. No receipt or signup backend edits. |
| Coordinator | Spec/plan, cross-lane UX/architecture/business/AI review, contracts/CI integration, real DB/browser proof, commit/push/admin PR delivery | Docs, evidence and agreed integration corrections only; request lane coordination before shared source edits. |

## Checkpoints

1. [x] Pull develop, create isolated branch, inspect current docs/code and preserve existing files.
2. [x] Write spec, plan and task memory before application edits; publish ownership and policy amendments.
3. [ ] Implement independent lanes with permanent regressions; preserve source/financial/identity boundaries.
4. [ ] Integrate runtime trial policy with all displayed counters and signup copy; prove no first-use settings gate and no admission leak on failed/unusable receipts.
5. [ ] Verify syntax-only contact email through real signup/provisioning plus new/attached/duplicate-contact/retry cases; verify dashboard CTA/mobile journey and admin hint truthfulness.
6. [ ] Run focused checks, appropriate contracts/API/web type checks, real local PostgreSQL and browser coverage; run relevant integrated CI/catalog checks. Regenerate protected source checksums using the existing script if needed; do not weaken checks.
7. [ ] Record final issue-by-issue evidence and material runtime limits; commit/push scoped changes, create develop PR, wait for CI and admin merge under existing owner authorization.
8. [ ] Send the reviewed change to main, verify candidate and CI, admin merge; record both merged SHAs and tree parity. Preserve original checkout changes.

## Verification design

- Reuse existing signup PG suites, receipt-truth/reliability suites and source draft regressions. A helper-only test is insufficient for the first-shop, persistence-failure or identity boundary.
- Distinguish aggregate operational OCR use from the commercial receipt allowance in tests. Validate failure and successful-notification-failure controls, including competing attempts and the original admission month.
- Use local disposable PostgreSQL and synthetic identities/documents; never use production credentials, customer data or outbound LINE/email messages as fixtures.
- Browser proof must open the real dashboard CTA and existing profile form at mobile/desktop widths. Use served LIFF HTML/script or a controlled local browser harness for required email and inline errors.
- Register new specs in existing CI/catalog patterns rather than editing package.json scripts. Keep historical incident evidence distinct from post-fix passes.

## Next deployment requirements carried forward

- [ ] Both `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in UAT and Production, as already required by the owner.
- [ ] Actual deployed trial limit/copy reads15 from day one, including existing normal trial rows with old warmup10; verify actual workflow/env wiring rather than defaults alone.
- [ ] UAT first-shop/signup/failed-read/quota/CTA acceptance before Production promotion, then actual runtime readback and customer acceptance. Follow `docs/runbooks/uat-production-v2-deployment.md`; record exact UAT/READY/Production runs and signed result. This Git delivery does not dispatch those runs.
