# Agent Memory: Main website content/layout prototype

Status: Complete — local prototype and review evidence ready.
Owner: Codex with site owner.
Scope: User requested a prototype placing content/layout from the Thai main-website guideline. This is a local design deliverable, not production implementation or URL migration.

Decisions:
- Follow ../research/mangmee-thai-main-website-guideline-2026-10-20-th.md and the existing homepage-only direction.
- Plain HTML/CSS/JS under docs/prototypes/mangmee-main-website; no framework, package changes, APIs, uploads or payments.
- Complete sequence: hero, interactive sample receipt journey, use cases, review/control, monthly pricing, FAQ, final LINE CTA/footer.
- Reuse green brand palette and Anuphan/Inter. Clearly label sample documents/UI as illustrative.
- Separate visible login from LINE start; local package actions explain the next step before an optional external LINE link.
- Show four monthly reference plans from existing marketing source, with a prototype pricing note; do not claim live catalog validation.
- Add a small preview shell for desktop/mobile width switching. Preserve direct access to the standalone page.
- Ponytail full and Sites local-preview/design guidance applied. No registration or hosting publication is needed for this requested prototype.

Product and acceptance:
- A Thai SME owner can identify receipt/expense support via LINE and the human review step.
- Primary CTA, demo, pricing and login are easy to find on desktop and at 390px.
- Sample steps, FAQ, mobile menu and package dialog work without changing external state.
- Keyboard focus, readable Thai, reduced motion and absence of horizontal overflow are checked.

Implementation plan:
1. Build the self-contained page and small preview shell.
2. Serve locally and show a recognizable preview.
3. Inspect desktop/mobile and exercise the sample flow, FAQ/menu/dialog.
4. Save screenshots and focused verification evidence; update this memory.

Open questions:
- Final copy, production capability/readiness, real demo assets and target-user comprehension remain to be validated before release.

Artifacts:
- ../prototypes/mangmee-main-website/index.html
- ../prototypes/mangmee-main-website/preview.html
- ../prototypes/mangmee-main-website/README.md
- ../evidence/main-website-prototype-2026-10-20/verification.json
- ../evidence/main-website-prototype-2026-10-20/desktop-full-page.jpg
- ../evidence/main-website-prototype-2026-10-20/desktop-home.jpg
- ../evidence/main-website-prototype-2026-10-20/mobile-home.jpg

Verification:
- Served both HTML pages on loopback HTTP; both returned 200.
- Inspected desktop 1512px and mobile iframe 390px; document scroll widths matched viewport widths.
- Exercised all three sample steps and reset, FAQ expansion, mobile menu open/anchor-close, Pro plan dialog, and Escape dismissal.
- Checked visible Thai copy, login/LINE distinction, sample labels, all four reference prices, semantic headings, focus-visible styling and reduced-motion rules.
- Fixed hero caption/chat overlap. Measured caption clearance after the fix: desktop 18.71px, mobile 17.01px; re-inspected mobile screenshot.
- Browser warning/error log check returned an empty list.
- Python HTMLParser checks passed: unique IDs, local anchor targets, safe new-tab rel, no forms, noindex.
- Extracted inline JavaScript from both files and ran `node --check`; both passed. Static scan found no API/storage calls.
- No production app tests run: no production code changed. No production links, purchases or accounts exercised.
- Full-page and mobile screenshots saved. File-protocol browser access was blocked by URL policy; no workaround attempted. Tested HTTP path and saved local artifacts instead.
- Local preview server stopped after evidence capture; README records how to reopen.

Next: Owner reviews layout/copy. Before production implementation, validate product capabilities/live catalog, replace sample UI with consented real evidence, and test comprehension with Thai target users. URL migration and deployment remain separate planned work.

## Revision 2 — commercial coverage and stronger color

Status: Complete — v2 content, color and comparison prototype ready.
Trigger: Owner asks whether all sold features are represented, finds v1 too pale, and questions whether it merely follows the old website.

Findings:
- V1 is not a complete sales-feature presentation: reimbursement, manual entry, evidence/export, substitute receipt/signatures, dashboard/notifications, company settings/security and Enterprise WHT rights are absent or too implicit.
- Read the cloud operations runbook's current inventory and readback cautions before a public, unauthenticated catalog GET. No infrastructure, sessions, models or customer data were accessed.
- Fresh public catalog at 2026-10-20T09:40:02.124Z is LIVE. All eight offers are AVAILABLE. Starter/Basic/Pro share the same 17 feature keys; Enterprise adds wht_pnd53 and wht_50bis. Catalog revision c76e1505e22444f93da5f7208e15a07f2f42b96f621dc5be8deea764496722be.
- Catalog proves sold entitlement scope, not completion of every enabled journey or legal output readiness. The October11 spec-only amendments do not establish a live feature.
- Current official site visually uses a pale green gradient, large dark hero, mock dashboard and animation. It contains broader commercial/automation claims that need review, including automatic bookkeeping, trial-independent timing and booking/income-related language. Do not copy those as verified claims.
- No conversion or Thai-user study establishes either design as better.

