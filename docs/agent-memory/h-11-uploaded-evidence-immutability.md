# Agent Memory: H-11 uploaded evidence immutability

Status: Complete locally; production release evidence pending
Owner: API/Data Model Core + Platform
Scope: Shared attachment upload/completion/storage, version-pinned evidence reads, expense source checksum, web/LINE upload callers, S3/MinIO controls, schema/config/docs/checklist
Decisions:
- Browser/LINE uploads write only to `pending/` keys using a configurable TTL capped at five minutes, exact signed content length, and `If-None-Match: *`.
- Completion ignores client size/checksum as authority, HEADs and reads the same provider version, hashes actual bytes server-side, and quarantines mismatch.
- Verified bytes are written server-side to a unique create-only final key with provider SHA-256; S3 completion requires and persists a version id.
- Tenant pending quota is checked before signing and rechecked under a PostgreSQL advisory lock before the pending row is created.
- Every attachment download and server-side OCR/signature read passes the recorded object version; expense confirmation checksum includes verified attachment-byte checksums.
- No new dependency was added.
Open questions:
- Production deployment must inventory historical ACTIVE objects without `objectVersionId`; backfill from provider versions where provable or record explicit residual-risk acceptance.
- U-02 remains owner for live bucket encryption/access-log/retention inventory beyond H-11 versioning and pending lifecycle.
Artifacts:
- `apps/api/prisma/migrations/20260718190000_h11_attachment_evidence_immutability/migration.sql`
- Shared attachment storage/use cases and focused adversarial tests under `apps/api/src/modules/data-model-core`
- Expense confirmation/read pinning under `apps/api/src/modules/expenses`
- Web/LINE upload-header propagation and `e2e/expenses.spec.ts`
- S3/MinIO versioning and pending lifecycle deploy configuration
Verification:
- Focused H-11 adversarial tests: 55/55 passed (reuse/overwrite, exact length, quota, size mismatch, provider checksum mismatch, forged client checksum ignored, fail-closed missing provider version, immutable final key/version pin, expense checksum).
- Adjacent expense upload/extraction/substitute-receipt and LINE intake tests: 68/68 passed.
- Isolated snapshot regression (current HEAD + only H-11 files): API 2,147/2,147 and Web 288/288 passed; the Web suite includes a direct assertion that signed create-only headers reach storage.
- Shared configuration schema suite: 55/55 passed, including the pending-quota default and rejection of upload TTLs over 300 seconds.
- API, Web, and Contracts typecheck passed after Prisma Client generation.
- Prisma schema validation passed; a clean PostgreSQL 16 database applied all 70 migrations including H-11 from empty.
- App Runner/ECS shell syntax, ECS deploy-principal JSON, local Compose config, staged diff review, and `git diff --check` passed.
- `e2e/expenses.spec.ts` now forwards the signed headers; live browser/S3 AC-05 remains release evidence rather than a local-production claim.
Next:
- Deploy a clean immutable artifact, apply migration, verify sanitized live S3 versioning/lifecycle/CORS/checksum behavior, inventory legacy rows, and retest AC-05 before production release.
