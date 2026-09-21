# Agent Memory: package pricing consistency 2026-09-22

Status: VERIFIED LOCALLY — PROMOTION PENDING
Owner: Product owner / Codex
Scope: Align Enterprise package quota and purchaseability across contracts, API, customer billing UI, tests, official marketing site, main/develop promotion, UAT deployment, Cloudflare publication, and UAT shutdown.
Decisions:
- Enterprise remains the `full` entitlement preset; changing the card disclosure to six shared baseline menus must not reduce granted features.
- Enterprise quota is 500 receipts/month and 6,000 upfront for annual purchase; price remains 1,999/month and 19,990/year.
- Catalog cards hide the shared AI credit value. Negotiated sales-deal terms remain separate.
- Enterprise availability stays fail-closed when an exact provider Price binding is missing.
- No ERP Production deployment is in scope. The official marketing site is published through its existing Cloudflare path.
Open questions: None.
Artifacts: Package entitlement spec, sales-deals spec, contracts/API/web/E2E changes, marketing repo spec/runtime/tests.
Verification:
- PASS: contracts build/typecheck; API and web typecheck.
- PASS: billing domain 11/11; web billing deal 6/6.
- PASS: billing preview E2E 2/2 at 1280px and 390px against a fresh migrated/seeded PostgreSQL database; verified month/year selection, Enterprise 500/month and 6,000/year, shared six-menu disclosure, full Enterprise summary, enabled CTA, and hidden catalog AI credit.
- Marketing repo PASS: catalog tests 5/5, bundle syntax, and browser DOM/visual QA at 1440px and 390px with no horizontal overflow.
- Pending: CI, exact UAT acceptance, Cloudflare deployment/live-page check, and final UAT shutdown.
Next: Promote the verified commits to main+develop per repo, deploy and accept UAT once, stop UAT, and confirm the marketing publication.
