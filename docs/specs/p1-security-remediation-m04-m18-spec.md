# P1 Security Remediation M-04–M-18 Spec

## 1. Status

- Checklist: `docs/security-remediation-checklist-merged-2026-07-17.md` P1
- Scope: every open P1 finding except M-01; M-02 and M-03 are already locally closed
- Owner: Platform/Security with module owners; implementation owner Codex
- Due: before the next production release
- Status: Repository remediation and local verification complete; external
  release/legal/operations closure remains open where listed in the checklist

## 2. Goal

Remove the confirmed medium-risk root causes at the authoritative application,
database, network, CI, and infrastructure boundaries. A checkbox may be closed
only when its finding-specific evidence is present. Repository checks do not
substitute for production, processor-governance, DPO, or incident-delivery
evidence where the finding requires it.

## 3. Users and assets

- Employees using LINE AI and ERP web workflows.
- Customers using CRM/PDPA self-service.
- Company financial, branch, attachment, customer, and AI data for every tenant.
- Production API, AI Gateway, web, PostgreSQL, Redis, CloudWatch, ECR, CI, and secrets.

No finding authorizes the AI Gateway to read a database or make a final ERP
mutation directly.

## 4. Common rules

1. Company, branch, target, purpose, permission, provider, model, and region
   values are server-owned and fail closed when they cannot be proven.
2. Security decisions happen before side effects and are audited without raw
   secrets, prompts, personal data, or file content.
3. A retry must not bypass the same policy that governs the initial action.
4. Destructive privacy work is durable, idempotent, observable, and retains a
   non-personal tombstone so restore/replay cannot silently rehydrate erased data.
5. Configuration that is unsafe or incomplete fails at boot/deploy.
6. Existing permissions, tenant filters, immutable ledgers, and M-01–M-03
   controls must not regress.

## 5. Finding contracts

### M-04 — Employee AI semantic grounding

- A model-polished answer may contain only normalized semantic atoms present in
  the deterministic grounded answer: identifiers, entity/name tokens, statuses,
  negations, outcomes, dates, and amounts.
- Unsupported or inverted claims return the deterministic grounded answer.
- High-impact status/outcome cards remain deterministic.
- Evidence: mutation corpus for name/status/negation/outcome and supported
  paraphrase positives.

### M-05 — Provider/model/region lineage and privacy governance

- Production boot accepts only an explicit provider/model/region allowlist.
- Production uses Claude Sonnet 4.6 through its `global.` Bedrock inference
  profile only when a named DPO/legal approval reference is supplied; otherwise
  deployment and application boot fail closed.
- Each AI/OCR call carries a request lineage envelope; persisted turns and
  extraction records retain every processor hop, model, region, purpose, and
  timestamp.
- Per-company policy is enforced when configured; no unused policy field may
  imply enforcement.
- A processor register records purpose, lawful basis, notice/objection path,
  processor/subprocessor, region/residency, retention, transfer mechanism, owner,
  and approval state. DPO approval remains external evidence.

### M-06 — Durable erasure workflow

- A request creates or reuses a durable DSAR case before returning `202`.
- Statuses cover received, processing, completed, completed-with-exception,
  failed/retryable, and rejected; timestamps, SLA, attempts, result summary, and
  staff notification state are retained without copied customer PII.
- Processing re-verifies the target, is idempotent, invokes the canonical erasure
  transaction, records legal-retention exceptions, and produces audit evidence.
- The response says the request was received and exposes a case identifier/status,
  never that erasure already completed.

### M-07 — Complete, explicit PDPA export

- Bounded self-service export returns per-category total, returned count,
  truncation flag, stable cursor, and the applied limit, or an asynchronous
  complete archive.
- Stable ordering and cursor semantics prevent omissions/duplicates.
- The export inventory identifies included and exempt personal-data categories.

### M-08 — AI retention and erasure

- Raw previews/source references have a documented configurable TTL and are
  purged by an idempotent lifecycle job.
- AI records use pseudonymous actor references where operationally sufficient.
- Customer/employee DSAR and erasure include AI conversations, turns, tool
  invocations, and provider lineage as applicable.
- Restore runbooks require tombstone replay/re-erasure before service reopen.

### M-09 — Workflow webhook SSRF

- Only HTTPS destinations accepted by the server allowlist may be called.
- Production requires the allowlist key to be non-empty so a task definition that lost it fails
  to boot rather than degrading to deny-all unnoticed. Non-empty means "state a decision", not
  "allow at least one host": a deployment with no outbound webhooks sets the reserved value
  `none`, which resolves to the empty allowlist and denies every host. A placeholder hostname is
  never an acceptable way to satisfy the check, because it is weaker than `none`.
- URL canonicalization rejects credentials, non-default ambiguity, private,
  loopback, link-local, multicast, reserved, and metadata IPv4/IPv6 destinations.
- DNS resolution is validated and pinned for the connection; redirects are
  disabled. Every retry re-runs the policy.
- Payload, response, connect, and total time are bounded.

### M-10 — Attachment target integrity

- Link creation resolves the active attachment and target in the same company
  inside one authoritative operation.
- Target type/purpose pairs are allowlisted and require the target module's read
  or manage permission in addition to `attachment.create`.
- Retrieval is scoped by company and target permission.
- Composite tenant constraints prevent a link from referring to an attachment in
  another company.

### M-11 — Branch ABAC and tenant integrity

- Every branch-bearing read/write applies the request's branch scope. An empty
  branch scope permits company-central records (`branchId = null`) only and
  grants no branch-bearing record.
