# Agent Memory: rebrand LINE-facing WatchDog text to มั่งมีพลัส/MangmeePlus

Status: Done (code + focused tests green; not committed)
Owner: thawatchai + Claude
Scope: Text constants only — LINE AI replies, agent system prompts, LINE/dashboard notification titles, customer LINE register page fallback name, role-management error, and the specs/smoke expectations pinning them. Explicitly out of scope per owner: package names (`@watchdog-bms/*`), env var names (`WATCHDOG_*`), JWT issuer/audience, folder/function/model ids, enums (`TAX_SOURCE_SYSTEMS 'WATCHDOG'`), code comments, Swagger title.
Decisions:
- Thai display name: มั่งมีพลัส (e.g. "ขออภัย มั่งมีพลัส AI …", "[มั่งมีพลัส] 🟡 สต็อกต่ำ", "บัญชี มั่งมีพลัส").
- English/system-prompt name: MangmeePlus (matches `tradeName` in apps/web/src/common/legal/legal-content.ts).
- Existing "มั่งมี" short-brand strings (e.g. "ข้อมูลจากมั่งมี") left unchanged — already rebranded.
Artifacts (changed files):
- ai-gateway: line-ai agents (response-composer, orchestrator, intent-router ×2, inventory, accounting-summary, coverage-critic), line-ai-turn.use-case.ts, ai-draft/generate-draft.use-case.ts, line-ai-internal.controller.ts (OCR + bank-statement prompts).
- api: line-ai-formatter.logic.ts, process-line-webhook.use-case.ts (UNLINKED/RECEIPT_LINK replies), dashboard-notifications/notification.use-cases.ts, crm-inbox/customer-line-register.controller.ts (fallback display name), employee-access/update-role.use-case.ts, line-webhook-local-smoke.ts.
- workers: notifications/notification-delivery-adapters.ts.
- specs updated: workers notification-jobs.spec.ts, api customer-line-register.use-case.spec.ts, api role-management.use-case.spec.ts.
Verification: `pnpm exec tsx --test` focused runs — api 119 pass, workers 4 pass, ai-gateway 161 pass (2026-08-10).
Open questions: none.
Follow-up resolved (same day): line-ai-formatter.logic.ts BASE_WEB_URL now falls back WATCHDOG_WEB_BASE_URL → WEB_BASE_URL → PUBLIC_BASE_URL → https://mangmeeplus.com (same chain as notification.use-cases.ts). Prod api-web task def injects WEB_BASE_URL/PUBLIC_BASE_URL from PUBLIC_DOMAIN_URL (deploy.sh ~1256), so LINE AI links now follow the deployed domain; no infra change needed. Verified: process-line-webhook.use-case.spec.ts 69 pass + inline assert that formatRefusal/buildWebLinks use WEB_BASE_URL.
Next: commit/deploy api + ai-gateway + workers images so production LINE picks up the new strings (local stack serves baked images — rebuild required).

## Round 2 (same day): น้องมั่งมี female persona
Owner decision: the LINE assistant calls itself "น้องมั่งมี" (Nong Mangmee in English copy) and speaks with feminine particles (ค่ะ/คะ/นะคะ) as fits context. Applies to the LINE AI voice only — notification title prefixes stay [มั่งมีพลัส], legal reply keeps "เว็บแอป MangmeePlus", CRM customer-AI keeps its per-tenant persona (crm-prompts.ts default ค่ะ unless tenant templates use ครับ — untouched).
Changes:
- Persona instruction added to RESPONSE_COMPOSER_SYSTEM_PROMPT (propagates to answer-composer + language-layer prompts) and ai-draft SYSTEM_PROMPT.
- All canned Thai replies got น้องมั่งมี self-references + ค่ะ/คะ endings: response-composer COPY (th+en), line-ai-turn replies + CAPTURE_PENDING, formatter REFUSAL_MESSAGES (all 9), process-line-webhook replies (~17 consts + 7 inline receipt-classification returns that used ครับ), line-message-buffer replies, intent-router CORRECTION_CLARIFY_FALLBACK (was ครับ), business-card fallback title/altText → "ข้อมูลจากน้องมั่งมี". Also fixed round-1 leftover: MUTATION_REFUSAL_REPLY still said "เว็บแอป WatchDog".
- No spec edits needed: specs pin mid-sentence fragments (e.g. /ตอบได้เฉพาะข้อมูลในระบบธุรกิจ/) that were preserved verbatim.
- Deliberately left: formatter data/label templates (formatStockBalance etc. — bullet lines, no particles), composer Thai stopword list line 313 (contains ค่ะ ครับ as tokens — logic data).
Verification: full ai-gateway suite 523 pass; all api line-ai specs 462 pass; intent-router specs 49 pass (2026-08-10).
