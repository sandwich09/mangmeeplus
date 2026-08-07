# Agent Memory: UAT "สั่งพิมพ์เอกสารแล้วเปิดไฟล์ไม่ได้" diagnosis

Status: Diagnosed 2026-08-03 — not a file-generation bug; entitlement enforcement on UAT test companies. No code changed; local DB probe rows restored.
Owner: reported by owner/tester; investigated by Claude session (this doc is the handoff record)
Scope: read-only investigation across web/api generators, UAT ECS/config/logs, launch-gate health, local live reproduction.

Decisions:
- None taken. Fix options are owner-gated (see Next).

Findings:
1. All file generators are sound on current code: tax PDF (`buildMinimalPdf`) and XLSX (`buildXlsx` stored-zip) validate structurally (python zipfile CRC + XML parse, PDF xref/stream checks); claim-form + substitute-receipt SVG escape XML correctly; web decodes base64 artifacts correctly (`TaxWorkspacePage.downloadArtifact`, `expenses.api.downloadIndexXlsx`); reports CSV is text with BOM. Live local checks all passed: ใบเบิก print modal renders, attachment presigned PNG opens (content-type correct), issued ใบแทน SVG opens (`image/svg+xml` — 2e504e59 seam), report CSV export downloads.
2. UAT runtime (resumed + deployed `ceac8ff4` on 2026-08-03 07:46 ICT, task def api-web:72): healthy; in-container clamd healthy (fail-closed startup, definitions current); no scan failures; no API error logs.
3. Root cause of the report: **entitlement enforcement**. `GET /v1/system/launch-gates/health` featureLifecycle shows all 7 UAT companies hold explicit `enabled=false` rows for `sales_documents`, `thai_tax`, `reports`, `double_entry_ledger`, `bank_reconciliation`, `workflow_automation` (plus inventory off 6/7, procurement off 4/7, crm off 2/7). Writer: partner-console onboarding is deny-by-default since `1874f1db` (2026-07-08) — explicit row for every canonical key, `true` only for `DEFAULT_ENABLED_FEATURE_KEYS` (expenses, reimbursement, product_catalog, crm, line_oa, dashboard_notifications, ai_line_assistant, employee_access, company_settings) in `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:21`. The permission resolver strips disabled families' permissions per request (`prisma-permission-resolver.repository.ts:72-79`), and the deployed guard now returns `403 {code:'feature_not_enabled', featureKey}`.
4. Live reproduction (local, seed-local-company, rows flipped then restored): `GET /accounting/documents` → 403 sales_documents; `GET /tax/periods` → 403 thai_tax; `POST /reports/exports` → 403 reports; retained report download stays 200 (by design); `attachment.read` stays (core pack); reimbursement claim-form preview stays 200.
5. Why noticed now: July acceptance only exercised default-package journeys (CRM/LINE/expenses/reimburse). Today's build also keeps retained reports menu visible when the family is off (21a4eb13), so testers can now reach document/report screens that then refuse content. Additionally `cap.wht50bis SYSTEM_INITIAL_ISSUE` is CLOSED by design (F1-SEED never opened) → printing a system 50 ทวิ yields the H4 external-handoff 409, never a PDF, even with thai_tax enabled.
6. Secondary file-open failure modes that read the same on UAT reports history: legacy exports without `sourcePermissionSnapshot` → 410 `legacy_export_not_materialized`; S3 report-export objects expire after 7 days → 410 `report_export_unavailable`.

Open questions:
- Should UAT test companies get the full package (operator flips per company in Partner Companies screen) or should a UAT bootstrap enable document families explicitly?
- UX: screens outside the shared `api-error-message` seam may still swallow `feature_not_enabled` (the 409-audit fixed 4 CRM screens; sales-doc/tax panels not audited for this).

Artifacts:
- Validation scripts: session scratchpad `gen-artifacts.ts` / `validate.py` (throwaway).
- UAT evidence: launch-health lifecycle counts (2026-08-03), task def api-web:72 env, CloudWatch `/ecs/watchdog-bms-uat-api-web`.

Verification:
- Local repro + restore verified: after flipping rows back, `/tax/periods` and `/accounting/documents` return 200.

Next:
- Owner decision: enable `sales_documents`/`thai_tax`/`reports` (+ any families under test) for the UAT companies via partner console before document-journey acceptance, or accept as intended package behavior.
- Before F2 APPLY on prod legacy companies: plan review must confirm cohorts do not turn off families a company actively prints from (same failure would then appear in prod).
