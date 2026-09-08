# Receipt tax integrity implementation plan

Status: active, owner authorized 2026-09-08. Branch `codex/receipt-tax-integrity-20260908` from refreshed `origin/develop`; prior release evidence commits preserved. Spec: [receipt tax integrity](../specs/receipt-tax-integrity-spec.md).

## Delivery sequence

- [x] Preserve baseline/evaluation, read existing specs/code and cloud/release runbooks, confirm old release terminal, create branch and spec/plan.
- [x] Contracts and money: optional WHT base, validation/allocation/adapter propagation, signed ROUNDING and mixed-VAT preservation; focused invariant regressions.
- [x] AI capture: bounded complete extraction, typed repair failures, evidence/issuer guards, entity-kind prefill contract and preservation; shared direct/reused-read path tests.
- [x] Backend application/source projection: accepted money/identity, reliable item/summary binding, no hidden or duplicate source requirements; API/concurrency and DB contract tests.
- [x] Frontend and LINE: independent VAT/WHT/base controls, existing theme/form/toasts, accepted-value detailed card, source-safe display/save/reload; responsive browser checks.
- [x] Re-run supplied real samples plus independent synthetic boundary cases; fix root causes and inspect affected callers. Preserve private medical originals and raw traces outside repository.
- [ ] Review final diff, typecheck and relevant suites; run CI on exact reviewed head, merge develop/main using existing authorization.
- [ ] Preflight configuration and runtime once, deploy one canonical UAT run, record signed Passport and automatic READY run, no Production dispatch.
- [ ] Post-deploy real UAT smoke: authorized draft upload, form values, select theme, save/toast/reload, Next/validation, database readback and health/webhook acceptance. Record remaining limits honestly.

## Verification contract

Use existing node/tsx tests and meaningful financial/permission regressions. Contracts build precedes consuming package checks. No package.json script edits. The only dependency addition is the already repository-pinned sharp runtime in AI Gateway, required for the bounded alternate orientation view; existing overrides remain unchanged. Baseline scripts under `/tmp/mangmee-receipt-eval-20260908` retain original outputs; candidate outputs go to a separate directory.

Assertions must compare independent visible totals rather than only mirror formulas: Shichi1,600/VAT104.72/rounding−0.72, mixed400/VAT10.53, S&P890/service61, TCAT VATnone/WHT6.91/net683.89, coupon1,924.45/WHT82.24/net1,842.21. Contract checks include omitted base backward compatibility, explicit base larger than discounted amount, amount-only no inferred rate, negative net rejection, zero clear, signed rounding exclusion, preservation on OCR/manual edits and tax-source mapping.

Failure protocol: preserve first failure evidence, inspect siblings and next boundaries read-only, correct/retest locally before retry; no duplicate workflow dispatch. Main freeze starts with new release dispatch; old READY is superseded for this source. Production remains unchanged and held.

## Release ledger

- Candidate: pending
- Controller: pending
- UAT_RUN_ID: pending
- READY_RUN_ID: pending automatic run
- PROD_RUN_ID: none — not authorized
- Passport/READY digest and runtime config: pending
- Post-deploy business/browser/DB acceptance: pending

## Local acceptance — final candidate before PR

- Focused API OCR114, other API/LINE/tax335, web129, gateway73 and PostgreSQL16 tests passed. API typecheck passes with8GB heap; web/gateway typechecks pass. API default4GB previously exhausted memory; no product change was made for that environment limit.
- Real Bedrock candidate-v5:15 supplied images,14 with a printed final total all retain gross and printed VAT/WHT/net through actual OCR and in-memory apply. Partial Makro page1 has no invented final total and is not applied. Discounted hospital now preserves six priced rows. Pure FE projection has one financial representation for all14 accepted records. This is a small regression corpus, not a production accuracy estimate.
- Real local browser/API/PostgreSQL/MinIO E2E:11/11 passed at390px and1280px. Covers original form/theme, draft-save toast/reload, mandatory Next gates, optional purpose, permission/concurrency/network failures, known55-baht row preservation, and VAT+WHT with explicit1000-baht base/3%/30-baht WHT retained across reload. Invalid base/net is visibly blocked.
- Private logs `/tmp/receipt-tax-*.log`, model/financial/projection traces `/tmp/mangmee-receipt-eval-20260908/candidate-v5/`; generated browser screenshots in ignored `test-results/`. No customer images or model traces committed.
- Read-only UAT preflight passed (`infra/uat/verify-deploy-readiness.sh`). Canonical release and deployed UI acceptance still pending. CUA reports Mac locked after owner's unlock message; independent local browser tests do not prove the authenticated UAT session.
