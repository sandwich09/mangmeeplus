# Agent Memory: Web upload security, CSP, and file types

Status: Implemented and locally verified; immutable UAT deployment and live
header/upload assertion remain.
Owner: Codex
Scope: All web file choosers, LINE inbound media, direct presigned uploads,
attachment-intent validation, bank statement binary extraction, production
CSP, focused tests, and linked P1 security documentation.
Decisions:
- Keep production CSP narrow: add one exact AWS S3 origin derived from validated
  bucket/region values; do not allow all HTTPS or wildcard S3 hosts.
- The server attachment boundary accepts only `.pdf`/PDF, `.png`/PNG, and
  `.jpg` or `.jpeg`/JPEG pairs.
- Receipt HEIC/HEIF is a client input only and is converted to a matching JPEG
  before upload.
- Bank statement delimited text supports `.csv`, `.tsv`, and `.txt`; binary
  extraction supports only PDF/PNG/JPEG and is scanned before parsing.
- LINE media must pass the shared PDF/PNG/JPEG metadata, magic-byte,
  active-content, and malware checks before intake routing or OCR; completion
  keeps the existing second verification before persistence.
- CRM Inbox applies the same check before creating its DB-backed ACTIVE
  attachment, including the background retry path. A scanner outage remains
  retryable but no bytes are persisted; rejected content is terminal.
- XLSX stays disabled until a bounded reader and adversarial tests exist.
Open questions: None.
Upload inventory:

| Inbound area | File chooser/path(s) | Enforced policy |
| --- | ---: | --- |
| Expense receipt | 1 chooser plus drag/drop | PDF/PNG/JPG/JPEG; HEIC/HEIF converted to matching JPEG before intent |
| Expense supporting/payment evidence | 2 | PDF/PNG/JPG/JPEG |
| Substitute-receipt signatures | 2 | PNG/JPG/JPEG |
| Company signature assets | 1 | PNG/JPG/JPEG |
| Reimbursement create/detail/signed copy | 3 | Create/detail accept PDF plus PNG/JPG/JPEG/JPE/HEIC/HEIF/GIF sources and normalize images to PNG/JPEG; signed copy picker accepts PDF/PNG/JPG/JPEG |
| Reimbursement claim signature | 1 | PNG/JPG/JPEG |
| Accounts payable tax evidence | 1 | PDF/PNG/JPG/JPEG |
| Trade-tax evidence | 1 | PDF/PNG/JPG/JPEG |
| Bank statements | 1 | CSV/TSV/TXT bounded text; PDF/PNG/JPG/JPEG scanned binary |
| CRM broadcast prototype preview | 1 local-only chooser | PNG/JPG/JPEG, maximum 5 MB |
| LINE AI receipt/signature | Initial LINE media download | PDF/PNG/JPG/JPEG; validate and scan before Intake Router/OCR, then verify again at completion |
| CRM Inbox LINE media | Initial background fetch plus retry fetch | PDF/PNG/JPG/JPEG; validate and scan before DB-backed ACTIVE attachment |

Artifacts:
- `docs/specs/p1-security-remediation-m04-m18-spec.md`
- `docs/plans/p1-security-remediation-m04-m18-plan.md`
- `apps/web/src/common/files/upload-file.logic.ts`
- `apps/web/src/common/security/security-headers.logic.ts`
- `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts`
- `apps/api/src/modules/banking/application/use-cases/statement-import.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/process-inbound-line-message.use-case.ts`
- `apps/api/src/modules/crm-inbox/application/use-cases/retry-crm-inbox-deliveries.use-case.ts`
Verification:
- API attachment/bank focused tests: 34/34 pass.
- Web file/CSP/bank/receipt focused tests: 40/40 pass.
- Proxy/header production regression: 16/16 pass.
- API and web typechecks pass.
- Nest provider boot smoke resolves every provider.
- Chromium page-driven reimbursement upload, replacement, and removal against
  local MinIO: 1/1 pass.
- LINE AI, CRM inbound/retry, and shared attachment focused tests: 289/289 pass.
- API typecheck passes after the LINE additions.
- Nest provider boot smoke resolves every provider after scanner injection.
- `git diff --check` passes.
Next: Build/deploy an immutable revision to UAT, assert the live `/login` and
application CSP contain the exact UAT S3 origin, then upload and complete one
PDF, PNG, JPG, and JPEG receipt while confirming rejected mismatch cases create
no intent. Send the same accepted/rejected corpus through LINE AI and CRM Inbox,
confirm rejected files reach neither AI nor ACTIVE attachment storage, and
confirm HIGH-risk rejection telemetry.
