# Map: LINE AI pipeline seams for the demo virtual channel (read-only research, 2026-11-06)

Paths relative to `apps/api/src/modules/` unless they start with `apps/`. PLW = `line-ai/application/use-cases/process-line-webhook.use-case.ts`.

## Inbound
- LINE controller `auth/presentation/line-webhook.controller.ts:84-177` maps events to `LineBufferEnvelope` (`line-ai/application/line-message-buffer.service.ts:58-108`): `{ chatId, lineUserId, messagingChannelId, channelKind, item }`. Text/postback → `item.kind:'text'` `{ webhookEventId, replyToken, text, timestamp, quotedMessageId?, lineMessageId? }`; postback becomes Thai command text + typed control fields parsed at controller `:98-117`. Image/file → `item.kind:'media'` `{ webhookEventId, replyToken, lineMessageId, messageType:'image'|'file', fileName?, fileSize?, timestamp }` (`:160-176`).
- Enter through `messageBuffer.enqueue(...)`: `execute` starts with `claimWebhookEvent`, which needs the `LineWebhookEventLog` row the buffer's `acceptEvent` (buffer `:387`) creates. Buffer later calls `processWebhook.execute` (`:953`, `:1036`) or `executeReceiptUpload` (`:981`, `:989`).
- Identity: `resolveLineIdentity` (PLW `:6908-6926`) = `externalIdentity.findFirst({ providerUserId, provider:'LINE', providerChannelId: event.messagingChannelId ?? config.lineMessagingChannelId, status ACTIVE })`. Company: `resolveCompanyForLineUser` (PLW `:2048-2095`) needs ACTIVE membership, ACTIVE company, `planTerm.termEndsAt > now`; several memberships → `LineCompanyContext`. Then permissions, legal (DEMO exempt, `auth/application/legal-acceptance.service.ts:248`), entitlement `ai_line_assistant`, `User.aiAssistantOptOutAt`.
- Rows for a synthetic identity: `ExternalIdentity` (`schema.prisma:868`, unique provider+providerChannelId+providerUserId), `LineChannelBinding { companyId, messagingChannelId, status ACTIVE }` (`schema.prisma:969`; required for a non-configured channel: capture notifier `line-capture-result-notifier.use-case.ts:609`, `preflightPublicGeneral` PLW `:6976`). Use synthetic channel `demo-web`, never the real OA channel id.

## Outbound — everything in the AI path goes through `LineReplyAdapter` (`line-ai/infrastructure/line-reply.adapter.ts:137`), a concrete class, no port
- `sendReply :146`, `sendPush :152`, `sendFrozenV2 :157` (returns `CHANNEL_CHANGED` when channelId ≠ credentials), `startLoadingAnimation :191`, `buildTextMessage :266`; `withLineExternalBrowserLinks` adapter `:30`.
- Callers: PLW `sendTrackedReply/Push :6240/:6244`, `replayDeliveryPlan → sendFrozenV2 :5977`; buffer `:212-213, :565, :689, :912, :1148`; `drain-line-ledger.use-case.ts :423, :485, :491, :632`; `recover-orphan-line-events.use-case.ts :335, :342`; `line-capture-result-notifier.use-case.ts :326, :331, :403` (recipient `resolveRecipient :600-632`: ExternalIdentity by userId + providerChannelId = owner binding channel).
- Direct LINE callers outside the adapter (guard for DEMO): `auth/infrastructure/system-line-push.ts:10`, `dashboard-notifications/application/use-cases/notification.use-cases.ts:842` (identity `:388`), `apps/workers/src/modules/notifications/notification-delivery-adapters.ts:83`, `auth/presentation/line-official-webhook.controller.ts:45`, `crm-inbox/infrastructure/line-messaging.adapter.ts`. Most filter `providerChannelId = config.lineMessagingChannelId`, so `demo-web` keeps them out, but add explicit checks.
- Existing reply stores (`LineTurnOutcome :1957`, `LineDeliveryPlan :11032`, `LineLedgerDelivery :1811`) are incomplete (sendTracked* and buffer error replies are not stored) → new sink table.

## Media
- `downloadLineMedia(lineMessageId, messageType, fileName, fileSize)` PLW `:14260-14315` fetches `api-data.line.me/v2/bot/message/{id}/content` → `{ ok:true, media:{ fileName, mimeType, byteSize, checksumSha256, contentBase64?, bytes } }`. Called at `:3530`, `:10564`, `:12212`. Seam: branch inside it on a `demo-att:` id.
- Then: `lineMediaRejectionReason` (MIME/bytes/malware) → free-allowance check `:10551` → PDF: `captureLineFile :11988` → capture group + `expenseCaptureReadJob` (async); image: `aiGateway.requestLineIntakeRoute` → `tryExtractReceiptFields :14068` → `requestReceiptOcr :14104` → `initReceiptUpload` `:11351` → `putLineMediaUpload :1194` → `completeReceiptUpload`.

