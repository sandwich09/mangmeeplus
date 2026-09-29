# Billing: single administrator confirmation

Status: Owner approved 2026-09-16: one operator; support UAT and Production in code, deploy UAT only.

## Outcome and journey

A genuine active SYSTEM_ADMIN can finish their own billing request without creating another account. The operator reviews current amounts/rights and impact, gives a reason, verifies their current password, saves the request, then explicitly confirms it. Saving is not approval. Keep existing operation IDs, preview hashes, expiry, idempotency, before/after facts, cancellation and return/history routes.

This amendment supersedes the unconditional different-person requirement in the billing controls spec/plan for SYSTEM_ADMIN only. It does not authorize role elevation, synthetic identities, a direct database policy write, Production deployment or live charges.

## Authority and affected flows

- Reuse current server-verified platformScope (active system SYSTEM_ADMIN), exact action-management permission, and billing approval permission. A tenant OWNER, a similarly named tenant role, or a scoped billing delegate cannot self-confirm. Independent approval by an authorized different operator remains supported.
- Apply consistently to policy/gate publication, scheduled policy execution, billing operator company-scope grants, receipt gifts/revocations, package/capacity adjustments and reversions, paid free-day extensions, pause/resume collection, monetary refunds, and (2026-09-28, purchase-without-setup PR E) the admin document-recipient change (`UPDATE_BILLING_EMAIL`, `source: 'ADMIN'`, under `system.billing.override.manage`), and (2026-09-29, add-on plan PR B) the team add-on grant and revoke (`ADDON_ADMIN_GRANT`/`ADDON_ADMIN_REVOKE`, under `system.billing.override.manage`). AI quota and other actions that already use one authorized Admin retain existing controls.
- No environment-only bypass and no inferred authority from the number of users. Both TEST and LIVE apply the same role rule. No new role, environment variable, migration or approval-policy bootstrap is needed.
- Both preview/action availability and command execution use the same rule. Commands must recheck current permissions; async workers must recheck the genuine platform authority for self-confirmed commands before any new side effect. Losing platform authority blocks new execution even if delegated permissions remain. Already-dispatched uncertain outcomes remain observable under existing recovery rules.
- Keep current password proof, credential-version and role revocation checks, company/mode fences, provider readiness, financial bounds, source/version/lease/deadline guards, refund closed-by-default and atomic audit rollback. Do not relax monetary/refund eligibility or refund limits.
- Record the actual same user as initiator and approver. Expose and audit SINGLE_ADMIN versus SECOND_REVIEWER; never label self-confirmation as independent approval. Existing operations retain their original evidence.
- Granting company scope to an existing billing operator remains different from granting SYSTEM_ADMIN. Existing target restrictions and role administration remain unchanged. Scope administration rechecks admin.role.manage and does not additionally require financial-read access.

## UX and acceptance

Use short Thai copy: pending means awaiting confirmation, and privileged users can see a confirm button on their own request. Explain the single-admin option and current-password requirement without asking for an imaginary second user. Scoped delegates still see the need for another authorized reviewer. History shows who requested/confirmed and the confirmation mode; no private support information enters customer or LINE views.

Prove real HTTP/PostgreSQL/browser self-confirmation for each affected service, scheduled and worker execution, same-command retry, expired/changed source/password, loss of platform authority, ordinary OWNER and delegated self-denials, independent approval compatibility and audit evidence. The authority predicate is environment-independent; preserve existing TEST/LIVE provider/account fences. Local HTTP/browser proofs use simulated Stripe TEST; no native Production acceptance is claimed. Native UAT activation still requires a genuine Admin login. Full native paid E2E is separate from local simulations.
