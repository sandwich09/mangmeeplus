# Billing/package integration verification — 2026-09-11

Verified integration candidate based on develop `4153bbe9` and main `12025691`, with the scoped Stripe/Postmark/signup/package/admin/web/LINE changes from the working tree. The sibling marketing candidate starts at `9cc2ae6`. [Scope](scope.json) lists the selected files; unrelated expense/deployment work was not imported. The upstream migration-history repair is retained by the main/develop history merge, without running migrations or deployments.

| Current merged-tree check | Result |
|---|---|
| API access, entitlement, LINE and tools | [550 PASS](api.tap) |
| Gateway/AgentCore | [294 PASS](gateway.tap) |
| Web access/plan logic | [75 PASS](web.tap) |
| User feature use cases | [257 PASS](user-features.tap) |
| Billing, auth, LIFF, rich menu and lifecycle | [318 PASS](billing-auth.tap) |
| Total focused cases | **1,494 PASS**, zero failed/skipped/cancelled |
| API and web production-source TypeScript | Exit 0; [API](api-typecheck.txt), [web](web-typecheck.txt) |
| Actual sibling marketing bundle in Chromium | [1440px and 390px PASS](marketing.txt), zero external POST |

These are new results on the integration candidate. Earlier evidence folders retain their original results and source hashes. Counts differ from the earlier 1,165 because the upstream tree has additional tests and this merge also reruns the billing/auth slice. This is not a new complete browser/API/database/LINE/Stripe acceptance run. Stripe runtime, AP21 history/source authorization and AP22 final-delivery reauthorization remain open as described in the [audit](../../research/package-access-admin-web-line-audit-2026-09-11.md) and [plan](../../plans/mangmee-package-entitlements-plan-th.md).

The first local attempt lacked generated Prisma and built contracts in the new worktree. Its setup errors are retained in `setup-incomplete-*`; after generating the current schema client and compiling contracts, all final commands exited 0. No assertions were relaxed. Installed dependencies were reused locally; tsconfig aliases, generated Prisma and compiled web contracts belong to this integration worktree.

Two patch conflicts were resolved: preserve the latest upstream LINE imports and add `hasToolFeature`; retain upstream expense error labels and exclude two unrelated dirty expense labels. One billing-plan link to an uncommitted separate cost analysis was converted to plain context; no pricing or commercial policy changed.

Reproduction prerequisites: install the locked dependencies, run `prisma generate` from `apps/api` and `tsc -p packages/contracts/tsconfig.json` from the repository root, then run [verify-current.sh](verify-current.sh). It executes focused suites, production-source typechecks and the real sibling marketing browser check. Keep both repositories beside one another for cross-repository documentation and marketing checks. [verify-merge.py](verify-merge.py) verifies document links, catalog parity, recorded counts and source hashes without rewriting previous evidence.

CI run `34612309108` stopped before tests because the existing exact-file maintenance pins were stale. The repository generator refreshed six auth/session digests and the validator digest; its `--check` passes. Only digest values changed, with no security policy weakening or live operation. Source/docs/script diff checks pass; historical raw `.tap`/`.log`/`.txt` evidence preserves its original whitespace.

CI runs `34612529926` (develop) and `34612588188` (main) passed typechecks and the dedicated PostgreSQL steps, then failed the default API suite: the new rich-menu regression used a working-directory-relative manifest path and the new LIFF spec was not registered with an owned runner. The manifest now resolves relative to its test file, and the LIFF spec is registered in the existing whole-chain API suite. No package.json, production behavior, assertion or exclusion is changed. After these test-only fixes, the package-directory reproduction passes **92/92** and the catalog check passes **4/4**; these overlap the earlier focused tests and must not be added to the 1,494 as unique cases. The 1,494 run predates these two test-wiring fixes. The subsequent GitHub runs are the authority for full-suite completion.

```sh
# Run from apps/api, matching the default CI package working directory:
../../node_modules/.bin/tsx --test --test-reporter=tap src/common/security/liff-start-handoff.spec.ts src/modules/line-ai/line-first-signup-webhook.spec.ts src/spec-suite-coverage.spec.ts
# Run from the repository root:
node --test scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs
```
