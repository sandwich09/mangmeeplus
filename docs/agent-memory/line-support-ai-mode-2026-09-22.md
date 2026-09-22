# Agent Memory: line-support-ai-mode-2026-09-22

Status: complete locally; not deployed
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
Verification:
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/external-signup/application/support-request-admin.use-case.spec.ts src/modules/line-ai/application/line-message-buffer.service.spec.ts src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` passed
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/line-ai/line-first-signup-webhook.spec.ts` passed
- `pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=dot src/features/system-support-requests/SupportRowActions.spec.ts src/features/system-support-requests/SupportRequestsPage.qa.spec.ts src/features/system-support-requests/support-requests.logic.spec.ts` passed
- contracts/API/Web typecheck passed; `git diff --check` passed
Next: review diff, then use mandatory UAT deployment protocol when deployment is requested
