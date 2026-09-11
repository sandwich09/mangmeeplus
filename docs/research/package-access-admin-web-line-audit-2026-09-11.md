# Package access review: admin console, user features, LINE AI

Status: SOURCE AUDIT COMPLETE FOR NAMED BOUNDARIES; AX01/AX02 FIXED + LOCAL REGRESSION PASS; AX03/AX04 OPEN; full AP01–AP24 E2E NOT RUN.
Scope: current working tree only, no live config/cloud/LINE reads or changes. [Spec§9](../specs/mangmee-package-entitlements-spec-th.md), [AP01–AP24 plan](../plans/mangmee-package-entitlements-plan-th.md).

| Finding | Source evidence | Disposition |
|---|---|---|
| AX01 History uses permission without tool feature | ProcessLineWebhookUseCase.canUseAssistantPreview checks hasToolPermissions only; sales summary uses CRM permission but owns sales_documents | FIXED LOCAL: six text/media cases (off/on/legacy) exercise actual history-to-intake path over doubles; both false cases fail before and pass after shared feature+permission filter |
| AX02 Disabled roles still enter resolved access | PrismaPermissionResolverRepository maps all membership.roles without statusfilter; disable-role excludes ACTIVE/INVITED assignments but stale/reactivated membership paths can retain DISABLEDrole | FIXED LOCAL: two DISABLEDrole cases fail before and pass after filtering ACTIVErole projection; default SYSTEM_ADMIN lookup also requires ACTIVEstatus |
| AX03 History record/scope provenance | loadConversationContext selects toolName but no sourceRefs/scope epoch; company+user filter alone does not prove old branch data is still readable | OPEN implementation/evidence dependency, AP21; narrow AX01 repair does not solve this |
| AX04 Access change after tool result before delivery | live completion receives earlier access; queue resolves before model and pushes afterward. No final source/permission fence established in inspected path | OPEN delivery-race acceptance AP22; do not claim send-time revocation solved by tool-time guard |
| AX05 Tax/runoff intent can be misread | cap.wht50bis specialistCLOSED and external handoff separate; reimbursement tools intentionally preserve some retained reads | Explicit spec§9 retained-work exceptions and AP06/AP11/AP16; never blanketdenyallhistory on packageoff |
| AX06 Existing help spec status stale | help spec header says notimplemented while current code and linked plan implement scoped help/local+AgentCore | DOC CORRECTED: implementation present; current scoped tests pass; old baseline measurements remain dated and native/live acceptance stays open |
| AX07 Full cross-layer evidence absent | previous330tests+2marketing cover specific seams, not adminsave→webfeature→LINEanswer and in-flightrevoke | AP01–AP24 matrix added; actualruntimeevidence tracked separately |

Inspected existing controls: admin entitlement commandId/CAS/cascade/normalization and immutable foundation; canonical permission+feature resolver; LINE tool delegation and internal execution reauthorization; gateway help/follow-up filtering and AgentCore payload; text/media/history/queue and tax fallback. Positive/negative assertions and exact commands are in [new evidence](../evidence/package-access-2026-09-11/README.md); historical330/2 records remain immutable.


| Review area | Evidence now | What is still not proved |
|---|---|---|
| Admin / canonical access | Entitlement command CAS/cascade/normalization, resolver/role/feature and web settings logic included in API543 + web75 | Real browser admin save → current user UI → LINEanswer across processes |
| User feature actions | Additional253 tests: dashboard generation, notification delivery, expenses/receipt, reimbursement branch/related scope, employee lifecycle/creation and branch access | Every button/HTTP path of all7menus and real-DB concurrency |
| LINE AI / Gateway / AgentCore | API543 includes internal tool security/actor delegation/text+media/history/queue; Gateway294 includes composer/orchestrator/runtime/registry parity | Native LINE/real LLM/provider, branch-record history revocation AX03 and final delivery fence AX04 |

Total current final suites: **1,165 PASS = 543 API + 294 Gateway/AgentCore + 75 web logic + 253 user-feature use cases**, 0failed/skipped. New8 regressions are included in543, not8 extra passes. Initial reproduction had3media fixture failures (upload dependencies omitted); corrected red run is4expected failures/4passes, and repaired8/8passes. This is source/use-case verification with simulated stores/transports, no new browser or PostgreSQL acceptance.

The answer to “ครบทุกflowแล้วหรือยัง” is **not yet at full end-to-end runtime level**. Named admin/user/AI branches now have AP01–AP24 requirements and source review; AX03/AP21, AX04/AP22 and AP-S3 cross-layer/native evidence remain mandatory before claiming complete parity. Stripe/annual/control implementation remains separate from these two access repairs. No live deployment or role/gate change performed.
