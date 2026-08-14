# Agent Memory: MangmeePlus public legal notices

Status 2026-08-09: public Privacy, Terms, and Data Deletion surfaces are being aligned to repository truth and current Thai law. The copy is a production-oriented draft, not a substitute for unresolved operational controls or Thai counsel approval.

Status 2026-08-10 v2 implementation: web copy, immutable Terms/Privacy artifacts, current acceptance contract, production contract pin, evidence-manifest version, and focused regression coverage are implemented and verified. Every v1 artifact remains byte-for-byte unchanged. `docs/security-evidence/legal-release-evidence.json` remains `BLOCKED` until the external evidence and exact-hash Thai-counsel approval are complete.

Status 2026-08-14 intermediate counsel-copy sync (superseded by the official first edition below): the three counsel-ready Word documents were compared with the rendered public pages. At that checkpoint their substantive legal blocks already derived from and matched v2; the public pages were updated only for counsel-copy title, standfirst, heading, and effective-date phrasing. `LEGAL_LAST_UPDATED` was 14 August 2026 while the candidate legal effective date remained 10 August 2026. The later owner decision below replaced this intermediate candidate with the official first-edition v3 bytes and 14 August 2026 effective date.

Status 2026-08-14 official first edition: owner designated the settled public/counsel copy as official document version 1.0. Every user-facing web, DOCX, and PDF label now says “ฉบับที่ 1” or `1.0`; the effective and last-updated date is 14 August 2026. The acceptance system uses internal append-only release id `v3` so historical v1/v2 bytes and any prior evidence cannot be rewritten or confused with the official document numbering. The current contract therefore requires acknowledgment of the new v3 bytes while displaying official version 1.0.

Status 2026-08-14 deployment candidate: the reviewed target is UAT `all` followed by Production `maintenance_closed`; customer launch remains closed. Local source/build/deployment-contract proofs are complete. The repository manifest deliberately remains `BLOCKED` and no checked-in file is represented as signed counsel evidence. A later `live` request must validate the returned signed bundle against the exact v3 bytes and use an unexpired fresh Passport/READY.

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
9. A valid erasure request must be handled without delay and no later than 90 days under the applicable 2024 rule, subject to identity/authority checks and lawful exceptions. Access/copy requests under section 30 must be handled without delay and no later than 30 days from receipt. Do not claim complete backup, object-version, or provider deletion until the exact scope is verified by operational evidence.
10. Do not promise immediate physical attachment deletion until S3 objects and versions are actually deleted or governed by an approved lifecycle. Current generic delete is a database soft-delete.
11. Feature-specific policy constants can remain in their owning contracts, but the public v1 legal module must not import or expose them when that feature is outside launch scope.
12. Legal clickwrap occurs only after authentication. Terms require affirmative acceptance; the Privacy Notice requires acknowledgment that is expressly not consent or a waiver of PDPA rights; authority/access capacity is confirmed separately. None of the three required controls may be preselected.
13. Owner decision 2026-08-10: acceptance is required once per **user + exact legal release**, then applies across every company accessible by that user. Company, membership, capacity and roles are immutable snapshots of the initial confirmation, not scope keys. A company/role/capacity change alone must not prompt again; a new Terms or Privacy artifact/statement release must.
14. Current legal evidence is append-only and server-authored: immutable artifact URLs and exact served-byte SHA-256 values, document versions, exact localized statements, display challenge, initial user/company/membership/capacity/roles, session/request metadata, and one server timestamp. Business API and employee LINE use remain gated until the current user has recorded the current release.
15. The first release describes only the neutral service boundary and functions visibly enabled for the user. Any newly named feature or materially new processing requires revised copy, a new release artifact, and re-confirmation.
16. v2 may name only the declared first-production scope: employee accounts/access; expenses, receipts and reimbursements; employee LINE receipt-image intake and read-only bill questions; OCR/AI assistance; and security/legal evidence. CRM customer and marketing functions remain excluded.
17. v2 must distinguish the 30-day access/copy deadline from eligible erasure, which must be handled without delay and no later than 90 days subject to lawful exceptions. Do not publish a universal 30-day rights rule, a universal one/two-year log rule, a fixed 30-day recovery buffer, or 15/30-day payment grace numbers without the separate approved policy and operating support.
18. A whole-workspace deletion request requires written authority matching the current DBD signing condition or a lawful power of attorney. A company stamp is required only when the signing condition or actual corporate practice requires it; an administrator login alone is insufficient.

## Public routes and shared source

- `/privacy`
- `/terms`
- `/data-deletion`
- `/legal-acceptance` (authenticated; user + legal-release gate with initial company evidence context)
- `/legal/releases/v3/terms-th.html` and `/legal/releases/v3/privacy-th.html` are the current immutable Thai acceptance artifacts for official document version 1.0. The internal URL version is evidence metadata, not the user-facing document edition. Data Deletion remains a public procedure page rather than a third clickwrap document.
- `/legal/releases/v1/` and `/legal/releases/v2/` remain immutable historical artifacts and are covered by regression hashes.
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

