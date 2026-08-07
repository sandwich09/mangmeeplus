# Agent Memory: P1 security remediation M-04–M-18

Status: Repository remediation and local verification complete; top-level
P1 closure remains pending finding-specific external evidence required by the
canonical checklist Definition of Done.
Owner: Codex `/root`
Scope:
- Fix every unchecked P1 finding except M-01.
- Preserve completed M-02 and M-03 plus the current uncommitted M-03 changes.
- Add spec, plan, code, migrations/config/infra, focused adversarial tests,
  implementation review, and evidence-backed checklist updates.
Decisions:
- Use one umbrella spec/plan because the request is one security release program;
  keep finding-specific evidence and closure gates in the checklist.
- Apply ponytail full mode: existing/shared/native controls first, shortest
  root-cause diff, no speculative dependency or abstraction.
- Separate repository remediation from production, legal/DPO, vendor, alert
  delivery, restore, rotation, spreadsheet-client, and egress-observation evidence.
- Do not tick a top-level finding when its stated external closure evidence has not
  been produced.
- The code/test checkbox under each M-04–M-18 finding is the local completion
  marker. The heading remains open until clean immutable deployment and every
  applicable live/legal/operations check is attached.
- Empty branch scope preserves company-central (`branchId = null`) access and
  denies every branch-bearing row, matching the established repository contract.
- M-09 (amended 2026-07-28, see `prod-required-keys-webhook-deny-all.md`): production still
  requires `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` to be non-empty, because the point is to catch a
  task definition that lost the key rather than to guarantee at least one allowed host. A
  deployment with no outbound webhooks states the reserved value `none`, which resolves to the
  empty allowlist and denies every host; a placeholder hostname is never acceptable, being
  strictly weaker than `none`.
- Dependency policy blocks High/Critical findings. Patched transitive overrides
  move SWC to `minimatch@10.2.5` and SVGR to `svgo@3.3.4`; the current audit has
  zero High/Critical and five Moderate advisories.
- Owner confirmed Claude Sonnet 4.6 for production. Its `global.` Bedrock profile
  is permitted only through the fail-closed approval flag/reference; deploy IAM
  and the container environment carry that decision explicitly.
Open questions:
- Production deployment and mutation are not assumed; immutable deploy/live checks
  require explicit release authority.
- DPO/vendor approvals and supported spreadsheet-client validation require named
  human/external evidence.
- Live multi-instance/proxy/egress, ClamAV/EICAR, header/clickjacking, alert
  delivery, RDS/Redis restore, secret rotation, signed-image, ECR scan, and
  reconstruction drills remain release-owner work.
Artifacts:
- `docs/specs/p1-security-remediation-m04-m18-spec.md`
- `docs/plans/p1-security-remediation-m04-m18-plan.md`
- `docs/security-remediation-checklist-merged-2026-07-17.md`
- `docs/security-evidence/p1-ai-processor-lawful-basis-register.md`
- `docs/runbooks/p1-production-security-operations.md`
Verification:
- Discovery started from the canonical checklist, source specs/plans, repository
  status, and the repo security/ponytail rules.
- M-02 and M-03 are already checked; M-04 through M-18 remain in scope.
- Focused P1/API regression: 59/59 passed, including SSRF IPv4/IPv6/transition
  addresses, target-purpose transaction revalidation, branch matrix, Redis fail
  closed, malware scan, CSV formula prefixes, DSAR retries, auth-abuse event, and
  attachment quarantine audit.
- Full suites: API 2,566/2,566; AI Gateway/AgentCore 466/466; Web 378/378;
  config 87/87.
- Full workspace typecheck passed for API, AI Gateway, Web, workers, contracts,
  config, and design tokens after Prisma Client 7.8.0 regeneration.
- Prisma schema validation passed.
- API SWC production build and Web Next.js production build passed with patched
  dependency graph.
- `pnpm audit --audit-level=high` passed: zero High/Critical, five Moderate.
- Production-image static policy, shell syntax, workflow YAML parsing, and
  `git diff --check` passed.
- Review fixes after the first green run: semantic negation scrub; reject global
  Bedrock profiles anywhere in tenant allowlists; IPv6 global-unicast restriction;
  authoritative attachment purpose revalidation; Unicode/BOM CSV prefix handling;
  mandatory malware-scanner injection; durable OCR/bank lineage; ECR login before
  signature verification; 90-day production log pin; HIGH-risk auth/erasure/
  quarantine events; patched SWC/SVGR transitive vulnerabilities.
Next:
- Release owner runs the external closure items recorded under each finding and
  attaches immutable artifact/change approval plus sanitized evidence.
- DPO/legal completes the processor/lawful-basis register before M-05 closure.
- Only then change the applicable M-04–M-18 heading checkbox to `[x]`.
