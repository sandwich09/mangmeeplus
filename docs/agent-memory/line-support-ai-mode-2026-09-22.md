# Agent Memory: line-support-ai-mode-2026-09-22

Status: implementation complete; UAT deployment blocked before mutation by UAT host enrollment integrity drift
Owner: Codex
Scope: LINE support pause/media gate, admin pause/resume API, support inbox AI-state toggle, contracts/spec/tests
Decisions:
- `LineCompanyContext.aiPausedUntil` เป็น source of truth เดียว; ไม่เพิ่ม database state
- ระหว่าง pause เก็บและแสดง media ให้เจ้าหน้าที่ แต่ไม่เรียก OCR/model/expense capture
- UI ใช้ปุ่มเดียว: เขียว active, แดง paused; mutation เป็น desired action (`pause-ai`/`resume-ai`)
- การสลับ AI ไม่ปิดหรือเปลี่ยนเจ้าของเคส
Open questions: none
Artifacts:
- `docs/specs/line-support-request-spec-th.md` v4
- `docs/plans/line-support-ai-mode-plan-th.md`
- contracts/API: server-derived `assistantActive`, audited `pause-ai`/`resume-ai`
- LINE media: durable pause snapshot, no loading/OCR/model during support pause, media remains in thread
- Web: one green/red state toggle, thread poll reflects LINE/other mutations
- Candidate published to `origin/main`: `c5d48814d4795c9b0606d5180491abdec5ee864a`
Verification:
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/external-signup/application/support-request-admin.use-case.spec.ts src/modules/line-ai/application/line-message-buffer.service.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` passed
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/line-ai/line-first-signup-webhook.spec.ts` passed
- `pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=dot src/features/system-support-requests/SupportRowActions.spec.ts src/features/system-support-requests/SupportRequestsPage.qa.spec.ts src/features/system-support-requests/support-requests.logic.spec.ts` passed
- contracts/API/Web typecheck passed; `git diff --check` passed
- UAT smoke preflight `20260922T101352Z-8758c338` stopped in `target-preflight` before source selection, lock, build, image publication, database work, rollout, or customer acceptance: target IP addresses did not match the same running UAT instance IDs. `productionMutated: false`; no active deployment record remains.
- AWS identity readback confirmed the enrolled UAT instance IDs/VPC/stack/IMDS; public IPs are now API `52.77.253.61` and AI/workers `47.129.179.174`.
- Direct SSM port-22 host-key readback did **not** match either enrolled SSH host key. Both temporary SSM sessions were explicitly terminated. The private target was not edited and the release was not retried.
- UAT/READY/Production GitHub workflow run IDs: `NOT_DISPATCHED` (local Kamal path).
Next: owner must reconcile the UAT host provenance and SSH host keys, then re-enroll the private target with the verified current addresses/keys. Start a new release only after that reconciliation; recheck the exact `origin/main` candidate and the deployment protocol first.