Plan:
1. Preserve v1 as index-v1.html; update the existing local index to v2 and add a version selector to preview.html.
2. Use stronger forest green, vivid lime and a small warm-yellow accent with clear white sections. Keep recognizable branding and LINE/login journeys.
3. Add a visible six-group feature overview covering all 17 common entitlement keys, and identify Enterprise's two extra keys. Add a monthly/yearly pricing preview from the saved catalog, with actual annual totals/allowances and clear snapshot labeling.
4. Record a feature-to-content map and current-site comparison. Do not add unsold CRM, stock, sales, general ledger or automatic tax filing.
5. Verify version/viewport/pricing controls, changed copy, keyboard behavior and mobile overflow; save v2 screenshots. Stop the owned local server after capture.

Acceptance: Owner can compare v1/v2, identify the complete catalog feature groups and the Enterprise difference, read annual billing amounts correctly, and distinguish sample UI from production behavior. No publication or production changes.

Implementation/evidence:
- Preserved index-v1.html; preview.html selects v1/v2 and desktop/mobile; index.html now contains v2.
- Added six content groups mapped exactly to all 17 common keys, plus both Enterprise-only keys. Mapping assertions pass. No unsold ERP module was added.
- Added monthly/yearly comparison from the saved public catalog; monthly 249/499/999/1999 and annual 2490/4990/9990/19990; annual receipt units 360/600/1200/6000. Prototype shows normal prices and explicitly excludes temporary promotions; the catalog also returned a temporary Starter bonus that this design does not advertise.
- Browser checks passed at 1512px and 390px with no horizontal document overflow; year/month prices and allowances, Enterprise annual dialog/Escape, v1/v2 switching, mobile feature navigation and six visible feature groups verified. Browser error/warning log empty.
- HTML IDs/anchor targets/new-tab rel and inline `node --check` pass for all three files. Captured full-page desktop, mobile hero, annual pricing, current-site reference, feature mapping and verification under ../evidence/main-website-prototype-2026-10-20/v2/.
- Fixed Thai heading wrap in pricing and increased contrast of small numbers on the yellow strip.
- Local server teardown follows screenshot capture. Production remains untouched; only the public catalog and official website were read.

Design judgment:
- Retain the recognizable green brand, LINE as a familiar starting point, a visible product example, and owner/team use cases.
- V1 made the palette too pale and narrowed the offer to receipt capture; it is not recommended unchanged as the full sales website.
- Current official page has a stronger headline/dashboard illustration but repeats promises and contains claims needing scope/evidence review (automatic bookkeeping, full tax/booking/income-related implications, accuracy/timing and popularity labels). Existing marketing copy is not product proof.
- Recommend testing v2's stronger contrast and complete grouped offer against the existing site. Neither taste nor a trend proves higher conversion or a Google ranking increase.

## Research grounded SaaS UX review

Status: Complete — critique and recent research saved; target-user testing and v3 remain future work.
Trigger: Owner requests a senior SaaS UX/UI review grounded in real, credible, recent research.

Decisions:
- Interpret the requested experience level as a rigorous review perspective, not a claim of personal professional tenure.
- Prioritize 2023–2026 publications; retained core evidence is 2024–2025 with methods and limits checked. Publication year is distinguished from data-collection dates.
- Read Figl et al. 2025 original experiment (107 UK/US participants, 16 banking pages), Punsongserm/Suvakunta 2024 original Thai mobile-reading experiment (30 Thai volunteers, 5 apps), ETDA 2025 official mini report, and WCAG 2.2 December 2024.
- Do not use the 1997/2002/2012 studies as the main basis. Exclude Kuen et al. 2023 from contemporary behavioral evidence because the meta-analysis only includes pre-2020 data.
- ETDA mini report is contextual evidence: sampling/fieldwork detail is insufficient to assess representativeness. Its 2.45 score is for five dimensions; 2.40 includes Data Analytics. Do not conflate them.
- Highest-priority recommendations: clearer buyer outcome, real product proof, readable mobile pricing/plan fit, and explicit CTA/onboarding expectations. Retain familiar login/navigation and improve color hierarchy without asserting conversion gains.
- Complete entitlement coverage is not proof of a complete persuasive journey or runtime readiness.

