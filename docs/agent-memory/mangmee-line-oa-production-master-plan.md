# Agent Memory: Mangmee LINE OA Production Master Plan

Status: IMPLEMENTATION_IN_PROGRESS — Broadcast and business-policy production slices completed 2026-07-12
Owner: Product/Engineering
Scope: Consolidated FE, BE, DB, workers, AI Gateway and LINE OA delivery plan for all modules in the 2026-07-10 design handoff.
Decisions:
- Design handoff is the visual source of truth, but prototype HTML/data are not production code.
- Existing real implementations are reused; mock/prototype paths are removed only after production routes pass.
- Company LINE OA stays separate from WatchDog shared LINE OA.
- Broadcast is a durable queued campaign workflow with consent and quota gates, not an HTTP send loop.
- Delivery uses parallel lanes by default with frozen contracts, single migration ownership and explicit integration gates.
Open questions:
- Broadcast image provider/moderation/cost.
- Send-now versus scheduling in first release.
- Object storage and retention policy.
- OTP provider and final PDPA campaign policy.
Artifacts:
- `docs/plans/mangmee-line-oa-production-master-plan-th.md`
Verification:
- Broadcast: contracts, Prisma campaign/recipient migration, permission gates, API repository/use cases/controller, AI generation, recipient snapshots, worker LINE delivery/retry, production web route and focused tests implemented.
- Owner-deferred features are now fail-closed: Broadcast is removed from navigation and its route/API remain disabled unless `CRM_BROADCAST_ENABLED=true`; poster and scheduling payloads are rejected; Phone OTP and LINE QR login are unavailable while password login remains active.
- Business policy: tenant-scoped Prisma migration/repository, API controller/use case, PO Approval and Discount Policy web persistence implemented.
- Retention and consent/unsubscribe defaults are tenant DB configuration. Exact configured unsubscribe keywords atomically revoke marketing consent, audit once, confirm once, and stop the AI/autonomy path; campaign delivery re-checks current policy and consent immediately before LINE send.
- Campaign metrics never equate LINE API acceptance with delivery: accepted is real, while delivered/open/click remain null until LINE Insights sync and reply/attribution remain unsupported until correlation exists.
- Login channel discovery now fails closed; real phone OTP remains blocked on provider/challenge-store choice and LINE QR login remains blocked on a login-specific OAuth/LIFF callback.
- Verification passed: inbound unsubscribe + business-policy suite 64/64, campaign/deferred/login/metrics focused tests 10/10, contracts build, web/workers/AI Gateway typechecks, Prisma validate, diff check.
- Full API typecheck remains blocked by pre-existing missing AWS SDK packages and employee Prisma baseline drift; no errors originated from the new slices.
Next:
- Configure an SMS OTP provider plus durable hashed challenge store, and design a login-specific LINE OAuth/LIFF state callback before enabling those login tabs in production.
- Run migrations against the integration database and execute a real test-OA allowlist campaign browser/UAT journey.