- Contracts build and Contracts/API/Web typechecks pass; `git diff --check` passes.
- Focused contract, Web legal/acceptance, and API acceptance suites pass 24/24. The E2E legal scenario now also requires the public Data Deletion route and its 90-day text, but the full browser E2E environment was not started for this copy-only change.
- Legal release readiness and evidence-provisioner specs pass. The checked-in unresolved v2 manifest is still rejected as intended.
- Regenerating Terms and Privacy from current source reproduces their checked-in v2 SHA-256 hashes exactly.
- Public source and generated-artifact scans contain the declared employee/receipt/LINE/OCR/AI scope, exclude CRM from the launch scope, and contain no named unverified AI provider or universal hard-delete claim.
- v1 hashes: Terms `d1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7`; Privacy `7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4`.
- v2 hashes: Terms `09fe321666d7fd554544a7cf3c9a7e1c192e71a5ff47fb1c98bbc1c165d63281`; Privacy `5edcb642f8e9ca8e736804d0a732979228822f8183fa602afb4de5e372a67efd`.
- Current contract source hash and production workflow pin: `6a4f4c3db12a452afee62f3560a10bc9bbe594d6d9053a9bcdd044f496bb66f8`.

## Verification 2026-08-14 intermediate counsel-copy sync (superseded)

- Machine comparison rendered `/privacy`, `/terms`, and `/data-deletion`, then compared their normalized text with the counsel-ready DOCX files. Titles and standfirsts match exactly; counsel-body blocks matched 95/95, 75/75, and 62/62 respectively.
- The Terms signature placeholder “วันที่ระบุในหนังสือรับรองผลการตรวจและอนุมัติ” was compared against the public page's actual effective date, 10 August 2026; signature-control tables and document formatting are intentionally not web copy.
- `pnpm --filter @watchdog-bms/web exec tsx --test src/common/legal/legal-content.spec.ts` passes 6/6.
- Immutable v1/v2 files and `CURRENT_LEGAL_DOCUMENTS` were not edited; their previously recorded SHA-256 values remain the acceptance evidence.

## Verification 2026-08-14 official first edition

- Current internal v3 artifacts regenerate deterministically: Terms `67757a8237de6cd962a7325300d2bbd9a0649f1f273aa1c4972beb1155c1c05a`; Privacy `1e224b9f5f8830a22fe10edb840fd8e01edeaafcd69862a28f1beda59c43b87d`.
- Current acceptance contract source hash and production workflow pin: `8cc9cdaf9fa885cda83d1b867ccedf31fb3690a0a7d7bdf13951773ab1825387`.
- Contracts 3/3, Web legal/acceptance 8/8, and API legal acceptance 14/14 tests pass. Legal readiness and evidence provisioner specs pass with release `v3`; the checked-in evidence manifest remains deliberately `BLOCKED` until real external evidence is attached.
- Public rendered pages match the final DOCX titles/standfirsts and all normalized legal blocks: Privacy 95/95, Terms 75/75, Data Deletion 62/62. No final DOCX contains `v2`, `2.0`, `-002`, the prior effective date, or draft/merge labels.
- The five DOCX files and five PDFs were rendered and visually reviewed across 37 pages. Embedded hashes in the counsel approval memo match 3/3 legal DOCX files; the submission letter matches all 4/4 attached DOCX files. The final manifest verifies all 10 files and the ZIP contains exactly those files plus the manifest.
- Reproduced from the current repository: Contracts legal tests 3/3, Web legal/acceptance tests 8/8, API legal acceptance tests 14/14, full Web tests 898/898, Contracts/Web/API typechecks, Contracts/Web/API production builds, legal validator/provisioner specs, deterministic v3 rendering, maintenance pin sync and the full production image security aggregate all pass. `git diff --check` passes.
- The final counsel DOCX/PDF/ZIP package is external to this repository and was not independently re-opened during deployment verification. The checked-in deploy candidate therefore binds only the exact immutable v3 HTML bytes above; signed-evidence readiness remains fail-closed until the returned files are supplied and validated.

## Operational blockers

- Verify public registered address and privacy mailbox ownership.
- Complete DPO assessment.
- Close DPA/subprocessor/cross-border evidence gaps.
- Implement generic account/company deletion and physical storage-version purge.
- Align the workspace-deletion authority workflow with the public DBD/POA rule; current owner membership alone must not authorize whole-workspace deletion.
- Restrict pilot LINE tools and feature entitlements to the declared employee/receipt/read-only scope; CRM and other undeclared tools must be deny-by-default before release.
- Approve one retention register against live infrastructure.
- Fix or remove stale self-service AI opt-out claims.
- Revisit the new 2026 access/copy regulation on its 14 September 2026 effective date.
- Obtain final Thai counsel sign-off.
