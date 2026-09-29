# Agent Memory: LINE "ฉันมีส่วนลดไหม" answer + web held-discount notice

Status: implemented and verified on branch `claude/line-discount-answer-20260929` (from develop 4792c4c3); not pushed.
Owner: controller session (main); implemented by a Claude subagent 2026-09-29.
Scope: Owner UAT feedback 2026-09-29 14:57 — LINE did not know the holder's ส่วนลดจากงาน ("ฉันมีส่วนลดไหม" → apology, ask-back, then read as a discount on the receipt); the web package page showed nothing to a shop that already has a package (ticket MHFVR743, event1, 100 บาท, until 30 ต.ค. 2569).

Decisions:
- Lane: the API webhook's deterministic product-entry lane (beside "บริการของเรา"/"ถ่ายใบเสร็จ" in `process-line-webhook.use-case.ts`), after identity/company/permission and legal acceptance, before the support-free AI gates, the v2 intake router, pending media, draft/correction lanes and the model. So it answers even right after a receipt draft. No router prompt change, so no real-model probes were needed.
- Words: whole-string matcher `isMangmeeDiscountQuestion` (`line-event-discount.logic.ts`), the same style as `line-public-policy.logic.ts`. Bare "ส่วนลด" defaults to the มั่งมี discount (owner option A, no choice question). Text containing บิล/ใบเสร็จ/ใบกำกับ/รายการนี้/ยอดนี้, and the statement "มีส่วนลด", stay with the receipt flow.
- Data: `BillingService.lineEventDiscount(context)` = SD-B `eventDiscount` (owner/plan-manager only via `assertOwner`, ACTIVE LINE identities) + `eventDiscountBlock` when the path is DISCOUNT. LineAiModule now imports BillingModule; `BillingService` is the last `@Optional()` constructor param. A ForbiddenException becomes a plain member reply.
- Button: "เลือกแพ็กเกจ" with the promotion card's one-tap link (`promotion_card_packages` surface), only when the shop can use the discount now.
- Web: `BillingPage` reads SD-B (`billingApi.eventDiscount`) and shows one note above the package status when the holder has a usable ticket and the path is not DISCOUNT (`eventDiscountHeldNotice`).
- Spec: `docs/specs/sales-event-discounts-spec-th.md` §8.1 "LINE: ถามส่วนลด".

Open questions:
- A locked shop (no package/expired) still gets the J1/R14 package card, not the discount answer; its package page already shows the discount box.
- Credit-only tickets (SD-F) are not listed in LINE (no first-bill amount) — revisit with SD-F.
- Mixed sentences ("ได้ส่วนลดมา ใช้ยังไงในแอป") still go to the AI route; only whole-string questions are deterministic.

Artifacts:
- apps/api/src/modules/line-ai/domain/logic/line-event-discount.logic.ts (+ .spec.ts, registered in the whole-chain catalog api-behavior suite)
- apps/api/src/modules/billing/application/billing.service.ts (`lineEventDiscount`), billing-event-discount.spec.ts
- apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts (+ .spec.ts), line-ai.module.ts
- apps/web/src/features/billing/{billing.api.ts,billing-event-discount.ts,billing-event-discount.spec.ts,BillingPage.tsx,billing-preview.fixture.ts}
- docs/research/mangmee-ai-capability-manifest-2026-09-27.json (W00 regenerated)

Verification: see the commit message and the report to main (focused specs, native typecheck api+web, W00, boot DI smoke, pins --check, whole-chain).

Next: controller runs the full API/web suites on the integrated branch, then the UAT redeploy per the runbook.