## Async senders (all end in the adapter; route by target `Vdemo…` / channel `demo-web`)
Capture read result (`apps/workers/.../expense-capture-read-worker.ts`, outbox `EXPENSE_CAPTURE_READ_FINISHED`, `line-ai-ledger-worker.ts:85` → `/internal/ai/line-capture-results/drain`), ledger drain (`:76`), orphan recovery, document Q&A (`line-document-qa.worker.ts` → PLW `:12623/:12562`), expired reply-token push fallback.

## Credit
- Units are satang. Product "80" = `DEFAULT_CHAT_CREDIT_SATANG = 8_000` (`packages/contracts/src/line-ai.ts:22`).
- `reserveAiBudgetStep` (`company-ai-budget-reservation.ts:320`) callers: `line-ai-budget-authority.service.ts:395`, `company-ai-usage-meter.ts:205`, `internal-ai-budget.controller.ts:123`. Lots fund only on rendered v2 path, `bucket==='CHAT'`, `CompanyAiConfiguration.aiCreditCutoverAt <= now` (`:372`, `:403`).
- `planAiCreditFunding` (`ai-credit-ledger.ts:118`) needs a cycle from `readAiCreditCycle` (`ai-credit-cycles.ts:189`: planTerm.billingReceiptAccountId + billingAccount.paidThrough); else `PACKAGE_REQUIRED` (`:130`) → reservation `unavailable`/`ai_credit_package_required` (`:180`).
- Refusal UI: PLW `answerAiCreditRefusal :3023-3035` → `buildAiBudgetExceededMessage` (`domain/logic/line-business-card.logic.ts:882`, monthly wording + STAFF_OA button); unavailable → `AI_BUDGET_UNAVAILABLE_REPLY` (PLW `:444`, `:7015`).
- Grant: `applyAiCreditGrant` (`ai-credit-ledger.ts:200-232`) accepts `billingAccountId: null`; use `sourceKind 'SALES_EVENT'`, key `sales-demo:<linkId>`. Wrapper `applyAddOnGrant` needs a billing account — do not use.
- v2 path per company: `config.lineAiReliabilityV2CompanyIds` (PLW `:10180`).

## 3-read limit
- Free allowance (`line-ai/application/free-expense-quota.ts`, `FREE_MONTHLY_3`) only for `isFreeExpenseDraftCompany` (FREE_TRIAL_15 ended, no billing) — do not reuse.
- Use `CompanyAiConfiguration.ocrMonthlyLimit` (`schema.prisma:4550`), checked `company-ocr-governance.ts:329-331` → `reason:'exceeded'`; covers image OCR and PDF capture reads.

## Gateway
- `AiGatewayClient` (`line-ai/infrastructure/ai-gateway.client.ts`): `:161, :193, :244, :277, :300, :374, :488`. Gateway calls back only into the API (`/internal/ai/budget-step|budget-settle`, `/internal/ai/tools/invoke`), never LINE. Flex/quick replies are built in the API.
- Web must render `LineReplyMessage = text | image | flex{altText, canonicalText?, contents}` + `quickReply.items[]` (message | postback | uri | camera | cameraRoll); postback `data` strings must be sent back and parsed with the controller's parsers. Max 5 messages per send.
- Flex renderer to port: `docs/evidence/line-system-oa-native-flex-2026-10-05/flex-to-html.mjs` (`flexToHtml(contents, chatWidth)`, `FLEX_PAGE_HEAD`, `FLEX_PAGE_SCRIPT`).

## Round-1 DEMO walls on this path
`sales-demo/application/demo-company-access.ts` `isDemoUnavailableRoute` (`auth.guard.ts:274`) blocks `/ai/*`, receipt-upload complete, extraction-request, capture file complete. `assertNotDemoCompany` in `ai-gateway.client.ts :163, :195, :248, :280, :306, :381, :491`, `receipt-ocr.client.ts:50`, `expense-capture-read.client.ts:141, :190`. Keep: `email-delivery.service.ts:31,87,109`, `billing.service.ts:671`, `billing-notifications.service.ts:233`.

## Risks
1. Direct LINE senders outside the adapter. 2. A demo with a billing cycle would stack the package allowance on top of the 80; OCR is capped by `ocrMonthlyLimit`, not credit. 3. Relax walls narrowly. 4. Fake reply tokens always succeed → no `sentMessageIds` (quote memory). 5. After `termEndsAt`, `resolveCompanyForLineUser` returns null → generic unlinked reply; handle demo expiry before the pipeline.
