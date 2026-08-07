# P1 Security Remediation M-04–M-18 Implementation Plan

## Linked sources

- Spec: `docs/specs/p1-security-remediation-m04-m18-spec.md`
- Checklist: `docs/security-remediation-checklist-merged-2026-07-17.md`
- Security guideline: `docs/guidelines/security-implementation-guideline.md`
- Architecture: `docs/specs/enterprise-architecture-spec.md`

## Purpose

Close every open P1 repository-remediation item except M-01, then update the
top-level checklist only where finding-specific closure evidence is complete.
Production/legal evidence is recorded as an explicit remaining gate rather than
being inferred from local tests.

## Product evidence

- [x] Findings, affected users/assets, business impact, and closure evidence are
      defined in the linked checklist and spec.
- [x] Existing M-01–M-03 controls are preserved.
- [ ] External owner/approval evidence is attached where required.

## Architecture evidence

- [x] Authoritative boundary for each finding is identified in the spec.
- [x] Existing ports/helpers and complete call paths are inspected before edits.
- [x] Schema changes are additive, tenant-safe, and migration-reviewed.
- [x] AI Gateway remains separate from ERP repositories.

## Phase 1 — Pure policy and output boundaries (M-04, M-09, M-13, M-15)

- [x] Add semantic claim mutation guard and corpus.
- [x] Add pinned HTTPS webhook destination policy and SSRF corpus.
- [x] Reuse one CSV safe-cell policy across exports and test adversarial prefixes.
- [x] Configure/test production web security headers.
- [x] Add the exact configured S3 upload origin to production `connect-src`
      without widening the directive to a scheme or wildcard.

Exit: focused tests and app typechecks pass.

## Phase 2 — Tenant, branch, privacy data lifecycle (M-06, M-07, M-08, M-10, M-11)

- [x] Add durable DSAR case/status/retry/notification state and end-to-end test.
- [x] Make export completeness/truncation/cursors explicit and inventory data.
- [x] Add AI TTL purge plus customer/employee erasure coverage and restore rule.
- [x] Validate attachment target company/type/purpose/permission and add composite
      tenant constraint where supported.
- [x] Apply branch scopes to confirmed accounting/ledger/banking gaps and add an
      authorization-matrix regression suite.

Exit: focused API tests, Prisma validation/migration review, and API/contracts
typechecks pass.

## Phase 3 — Provider, abuse, and file-processing boundaries (M-05, M-12, M-14)

- [x] Enforce production provider/model/region allowlists and persist full lineage.
- [x] Add processor/ROPA register fields/document with explicit approval state.
- [x] Replace per-process sensitive/cost limiter paths with the existing Redis
      boundary; pin trusted-proxy behavior; add per-session/company cost keys.
- [x] Sniff upload bytes, keep unscanned files quarantined, integrate configured
      scanner fail-closed, and bound active-content/parser behavior.
- [x] Enforce exact extension/MIME pairs at upload-intent creation and before
      every web upload.
- [x] Apply attachment magic-byte, active-content, and malware checks before bank
      statement PDF/OCR parsing; reject unknown extensions instead of treating
      them as delimited text.
- [x] Apply the same fail-closed policy immediately after LINE AI and CRM Inbox
      media download, including retry, before intake routing, OCR, upload intent,
      ACTIVE attachment, or record creation.
- [x] Package loopback-only clamd/freshclam in the non-root api-web image, wait
      for scanner readiness before starting the application, and verify the
      compiled scanner with clean, multi-chunk, and EICAR inputs.
- [x] Publish the matching immutable image to UAT, enable `CLAMAV_HOST=127.0.0.1`,
      and collect live clean/quarantine/audit/alarm-state evidence.
- [ ] Keep production skipped until its owned alert topic/action/delivery acknowledgement
      and the remaining promotion prerequisites are complete, then repeat the live evidence.

Exit: tenant/model, multi-instance/proxy/victim-availability, and upload
adversarial suites pass with config/API/AI Gateway typechecks.

## Phase 4 — Production infrastructure and supply chain (M-16, M-17, M-18)

- [x] Make log retention/KMS, security filters/alarms, notification target, and
      deploy assertions declarative.
- [x] Make Redis/RDS resilience/encryption/protection and secret rotation
      configuration declarative with restore/rotation runbooks.
- [x] Pin Actions/images/artifacts; enable final-image scan, SBOM,
      provenance/signing gates, and runtime hardening.

Exit: static infra/CI policy tests pass. Live deployment, alert delivery, restore,
rotation, and sanitized configuration checks remain explicit release gates.

## Implementation evidence

- [x] Smallest root-cause diffs use existing repository patterns.
- [x] No new dependency unless an existing/native facility cannot meet the trust
      boundary.
- [x] Focused tests are recorded beside each checklist item.
- [x] `git diff --check` passes without overwriting unrelated M-03 work.

## Integration evidence

- [x] API/AI Gateway/web/contracts/config typechecks pass.
- [x] Relevant full suites pass or an exact scoped reason is recorded.
- [x] Browser/client checks cover every file chooser policy and the production
      CSP upload-origin regression.
- [x] Infra and local CI policy scripts pass; clean-CI artifact evidence remains
      an external release gate.
- [x] Checklist and agent memory match actual evidence.
