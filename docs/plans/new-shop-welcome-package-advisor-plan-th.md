# New-shop welcome and LINE package advisor implementation plan

Date: 2026-10-30 (Asia/Bangkok)
Status: COMPLETE — IMPLEMENTED / LOCALLY VERIFIED; NOT DEPLOYED
Spec: [product/architecture/acceptance](../specs/new-shop-welcome-package-advisor-spec-th.md)
Memory: [task state](../agent-memory/new-shop-welcome-and-package-advisor-story.md)

## Baseline and scope

- User authorized implementation and Sol/Luna collaboration; current checkout retained because uncommitted free-receipt and signup work is part of the source being integrated
- Preserve every unrelated dirty file. No package.json/dependency changes, no deploy/cloud/real LINE/billing writes, commit/push only under the later explicit owner merge instruction
- Ponytail full; use existing onboarding audit, signup outbox/retry, API LIFF shell, catalog and identity handoff

## Work and ownership

1. Sol: durable new-LINE-shop creation marker and current-state welcome delivery, reuse approved event slot/key, scoped no-emoji receipt entry and meaningful regression tests. Own onboarding/provision/notification/receipt-command changes only
2. Luna: dedicated API LIFF advisor content/style/client, four-step interaction, dynamic catalog recommendation/result/error and tests. Own new advisor UI/client files only; parent supplies shared shell and route wiring contract
3. Parent: scope/spec/plan/memory, API route and shell script wiring, narrow billing handoff extension and checks, approved mascot asset reuse, integration/typecheck/browser QA

## Implementation details

- Dedicated advisor page `apps/api/src/common/security/line-package-advisor.page.ts`; dedicated script endpoint, no changes to existing shared LIFF behavior beyond optional trusted script selection
- Runtime dataset includes LIFF id, API base, system OA return URL, support URL and optional validated web base fallback; no tenant/private facts
- Parent/agent agree typed exports before edits. New script consumes public catalog and only posts ID token + validated billing offer/interval + user-selected company to existing liff/session on explicit navigation
- Canonical public catalog remains unchanged. Actual DEFAULT capacities are30/50/100/500 docs and2/5/10/30 users; rendering/matching follows runtime overrides, not these examples
- Reuse original approved mascot bytes rather than copying a UI screenshot or creating a new brand asset

## Verification and exit

- Focused Node tests of provisioning/delivery eligibility + retry, actual advisor script interactions/catalog logic, auth route CSP, narrow billing handoff
- Contracts/API focused typecheck; only broaden if a touched seam fails or integration evidence requires it
- Local HTTP page + exported JS + canonical-shaped catalog fixtures, actual browser clicks for four questions/result/back/error/unavailable/mobile; no real provider calls
- Record commands/results/limits and final scoped file changes. Amend free-receipt D03 and story scope to accepted new welcome only
- Completion means implemented and locally verified; native LINE/UAT/Production status remains explicit and separate

## Final evidence

- [Verification report and screenshots](../evidence/new-shop-welcome-package-advisor-2026-10-30/verification.md):555 backend +152 auth/client/handoff checks passed, full API TypeScript passed, SWC asset-copy smoke passed, actual browser320/390/1280 px verified.
- Spec-registration guard retains10 existing orphan specs; no new advisor orphan or package.json edits.
- Local acceptance A01–A09 covered by the report; native LINE/UAT/Production acceptance is separate and remains pending a release request.


## Authorized direct integration

Owner requested main/develop integration without PR on2026-10-30. Feature-only patch was adapted to current common baseline994a55fa1, preserving newer shared behavior. Fresh checks:1,094 tests passed, full API TypeScript and browser traversal passed. Deployment remains outside this request.
