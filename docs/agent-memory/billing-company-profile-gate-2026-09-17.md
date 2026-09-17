# Agent Memory: Billing company profile prerequisite

Status: Implemented; local acceptance passed; PRs #610 (main) and #611 (develop) awaiting corrected exact-head CI.
Owner: thawatchai + Codex
Scope: Approved purchase prerequisite popup, safe company-form return, billing document name/address and surrounding impact; deliver earlier LINE summary, signup discovery and company TSIC/admin work together.
Decisions:
- Registered name (trimmed) always wins; fallback to company/shop name when blank. Required: line1, subdistrict, district, province, Thai five-digit postal code; line2 optional. Business type, discovery, tax ID and VAT answer are not new purchase prerequisites; existing verified email still applies.
- Share normalized readiness in status and quote. Reject incomplete or changed snapshots before new INITIAL/RESTART/REPEAT/UPGRADE checkout. PostgreSQL jsonb key order must not invalidate unchanged data.
- Send the selected name and all address pieces to the company-bound Stripe Customer, both new and existing. Preserve past documents and already-issued payment recovery. Profile-only ambiguous writes retain the attempt barrier until the original idempotent command settles; aged or unresolvable writes remain held for review.
- Popup lists missing fields; whitelist same-company offer/interval/channel return. Saving returns to explicit purchase review and never charges automatically. Expired owners can repair this form through exact routes while tenant/permission/legal/platform/company holds remain enforced.
- Work in isolated delivery worktree `../mangmeeplus-company-profile-billing-20260917`, branch `codex/company-profile-billing-20260917`. Original shared workspace and unrelated dirty docs are untouched.
Open questions: None. User explicitly approved implementation and merges after CI; no live deployment requested.
Artifacts:
- `docs/specs/billing-company-profile-gate-spec-th.md`, `docs/plans/billing-company-profile-gate-plan-th.md`.
- Shared billing-company-profile contract; API quote/checkout/reconciler/repeat checks; web popup, profile navigation and document review.
- Additive TSIC and discovery migrations are recorded in their respective task memories.
Verification:
- Real Nest HTTP + PostgreSQL + Next/Chromium at 390/1280 px: missing popup → expired-owner form save → original annual PRO/LINE selection → registered-name/address review → explicit Stripe handoff PASS; no checkout before confirmation. Provider simulation only, no real charge. Evidence `/tmp/company-tsic-check/billing-browser/`.
- API focused suite: 300 passed, none skipped (auth, signup, TSIC and admin). Profile timeout recovery unit: 1 passed. Web focused suite: 151 passed, none skipped. LINE summary/security suite: 218 passed, none skipped. Shared master/profile: 2 passed.
- All migrations from empty task-owned PostgreSQL database PASS; Prisma generate, contracts/config/API build PASS. Monorepo typecheck PASS. Actual PostgreSQL/HTTP customer journeys PASS (90 scenarios: initial/repeat/restart/upgrade/downgrade/capacity/history/tenant/owner/provider recovery). Offer matrix PASS for all 12 combinations of paid tier, month/year and web/LINE.
- Official Stripe references checked 2026-09-17: https://docs.stripe.com/invoicing/customer and https://docs.stripe.com/api/customers/create. Existing pinned API version retained.
- Integrated latest main `f6dda9a3` cleanly. Initial PR CI `35249736508` / `35249759035` stopped before fan-out because adding focused tests changed the pinned CI file. Regenerated exact local maintenance pins with the repository script; no release workflow dispatched. Company profile remounts per company to prevent stale form state crossing a switch.
Next: Exact-head CI for PRs #610/#611, then merge both and record result. No UAT/Production operation in scope.
