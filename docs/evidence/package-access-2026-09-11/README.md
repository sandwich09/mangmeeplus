# Admin / user / LINE access — local evidence 2026-09-11

Status: **AX01/AX02 LOCAL REPAIR PASS; AX03/AX04 OPEN; full AP01–AP24 E2E NOT RUN**. [Audit](../../research/package-access-admin-web-line-audit-2026-09-11.md), [spec§9](../../specs/mangmee-package-entitlements-spec-th.md), [plan](../../plans/mangmee-package-entitlements-plan-th.md).

Two production repairs: history loader now checks tool feature as well as permission before including an old assistant reply (text and media callers); permission resolver projects only ACTIVE roles and requires ACTIVE SYSTEM_ADMIN in preferred-membership lookup. No pricing/schema/provider changes. Other dirty working-tree edits were preserved; no deployment, live role/gate change or external messages.

| Final suite | Result | Scope |
|---|---:|---|
| [API](api.tap) | 543 PASS | permission/feature/menu/resolver, admin entitlement CAS, internal tools/delegation, LINE live/media/history/queue and quick replies |
| [Gateway/AgentCore](gateway.tap) | 294 PASS | scoped composer/orchestrator/tool registry and runtime contract; model/provider doubles |
| [Web logic](web.tap) | 75 PASS | system-partner/plan-term and auth-return helpers; **not browser tests** |
| [User-feature use cases](user-features.tap) | 253 PASS | dashboard, notification delivery, expenses, reimbursement scope, employees and branches; store doubles |
| Total | **1,165 PASS**, 0failed/skipped | Named focused suites, no full-flow/real-DB/native LINE/provider claim |

AX01/AX02 regression: [initial reproduction](first-reproduction.tap) included three media fixture errors because upload dependencies were absent. After correcting only fixture dependencies, [reproduction](reproduction.tap) has **4 expected failures / 4 passes**: history sales-off fails on text/media, and two disabled-role cases fail. [Repaired run](repaired.tap) **8/8 PASS** (sales off/on/legacy × text/media + two role cases). All8 are also included in API543; do not add them to1,165 again.

Exact final commands are in [verify-current.sh](verify-current.sh); run with `bash docs/evidence/package-access-2026-09-11/verify-current.sh` from main repo. Reproduction before repair used the same two files with `--test-name-pattern='AX0[12]'`; it is historical red evidence, not expected to fail now. These suites use in-memory/double dependencies and simulated LINE/model transport. There is no fixture-cleanup count from a real database because no real database is used here.

Run [verify-docs.py](verify-docs.py) for [document check](doc-check.json) and [selected source hashes](source-snapshot.json). It validates current local links/IDs/catalog parity/status and final TAP counts; no anchor/remote/live verification. Prior [330/2 package evidence](../package-entitlements-2026-09-11/README.md) is unchanged. A source snapshot is a selected-file record of the dirty workspace, not a full repository attestation.

Remaining: AP21 source/branch authorization of reused history and AP22 final dispatch/queued replay reauthorization require implementation and race proof; AP-S3 admin→actual web→LINE/DB/native acceptance is NOT RUN. No new browser E2E, deployed-state check or actual LLM answer-quality evaluation occurred in this follow-up. Two repaired guards do not close those broader gaps.
