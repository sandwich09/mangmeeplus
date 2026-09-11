# Agent Memory: Package access admin/web/LINE review

Status: SCOPED AUDIT/REPAIR COMPLETE; 1165 focused PASS; AX03/AX04 OPEN and full AP01–AP24 E2E NOT RUN.
Owner: Product owner / Codex.
Scope: Audit adminconsole/user7features/LINEAI conversation+tools, amend package spec/plan, fix bounded confirmed shared-boundary bugs with focused regression. No live/provider/deploy or external messages.
Decisions: Reuse existing feature/role/tool guards and preserve retained-work/legacy semantics. Do not claim fullE2E from unit tests. AP01–AP24 extends PE01–PE36.
Open questions: No product approval required for known permission/feature deny invariants. AX03 record/scope history and AX04 send-time revocation need separate implementation/evidence; no policy guessed.
Artifacts: [Spec](../specs/mangmee-package-entitlements-spec-th.md), [plan](../plans/mangmee-package-entitlements-plan-th.md), [audit](../research/package-access-admin-web-line-audit-2026-09-11.md).
Verification: corrected red8cases=4expectedfail/4pass; repaired8/8PASS; API543 + Gateway294 + web75 + user-feature253 =1165PASS,0failed/skipped. No new browser/realPG/nativeLINE/LLM/provider proof. Exact TAP/commands and doc check in docs/evidence/package-access-2026-09-11. Initialmediafixturefailure retained separately.
Next: AP-S1 authorizationContext/source-record history fence, AP-S2 final live/drain/replay dispatch fence, AP-S3 actual cross-layer browser/API/PG/native acceptance. No claim full parity passed; report explicit remaining gaps.

Changed: two production files (shared history filter, ACTIVErole projection) and two existing regression files; prior unrelated edits in production files preserved. Package spec/plan, AIhelp spec/plan, sibling alignment and audit updated. No package.json/dependencies/deployment/provider actions.
