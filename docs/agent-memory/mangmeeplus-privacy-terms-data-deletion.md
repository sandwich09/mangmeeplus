# Agent Memory: MangmeePlus public legal notices

Status 2026-08-09: public Privacy, Terms, and Data Deletion surfaces are being aligned to repository truth and current Thai law. The copy is a production-oriented draft, not a substitute for unresolved operational controls or Thai counsel approval.

Plan: [[plans/mangmeeplus-privacy-terms-data-deletion-plan|MangmeePlus Privacy, Terms, and Data Deletion Plan]]

## Permanent product/legal decisions

1. Use MangmeePlus / มั่งมี and the legal operator บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722. Never reuse SudoChatBot or WatchDog BMS in these notices.
2. Separate roles: MangmeePlus is controller for platform-account, security, support, and service-operation data; a tenant is normally controller for content it places in its workspace; MangmeePlus is processor for that tenant content.
3. The v1 public legal copy is feature-neutral and names only data categories common to functions actually enabled for the user. Repository code, prototypes, and roadmap do not establish a public service promise.
4. Do not name CRM, LINE, OTP, AI/OCR, accounting, tax, marketing, filing, specialist reports, or another deferred function in the v1 public Privacy, Terms, or Data Deletion pages.
5. When a later function changes the service contract or processing facts, revise the notice first and cut a new immutable legal release; do not silently broaden v1 copy.
6. A service cancellation is not an erasure request. Never make a valid PDPA right conditional on a paid recovery window or delay it to a general one-year cleanup policy.
7. A platform account is global and can belong to several companies. Deleting one company removes that membership/workspace scope; it must not silently delete a member's account in other companies.
8. Data can be retained or restricted where a law, security need, contract, or legal claim requires it. Public v1 wording stays generic and retention must end when the supporting reason ends.
9. A valid erasure request is targeted for completion normally within 30 days and, under the applicable 2024 rule, without delay and no later than 90 days, subject to identity/authority checks and lawful exceptions. Backups that cannot be immediately purged must be isolated from use and carry the deletion instruction through restore/overwrite.
10. Do not promise immediate physical attachment deletion until S3 objects and versions are actually deleted or governed by an approved lifecycle. Current generic delete is a database soft-delete.
11. Feature-specific policy constants can remain in their owning contracts, but the public v1 legal module must not import or expose them when that feature is outside launch scope.
12. Legal clickwrap occurs only after authentication. Terms require affirmative acceptance; the Privacy Notice requires acknowledgment that is expressly not consent or a waiver of PDPA rights; authority/access capacity is confirmed separately. None of the three required controls may be preselected.
13. Owner decision 2026-08-10: acceptance is required once per **user + exact legal release**, then applies across every company accessible by that user. Company, membership, capacity and roles are immutable snapshots of the initial confirmation, not scope keys. A company/role/capacity change alone must not prompt again; a new Terms or Privacy artifact/statement release must.
14. Current legal evidence is append-only and server-authored: immutable artifact URLs and exact served-byte SHA-256 values, document versions, exact localized statements, display challenge, initial user/company/membership/capacity/roles, session/request metadata, and one server timestamp. Business API and employee LINE use remain gated until the current user has recorded the current release.
15. The first release describes only the neutral service boundary and functions visibly enabled for the user. Any newly named feature or materially new processing requires revised copy, a new release artifact, and re-confirmation.

## Public routes and shared source

- `/privacy`
- `/terms`
- `/data-deletion`
- `/legal-acceptance` (authenticated; user + legal-release gate with initial company evidence context)
- `/legal/releases/v1/terms-th.html` and `/legal/releases/v1/privacy-th.html` are the pre-launch Thai v1 artifacts used by the current clickwrap release. After v1 is launched/accepted in production, changes require a new v2 path and hash; every older dated development artifact remains untouched.
- `apps/web/src/common/legal/legal-content.ts` is the public legal identity/date/source constant set.
- `apps/web/src/common/legal/LegalPage.tsx` is the accessible responsive legal-page shell.
- Feature-specific contract constants remain outside the public legal-copy module.
- The login page must link all three notices before authentication.

## Implemented retention facts worth preserving

- Access token: 15 minutes; refresh/session: 7 days.
- AI conversation/turn default: 90 days with purge behavior.
- Business policy defaults include chat media 180 days, final campaign creative 730 days, unused AI candidate 30 days, pending/rejected slip 90 days, and accounting slips 7 years; applicability and actual purge jobs differ by category.
- Pending object uploads and generated report exports have short object-storage lifecycle rules.
- CRM text/media and finance/tax evidence have their own rules and exceptions.

Avoid flattening these into a single universal retention period.

## Verification 2026-08-10

- Contracts build, API typecheck, Web typecheck, and `git diff --check` pass.
- Focused legal/acceptance suite passes 23/23, including Login → latest public pages and Acceptance → exact immutable v1 artifact links.
- Browser QA at 320 px and 1280 px confirms no horizontal overflow on Login, Acceptance, Privacy, Terms, or Data Deletion.
- Public source and generated-artifact scan contains no CRM, LINE, OTP, AI/OCR, tax, filing, invoice, slip, report, or channel-specific opt-out claims.
- v1 hashes: Terms `d1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7`; Privacy `7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4`.

## Operational blockers

- Verify public registered address and privacy mailbox ownership.
- Complete DPO assessment.
- Close DPA/subprocessor/cross-border evidence gaps.
- Implement generic account/company deletion and physical storage-version purge.
- Approve one retention register against live infrastructure.
- Fix or remove stale self-service AI opt-out claims.
- Revisit the new 2026 access/copy regulation on its 14 September 2026 effective date.
- Obtain final Thai counsel sign-off.
