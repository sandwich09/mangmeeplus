# Agent Memory: substitute-online-preview-cleanup

Status: Implemented and verified; ready to integrate into develop and main.
Owner: Codex.
Scope: Remove the duplicate centered document-number/version heading throughout substitute receipt presentation and remove the unsupported unsigned-paper download action from online signing.
Decisions:
- Earlier cleanup was conditional on paperForm, leaving DIGITAL previews and stored SVG previews with the old heading. New renders omit it for all signing modes; reference fields and internal document number/version/checksums remain.
- Shared presentation-only removal handles the known old system heading/footer for retained SVG previews and PDF copies without writing to originals. Access/MIME checks and SVG image-mode rendering stay enforced.
- Online signing retains full preview and online certification. Paper signing retains its separate download and upload workflow. Generic status-aware printing and existing LINE delivery routes remain supported.
Open questions: None.
Artifacts: substitute-receipt-presentation.ts; renderer/preview/wizard changes; focused regression checks.
Verification:
- API focused renderer/PDF/download/use-case checks: 89 passed.
- Web attachment-preview/wizard checks: 54 passed. Retained SVG preview strips the former centered header while preserving its reference field; original response is unchanged.
- Contracts build, API build, API typecheck and web typecheck passed; git diff --check passed.
- Chromium on local ports 3006/3007: real prepared PAPER record retains download and upload; a DIGITAL route fixture retains full preview and has no unsigned-form action/help. No signing or business-state mutations were performed.
- Rendered synthetic new/retained SVGs to PDFs with the real composer and Poppler. Both page images are identical; visually verified clean heading/footer, retained expense reference, readable content and UNSIGNED state watermark.
- Local-only evidence: output/pdf/substitute-preview-cleanup/ (not committed).
Next: Integrate the fix under the existing develop/main authorization. Deployment is separate from branch integration.
