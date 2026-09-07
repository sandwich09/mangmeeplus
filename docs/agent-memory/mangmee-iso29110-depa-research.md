# Agent Memory: MANGMEE ISO/IEC 29110 and depa research

Status: Research and requested document package complete, 2026-09-06. Human signatures, scope approval and missing release/UAT/acceptance evidence remain company actions; certification readiness and program eligibility are not confirmed.
Owner: Codex (research and document preparation); named company/process owners not supplied.
Scope: Official ISO/IEC, depa and SME Spring Board/BDS sources plus existing local documentation. No application submission, cloud operation, runtime change or fabricated historical evidence.
Decisions:
- Treat the user's request as research for MANGMEE as a software service provider; distinguish it from the SME buyer subsidy and depa certification voucher.
- Reuse existing guidelines, deployment memories and bug/incident records. Do not claim these three areas are absent or assert 70–80% audit readiness.
- The 13-item list is a working index pending assessor confirmation. Additional checks include scope/baseline approval, traceability, acceptance/closure and repository/configuration control.
- depa page says Batch 2 but its linked 2569 PDF shows round-1 June dates. Current enrollment availability is not confirmed.
Open questions: Actual certification body/checklist/edition; headcount/voucher eligibility; Catalog/BDSP status; target application round; external proposal/risk/pilot/approval evidence; named human accountable owners. Legal entity name confirmed by user.
User update: User requested ready-to-use missing documents and confirmed the company name บริษัท มั่งมียั่งยืน จำกัด. Human signatory names/positions were not supplied; preserve blank signature fields. Prepare DOCX and XLSX using source-backed cases plus clearly labeled pending approvals/UAT, with portable evidence snapshots.
Artifacts:
- `docs/research/mangmee-iso29110-depa-gap-analysis-2026-09-06-th.md`
- `docs/deliverables/iso29110-2026-09-06/reference/depa-iso29110-program-2569.pdf` — unchanged public source downloaded from the Google Drive link in depa's announcement.
- `docs/deliverables/iso29110-2026-09-06/` — canonical expanded22-file package. The byte-identical transport ZIP was removed during owner-authorized cleanup; recreate an archive from these files when needed. The separately retained reference directory is not part of the submission manifest.
- `docs/deliverables/iso29110-2026-09-06/MANGMEE_ISO29110_Documents.docx` — nine pages: document control, historical CR, one-page new CR form, two-page Development Guideline, deployment and maintenance forms, proposed pilot baseline and acceptance form.
- `docs/deliverables/iso29110-2026-09-06/MANGMEE_ISO29110_Registers.xlsx` — seven sheets; CR 2, deployment/recovery 2, maintenance 3, traceability 6, evidence 18, pending submission items 9.
- Package includes `README_TH.md`, `evidence-manifest.json` and 18 evidence snapshots with sources and SHA-256 hashes.
Verification:
- Read official ISO 4-1:2018 and 5-1-2:2025 metadata, depa 2569 announcement/linked six-page PDF, and BDS project 15.
- Rendered and visually inspected PDF pages 1–4; extracted all six pages.
- Read representative local files and exact historical UAT run/SHA references. During package preparation, independently retrieved the selected historical GitHub metadata below; no live cloud inspection.
- Software tests not run: research/documentation only.
- Verified all 22 local Markdown links in the report resolve to existing files.
- 2026-09-06 read-only GitHub API confirmed UAT run 31348984824 and recovery run 31348664798 completed successfully with actor MangmeeDev; workflow head 83210a8e differs from the UAT candidate 54566d1b and must be recorded separately. PR 18 merge metadata retrieved. These do not prove customer acceptance.
- Rendered DOCX with bundled LibreOffice and explicit Thai-capable font configuration; visually inspected all 9 final pages. One-page CR and two-page guideline fit as intended. No clipped text or split forms.
- Authored XLSX using bundled artifact-tool; visually inspected all seven sheets across 21 rendered views. Reopened the saved workbook read-only with openpyxl: no error cells, six calculated counts correct, typed date fields and frozen B6 panes/native tables confirmed on six registers.
- Verified all 18 snapshot hashes; the 15 repository copies exactly match pinned checkout 91957572df0e1ba0e8292a805e89787c90b23460. ZIP CRC check passes for 22 files.
- Historical test numbers are attributed to original records, not represented as new tests. VAT local/synthetic evidence is not UAT acceptance. The August 10 UAT release is not claimed as deployment of the August 27 VAT change. Historical records use compilation date September 6 and R identifiers; approvals/closure dates are not invented.
- Final package excludes temporary render images, internal PDF and inspection logs. No software code/package files changed, no deploy, no external submission.
Next: Company fills real names/positions, reviews and signs the prepared documents using actual dates, confirms assessor and pilot scope, and resolves the nine tracked submission items with authentic approval/release/UAT/acceptance evidence.