Artifacts:
- ../research/mangmee-main-website-saas-ux-review-2026-10-20-th.md
- ../evidence/main-website-ux-review-2026-10-20/source-manifest.json
- Existing Thai homepage guideline links to this review.
- Downloaded source PDFs and rendered research pages are in the task's visualization workspace; large PDFs are not added to the repository.

Verification:
- Reused saved v2 desktop/mobile screenshots and browser evidence; inspected current HTML/CSS and commercial feature mapping.
- Confirmed mobile pricing CSS uses two columns with 10–12px material details.
- Confirmed plan dialog changes its heading but does not carry the selection into its static LINE URL.
- Read original study methods and result limitations. Inspected ETDA PDF pages 11/17 visually and Thai typography study's methods/results.
- Report readback and six local links passed; source manifest parses and contains verified hashes for both original PDFs. Scoped `git diff --check` passed.
- Documentation-only change: no application tests, server startup, external CTA activation, production operations, interviews, user tests, or conversion experiment.

Next:
- Implement the prioritized prototype changes when that work is requested.
- Validate real demo assets and onboarding contract, then conduct the proposed Thai buyer comprehension and plan-selection tasks.

## Revision 3 — Claude Design canvas, copy deck and SEO content

Status: Complete — prototype only; nothing deployed, live official site unchanged.
Trigger: Owner asks for a Claude Design prototype with full content, aimed at purchase intent and first-place Google/AI-answer visibility; "อย่าพึ่งดีพลอยจริง".

Decisions:
- Built in Claude Design (Artifact type Design), not plain HTML: canvas https://claude.ai/artifact/M2MVVV99nKaxXt33yME1Nm (private until shared). Four fluid artboards: home 1440, home 390, pricing/package chooser 1440, pricing 390. Canvas source stays in the artifact, not committed.
- Kept homepage-only per SEO plan; pricing is the home `#pricing` section shown in full on its own artboard. BreadcrumbList documented for future subpages only.
- Fixed UX review items 1–5: hero H1 = guideline set A plus "คุณตรวจ แล้วค่อยยืนยัน"; one-picture flow with who-does-what tags; price/no-trial/after-click text beside CTA; "AI อ่านผิดได้" correction example; job-based feature story (3 jobs) still covering all 6 FEAT groups + ENTERPRISE; single-column mobile pricing with 4-question chooser (default = review example → BASIC); comparison table; no "ยอดนิยม".
- Added quotable "มั่งมีพลัสคืออะไร" answer + facts list, 12 FAQ written as real questions (incl. loan-brand disambiguation), JSON-LD graph (Organization, WebSite, SoftwareApplication with 8 Offers, WebPage, FAQPage). FAQPage kept only because live site already has it; Google FAQ rich results ended May 2026.
- llms.txt drafted as optional/low priority because Google states it has no ranking effect.
- Shipped facts used: ENTERPRISE issues 50 ทวิ/ภ.ง.ด.53 in system; others record outside-system 50 ทวิ with number + optional image/PDF; claim flow ส่ง → อนุมัติ → จ่ายเงินคืน → เซ็น (system or paper); dashboard any date range. Login link app.mangmeeplus.com/login.
- Vocabulary follows docs/guidelines/thai-ux-standard.md glossary (ร้าน, ใบเบิก, จ่าย, ใบเสร็จ N ใบ, หนังสือรับรอง 50 ทวิ, ทีมงานมั่งมี).

Open questions (owner): H1 set A vs B test; title change; root-domain timing/canonical; homepage-only vs pricing page; STARTER promotion (ends 2026-11-10 23:59 ICT); llms.txt; demo clip.

Artifacts:
- ../prototypes/mangmee-main-website/v3/content-th.md
- ../prototypes/mangmee-main-website/v3/README.md

Verification:
- Both JSON-LD blocks parse; 12 canvas FAQ Q/A strings equal FAQPage text exactly; content-th.md relative links resolve.
- Artboard logic classes run in node: default chooser → BASIC 499/month; yearly prices 2,490/4,990/9,990/19,990 and receipts 360/600/1,200/6,000 match catalog.
- Artboard HTML tag balance checked with Python HTMLParser (no unclosed/mismatched tags).
- Computed contrast for all text/background pairs ≥ 5.46:1 (table dash fixed from 4.42:1 to 7.05:1).
- Not done: real-browser render at 390/1280, screen reader, 200% zoom, Lighthouse, target-user tests. The Design type forbids self-rendering checks unless the owner asks.
- No PR, no GitHub Actions, no deploy, no AWS/UAT/Production/LINE changes.

Next: Owner decisions above; verify claims table in content-th.md §7; replace mock visuals with consented real screenshots; comprehension test with 6–8 Thai owners; then marketing-repo implementation under SEO plan R0/S1–S4.
