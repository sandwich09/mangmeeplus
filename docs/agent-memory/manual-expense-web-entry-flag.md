# Agent Memory: manual-expense-web-entry-flag

Status: SPEC v2 + PLAN + AUDIT + LOCAL E2E SIMULATION COMPLETE (2026-10-01); implementation NOT STARTED. Authorized work: spec, isolated testing, and documentation-only merge to main/develop. Application implementation remains unauthorized.

Owner: thawatchai / Codex

Scope:
- Audit manual expense flag and neighboring modules; write implementation-ready docs.
- User clarified “ปิดแค่ทางเข้าการ manual บน web”, “ยังไม่แก้นะ ทำ spec มาก่อน”.
- User then requested broad E2E simulation. During testing, selected a child switch beneath manual feature: hide the web menu/entry while backend behavior stays the same.
- No application/test/package source edits in the original workspace; no live flags, cloud or deployment.
- Owner subsequently requested “merge เข้า main+develop ไว้ก่อน”: deliver only this task’s spec, plan, audit, QA, memory and evidence independently to both target branches; preserve unrelated dirty work.

Decisions:
- LATEST v2: add `expenses.manual.web_entry`, empty permissionKeys; display under the existing manual feature. Keep `expenses.manual` and its create/update mapping unchanged.
- v1 proposal to reuse old manual flag/remove its permission mapping is SUPERSEDED. Do not restore permissions for companies whose OLD manual flag is OFF.
- Use existing flat entitlement storage/command/CAS; no new table, permission, SKU, env flag or recursive feature tree. `parentFeatureKey` still returns `expenses`; effective web entry checks all three keys.
- New switch hides dedicated web links and closes new admission/reload/direct URL/alias. Mounted admitted forms may finish under unchanged actual business authority. Keep OCR/wizard manual input available.
- Default absent new row inherits ON; preserve explicit/pending entry choice across presets, parent/manual cycles, billing and onboarding materialization.
- Forward entitledFeatureKeys through RequestContext/auth-me/WebSession/MyContext; add snapshot to existing 60-second/focus refresh fingerprint; preserve admitted form state.
- F02 DELETE guard mismatch and F03 LINE invalid idempotency key are separate backend follow-ups, NOT part of the entry-switch implementation diff.
- Local ponytail full read; old /Users/spare058 skill path is stale. Installed Next.js Playwright docs read for harness work.

Open questions:
- No unresolved owner-scope question; v2 reflects the latest child-switch proposal.
- Implementation still must verify new-key registry/default/preset/billing paths and every AC. Existing LINE-key historical compatibility investigation belongs to a separate backend fix; no customer data inspected.

Artifacts:
- docs/specs/manual-expense-web-entry-flag-spec-th.md (v2)
- docs/plans/manual-expense-web-entry-flag-plan-th.md
- docs/research/manual-expense-web-entry-flag-audit-2026-10-01-th.md
- docs/qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md
- docs/evidence/manual-expense-web-entry-flag-2026-10-01/ (reports, source hashes, harness, selected screenshots)
- Temporary full source snapshot/traces/logs: /tmp/manual-flag-e2e-20261001

Verification:
- Baseline HEAD 4a5817b42 with pre-existing dirty work. SHA-256 verification of 3,728 original apps/packages/e2e files: zero changed/missing.
- Earlier in-memory audit: 359 unit tests and 19 diagnostic observations; historical, not new-key acceptance.
- Local simulation: 72 valid case/browser variants, 55 passed / 15 failed against superseded v1 goals / 2 existing ON UI expectation mismatches. Pilot/replaced harness failures excluded; exact counting and limitations in QA report.
- Real PostgreSQL/Nest composed LINE note: ON/OFF × first/retry = four invalid-idempotency-key 400s, zero inserts. This proves an existing bug, not successful LINE creation.
- OFF upload, reviewer confirmation, upload-only LINE source editing, and reimbursement create→approval→finance→payout passed. Old OFF removes create/update, breaks generic own edits/mark-ready/delete, disables wizard create, discards mounted manual form on focus refresh, and blocks lost-response recovery.
- Chromium + WebKit at 1440px and 390px. No real LINE/OCR provider, real device, cloud/UAT/Production or full financial/signature/legacy-history matrix.
- Tests used a sanitized isolated source snapshot/API3061/web3060/PG25463/Redis26381/MinIO29003. Customer/local shared stack at 3000/3001/25461 was untouched. All task-owned servers/containers stopped after testing; snapshot and stopped containers retained.
- Documentation checks: 54 relative links valid across six docs; AC01–AC20 and P0–P5 complete; code fences/whitespace checked. Source hashes remain unchanged.
- Delivery preflight: documentation dependencies exist on both origin/main and origin/develop; evidence JSON parses; scan found no private keys, GitHub tokens, AWS access IDs, JWTs or live Stripe keys. Harness credentials are synthetic and pinned to the isolated localhost services.
- Both target branches use PR-only automatic CI; deployment workflows require explicit dispatch. No deploy or live flag change is part of the merge.

Next:
- Use the merged v2 documentation as the implementation handoff. Wait for explicit instruction to implement; the main/develop documentation merge does not authorize application changes.
- Implement P0–P5 with the NEW key only, then rerun acceptance with new-key toggles. The old-key E2E simulation cannot certify the new flag.
- Keep existing backend bugs and baseline UI test gaps separate and visible; do not silently fix unrelated dirty work.