- Company/branch identifiers come from resolved records, not request bodies.
- Composite database constraints keep company-bound foreign keys in one tenant.
- An authorization matrix covers representative accounting, ledger, banking,
  attachment, and branch reads/writes with cross-company/cross-branch negatives.

### M-12 — Distributed abuse controls

- Production rate limits use Redis or an edge control and fail closed for
  cost-bearing/sensitive paths. Keys are normalized, hashed where sensitive,
  TTL-bound, and cardinality-bounded.
- Client IP is trusted only through an explicit proxy-hop contract and production
  direct ingress is blocked.
- Login protection uses bounded backoff/step-up without a hard identifier lockout
  that lets an attacker deny the victim access.
- Refresh is limited per session/family; OCR and LLM limits are per company/user
  with a cost ceiling. API and AI Gateway enforce equivalent boundaries.

### M-13 — CSV formula injection

- Every CSV cell from untrusted or business data is quoted and prefixed as text
  when its first effective character is `=`, `+`, `-`, `@`, tab, or carriage
  return.
- Expense, tax, and other CSV exports share the same policy.

### M-14 — Attachment active-content and malware controls

- Completion reads authoritative bytes, sniffs magic bytes, and rejects
  claimed/actual type mismatches before `ACTIVE`.
- Every server attachment intent also enforces an exact filename-extension/MIME
  pair: `.pdf` ↔ `application/pdf`, `.png` ↔ `image/png`, and
  `.jpg`/`.jpeg` ↔ `image/jpeg`. HEIC/HEIF is accepted only by the receipt
  client and must be converted to a JPEG with a matching filename before an
  upload intent is created.
- Files remain `QUARANTINED` until a configured malware scanner returns clean;
  unavailable/error is fail closed.
- SVG and unsupported active content are disallowed. Office/PDF/CSV policy,
  download disposition/headers, and parser byte/page/pixel/time limits are
  explicit.
- Bank statement binary extraction accepts only the same PDF/PNG/JPEG pairs and
  applies magic-byte, active-content, and malware checks before PDF/OCR parsing.
  Delimited `.csv`, `.tsv`, and `.txt` files are parsed as bounded text in the
  client; an unknown extension must never fall back to that path. XLSX remains
  disabled until a bounded binary parser and adversarial corpus are implemented.
- LINE AI and CRM Inbox media, including CRM media retry, use the same
  PDF/PNG/JPEG extension/MIME policy and must pass authoritative size,
  magic-byte, active-content, and malware checks immediately after download.
  Unverified LINE bytes must not reach the intake router, OCR, upload intent,
  persisted attachment, or any business record.
- EICAR, polyglot, SVG active-content, and bounded parser tests run without
  executing the sample.

### M-15 — Web security headers

- Production web disables `X-Powered-By` and emits HSTS, CSP, frame denial,
  nosniff, Referrer-Policy, and a restrictive Permissions-Policy on `/login` and
  application routes.
- CSP remains compatible with the current Next.js runtime and does not grant
  wildcard script execution.
- Production `connect-src` contains only same-origin, configured API origins,
  and the exact presigned-upload origin derived from validated S3 bucket/region
  settings. Scheme-wide `https:` and wildcard storage origins are forbidden.

### M-16 — Log retention and alert ownership

- Infrastructure applies retention and KMS classification to every production
  log group.
- Security metric filters/alarms cover auth abuse, AI tool deny/error/provider
  failure, erasure failure, malware rejection, and deployment/config drift.
- Alarms have an explicit notification destination and owner; a synthetic event
  proves delivery and reconstruction after deployment.

### M-17 — Redis/RDS recovery and secret rotation

- Production Redis is encrypted in transit/at rest, authenticated, replicated,
  snapshot-enabled, and not directly reachable from public/AI workloads.
- RDS is encrypted, Multi-AZ, deletion-protected, and uses the documented backup
  retention.
- Secret types have rotation/revocation procedures and metadata; automatic
  rotation is enabled where the consumer supports it.
- Restore testing includes RTO/RPO and post-restore tombstone re-erasure.

### M-18 — Software/container supply chain

- GitHub Actions and base/runtime images are immutable; workflow permissions are
  least privilege.
- Remote artifacts require a checksum; production images are built from a frozen
  lockfile and scanned as the final artifact.
- CI emits SBOM and provenance/attestation, signs the immutable digest, gates
  release on policy, and records time-bound CVE exceptions/reachability.
- Runtime containers are non-root, read-only where compatible, drop Linux
  capabilities, and do not include source, local `.env`, or build/admin tools.

## 6. Rollback

- Application changes: deploy the prior immutable revision and disable the
  affected feature; do not restore an insecure bypass.
- Additive schema: retain new tables/columns during rollback; workers stop before
  application rollback.
- Network/storage/database hardening: use a reviewed maintenance rollback that
  keeps encryption and tenant isolation; never disable TLS/auth/deletion
  protection merely to recover availability.
- CI policy: emergency override must be time-bound, approved, and recorded with
  the exact artifact digest and residual risk.

## 7. Acceptance and closure

- [x] Focused adversarial tests for every changed trust boundary pass.
- [x] Relevant API, AI Gateway, web, contracts, config, Prisma, infra policy, and
      type checks pass.
- [x] Owner, affected tenants/assets, rollback, evidence, and residual risk are
      recorded per finding in the checklist or task memory.
- [ ] Immutable clean-CI artifact and sanitized live verification are recorded
      for findings whose closure depends on deployment.
- [ ] DPO/processor, alert-delivery, restore, rotation, client-rendering, and
      egress-observation evidence is attached where required.
