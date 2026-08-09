# Agent Memory: MangmeePlus public legal notices

Status 2026-08-09: public Privacy, Terms, and Data Deletion surfaces are being aligned to repository truth and current Thai law. The copy is a production-oriented draft, not a substitute for unresolved operational controls or Thai counsel approval.

Plan: [[plans/mangmeeplus-privacy-terms-data-deletion-plan|MangmeePlus Privacy, Terms, and Data Deletion Plan]]

## Permanent product/legal decisions

1. Use MangmeePlus / มั่งมี and the legal operator บริษัท มั่งมียั่งยืน จำกัด, registration 0105569135722. Never reuse SudoChatBot or WatchDog BMS in these notices.
2. Separate roles: MangmeePlus is controller for platform-account, security, support, and service-operation data; a tenant is normally controller for its CRM customers, employees, counterparties, and business/accounting content; MangmeePlus is processor for that tenant content.
3. Do not advertise Google/Facebook login unless those providers are actually enabled and the notice is updated before collection. Current password login and LINE account linking are the supported facts.
4. AI/OCR is assistive. It may read/classify/summarize/propose actions and, where configured, draft or send CRM responses, but the user/tenant remains responsible for controls and human oversight. AI does not autonomously sign, approve, certify tax treatment, prove slip authenticity, or file returns with authorities.
5. Describe tax output as preparing/reviewing/exporting reports and filing packages. Do not say “ยื่นได้ทันที” unless an integration has confirmed submission and receipt status.
6. A service cancellation is not an erasure request. Never make a valid PDPA right conditional on a paid recovery window or delay it to a general one-year cleanup policy.
7. A platform account is global and can belong to several companies. Deleting one company removes that membership/workspace scope; it must not silently delete a member's account in other companies.
8. Accounting/tax/audit/legal-claim records can be retained or restricted where law requires. Do not use those exceptions to retain unrelated profile/marketing data.
9. A valid erasure request is targeted for completion normally within 30 days and, under the applicable 2024 rule, without delay and no later than 90 days, subject to identity/authority checks and lawful exceptions. Backups that cannot be immediately purged must be isolated from use and carry the deletion instruction through restore/overwrite.
10. Do not promise immediate physical attachment deletion until S3 objects and versions are actually deleted or governed by an approved lifecycle. Current generic delete is a database soft-delete.
11. The public LINE marketing opt-out commands `ยกเลิกข่าวสาร`, `หยุดโปร`, and `STOP` are a shared contracts invariant. Policy writes may add aliases but cannot remove these commands; reads repair legacy policies before matching.
12. Legal clickwrap occurs only after authentication and in the selected company-membership context. Terms require affirmative acceptance; the Privacy Notice requires acknowledgment that is expressly not consent or a waiver of PDPA rights; authority/access capacity is confirmed separately. None of the three required controls may be preselected.
13. Current legal evidence is append-only and server-authored: immutable artifact URLs and exact served-byte SHA-256 values, document versions, exact localized statements, display challenge, user/company/membership/capacity/roles, session/request metadata, and one server timestamp. Business API and employee LINE use remain gated until the current release is recorded; a capacity or release change requires new evidence.

## Public routes and shared source

- `/privacy`
- `/terms`
- `/data-deletion`
- `/legal-acceptance` (authenticated; company-scoped clickwrap gate)
- `/legal/releases/2026-08-09.2/terms-th.html` and `/legal/releases/2026-08-09.2/privacy-th.html` are the immutable Thai artifacts used by the current clickwrap release. The `.1` files remain preserved as prior append-only evidence.
- `apps/web/src/common/legal/legal-content.ts` is the public legal identity/date/source constant set.
- `apps/web/src/common/legal/LegalPage.tsx` is the accessible responsive legal-page shell.
- `packages/contracts/src/business-policy.ts` owns the mandatory marketing opt-out commands used by API policy validation and public copy.
- The login page must link all three notices before authentication.

## Implemented retention facts worth preserving

- Access token: 15 minutes; refresh/session: 7 days.
- AI conversation/turn default: 90 days with purge behavior.
- Business policy defaults include chat media 180 days, final campaign creative 730 days, unused AI candidate 30 days, pending/rejected slip 90 days, and accounting slips 7 years; applicability and actual purge jobs differ by category.
- Pending object uploads and generated report exports have short object-storage lifecycle rules.
- CRM text/media and finance/tax evidence have their own rules and exceptions.

Avoid flattening these into a single universal retention period.

## Operational blockers

- Verify public registered address and privacy mailbox ownership.
- Complete DPO assessment.
- Close DPA/subprocessor/cross-border evidence gaps.
- Implement generic account/company deletion and physical storage-version purge.
- Approve one retention register against live infrastructure.
- Fix or remove stale self-service AI opt-out claims.
- Revisit the new 2026 access/copy regulation on its 14 September 2026 effective date.
- Obtain final Thai counsel sign-off.
