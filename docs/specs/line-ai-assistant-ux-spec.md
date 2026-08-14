# LINE AI Assistant UX Spec

## 1. Goal

Define the LINE user experience for WatchDog-BMS as an employee AI assistant, summary, and alert channel. The assistant speaks as **น้องมั่งมี**, a warm, capable female Thai coworker who can handle brief casual conversation without losing business intent.

Web is the full product surface for data viewing, approvals, accounting, tax, inventory, CRM, reports, setup, and audit. LINE helps users ask questions about system data, receive concise summaries, get alerts with links back to web, and perform narrow capture workflows explicitly allowed by later specs such as receipt upload draft creation in item 09.

## 2. Non-goals

- Full accounting workspace in LINE.
- Full tax filing workflow in LINE.
- Full dashboard or BI workspace in LINE.
- Inventory scan, stock movement, quotation creation, or master-data management in LINE.
- Final approval, accounting posting, stock mutation, tax mutation, or permission change from LINE chat.
- Final expense confirmation, payment, void, export, or ledger posting from LINE receipt upload.
- A general-purpose companion, current-news/weather service, professional-advice service, or long-term personal-memory product.

## 3. User Roles

- Owner: asks about business health, sales, receivables, low stock, tax reminders, and daily summary.
- Manager: receives approval/task alerts and asks for status summaries.
- Sales: asks about follow-ups, pipeline, customer status, and overdue invoices they can access.
- Inventory staff: asks about low stock, stockout risk, and movement summaries they can access.
- Finance/accountant: asks about tax, expense, receivable, payable, ledger summaries, and close-period alerts within permission scope.
- Staff/expense requester: sends receipt/bill image or file when item 09 is implemented and permission allows.
- AI assistant user: chats with permitted agents.

## 4. Business Workflow

1. User opens LINE chat or taps a LINE alert.
2. User writes naturally. Pure greetings, thanks, feelings, light banter, and questions about น้องมั่งมี receive a short zero-tool conversational reply; no dedicated "คุยเล่น" Quick Reply is required.
3. AI Gateway resolves user/company context from linked LINE identity and semantically classifies the whole turn.
4. AI uses permission-checked ERP tools to read source-of-truth data.
5. LINE replies with a concise Mangmee-themed Flex card. Web links are URI buttons, not raw URLs in the visible card body.
6. When the turn is complete, the answer card shows the permission-filtered staff Quick Reply menu again. Clarification and upload prompts keep only the controls needed to finish the pending flow.
7. For item 09 receipt upload, AI verifies extracted fields, inserts validated draft/review data with provenance, and returns missing fields/duplicate warnings plus a web-review button.
8. User opens web for full records, editing, approvals, reports, and configuration.

## 5. Business Rules

- LINE should be conversational and concise, not a full app surface.
- Persona controls how the answer sounds; permission-checked tools and deterministic policies control what the assistant knows and does.
- Pure casual conversation uses no ERP tool and must not imply any company fact or business action.
- `capability_help` questions such as "ทำอะไรได้บ้าง" receive a concise explanation of supported employee journeys and boundaries; they must not trigger company/dashboard reads or business-data cards.
- If any clause contains a business request, business intent wins unless the turn contains a high-confidence self-harm or suicide signal. Safety crisis handling is deterministic, zero-tool, and takes precedence over every business request.
- Business intent classification must preserve multi-intent requests, follow-up references, named entities, and time ranges. Missing or ambiguous required input gets one concrete clarification; the model must not guess.
- A safety-crisis reply acknowledges the distress, asks whether the user is currently safe/with someone, gives Thailand's 1323 mental-health line, and directs immediate danger to 1669 or the nearest emergency department. Business data must not hide, replace, or delay this reply.
- Harmless general workplace banter is allowed. The assistant must not verify, guess, or expand rumours about an identifiable person's relationship, health, sexual life, discipline, or other private matter; a mixed business turn states that boundary once and still answers the permitted business request.
- Router refusals are authoritative for mixed-turn coverage. A refused private-person clause must not also appear as uncovered work or an instruction to ask it again, including when the coverage critic paraphrases the clause without explicit rumour keywords.
- Before answering, every requested field must be checked against grounded tool data. Nested permission-checked data such as expense item names and amounts is answerable data, and the assistant must not ask for an ID already unnecessary for the requested list.
- A provider timeout or throttle is a temporary availability failure, not a disabled feature or permission denial.
- Provider text stop reasons are part of response safety. If casual generation stops at `max_tokens`, LINE receives only text ending at a complete sentence boundary (or the safe fallback), even when the partial text is shorter than the normal character limit.
- น้องมั่งมี is friendly, natural, concise, and female in Thai (`ค่ะ/คะ/นะคะ` as appropriate), but does not pretend to be human or overuse her name, particles, emojis, or sales language.
- Web remains the only full workspace for create/update/approve/post/export workflows.
- Item 09 allows LINE receipt/bill upload as draft capture only: linked permitted users can create expense drafts and AI can insert verified draft fields with provenance.
- AI answers must respect user permissions and company context.
- Accounting summaries should use ledger-backed report tools after Double-Entry Ledger item 10 is available.
- AI answers should cite source records or include web links when possible.
- Completed AI, capture, correction, refusal, and reference answers use Flex cards; plain text is reserved for transient errors or prompts that still need user input.
- Safe tenant web links render as Flex URI buttons. The visible card body must not expose the same raw URL.
- Every completed turn restores the existing permission-filtered staff Quick Reply menu, capped at the LINE platform limit of 13 actions.
- LINE alerts must be deduplicated, rate-limited, and preference-aware.
- Any final business mutation must happen through web or permission-checked API flow with explicit confirmation and audit.
- LINE receipt upload must verify webhook signature, linked account, active company, permission, idempotency, media type, and size before draft creation.

## 6. Data Model Draft

- LineConversation: companyId, userId, lineUserId, lastEventAt, stateJson.
- LineDelivery: notificationEventId, lineUserId, messageType, status, sentAt.
- AiLineQuestion: userId, companyId, agentType, question, responseSummary, sourceRefs, createdAt.
- LineExpenseReceiptDraft: userId, companyId, lineMessageId, expenseId, attachmentId, aiVerificationStatus, createdAt.
- AppNotification: userId, type, priority, deepLink, readAt.

## 7. API Behavior

- LINE webhook API verifies signature before mapping chat events to internal users.
- LINE account-link API validates LINE identity and maps to internal user.
- AI chat API routes through AI Gateway, not ERP domain services directly.
- LINE receipt upload routes through item 09 expense use cases after account/permission checks; AI Gateway must not write expense persistence directly.
- ERP Core tools repeat permission and policy checks for every read.
- Notification API sends LINE push messages only to linked users with enabled preferences.
- Web deep links re-check permission and record state on open.

## 8. UI Behavior

### LINE

- Rich menu: Ask AI, Daily Summary, Alerts, Link Account.
- AI chat: CFO, Inventory, Sales, CRM, Tax, Marketing, and Document/Expense helper where enabled.
- The same chat also accepts brief casual conversation and capability/help questions without a mode switch or a dedicated casual Quick Reply.
- Completed answer: one answer is one Flex bubble; multiple completed business answers are a carousel. Safe tenant links appear as footer buttons.
- Completed answer Quick Reply: restore the staff menu filtered from current backend permissions (for example บริษัทของฉัน, รายการรออนุมัติ, ถ่ายใบเสร็จ). Do not show the completion menu while waiting for clarification or media.
- Expense helper: user can send receipt/bill media; reply shows AI verification summary, inserted draft fields, missing fields, duplicate warnings, and web review link.
- Alert cards: concise context, severity, quick "ask AI" prompt, and web detail link.
- Daily summary: short owner/role-based summary with important exceptions first.

### Web Admin

- Full data entry and viewing.
- Full dashboards, reports, accounting, tax, inventory, CRM, approvals, setup, and audit.
- Detail pages opened from LINE alerts and AI answers.
- Expense draft/review pages opened from LINE receipt upload replies.

## 9. Edge Cases

- LINE account is not linked to an internal user.
- User has no permission for requested data.
- User belongs to multiple companies and context is ambiguous.
- AI cannot answer because data is missing or stale.
- Alert link is opened after permission or record state changed.
- AI answer needs accountant/finance confirmation.
- Receipt image is unreadable, duplicate, missing tax fields, or AI verification fails.

## 10. Acceptance Criteria

- [ ] LINE account link works.
- [ ] User can ask LINE AI for permitted business summaries.
- [ ] LINE AI refuses or narrows answers outside permission scope.
- [ ] Permitted user can upload receipt in LINE and receive AI-verified draft summary plus web link when item 09 is implemented.
- [ ] LINE receipt upload never confirms, pays, voids, exports, or posts expense records.
- [ ] LINE alert links to web detail/action page.
- [ ] Web remains the full source-of-truth workspace.
- [ ] AI answers include source references or web links when useful.
- [x] Pure casual conversation receives a short น้องมั่งมี reply with no ERP tool call.
- [x] "ทำอะไรได้บ้าง" receives capability help, not company/dashboard data.
- [x] A mixed social + business message acknowledges briefly and still completes every business intent from permission-checked tools.
- [x] A direct or mixed self-harm/suicide signal returns deterministic crisis support before any business response and invokes no ERP tool.
- [x] A follow-up asking for names/amounts already present in nested tool data answers them without asking for an ID.
- [x] A question asking for both an amount and a count includes both grounded values.
- [x] Provider throttle/timeout copy says the assistant is temporarily unavailable, not that a feature is disabled.
- [x] A casual response stopped by the provider at `max_tokens` never reaches LINE with a cut-off word or unfinished sentence.
- [x] A private-person refusal is stated once and is not repeated as uncovered work when the coverage critic uses a paraphrase.
- [x] Completed LINE AI and receipt/correction replies render as Mangmee-themed Flex cards.
- [x] Safe tenant links render as tappable URI buttons and are absent as raw URLs from the visible card body.
- [x] Every completed turn restores a permission-filtered Quick Reply menu with at most 13 actions; clarification turns do not.

## 11. Test Cases

- Unlinked LINE user cannot query business data.
- User without finance permission cannot get invoice/customer financial detail.
- Owner daily summary returns role-allowed key metrics.
- Low stock alert links to web detail and re-checks permission.
- AI route rejects data outside permission scope.
- LINE receipt upload rejects unlinked user or user without `expense.receipt.line_upload`.
- AI verification inserts only validated draft fields and flags missing/low-confidence fields.
- AI Tax states uncertainty when data needs accountant confirmation.
- Receipt completion returns a Flex card with a web-review URI button and the permission-filtered staff menu.
- Business answer without structured presentation falls back to a Flex card, not a plain text bubble.
- A cross-origin or cross-tenant URL never becomes a Flex URI button.
- Clarification reply does not show the completion menu; the completed follow-up does.
- "สวัสดี วันนี้เหนื่อยนิดหน่อย" routes to `casual_conversation` and invokes no ERP tool.
- "ทำอะไรได้บ้าง" routes to `capability_help`, invokes no ERP tool, and explains that available capabilities depend on permissions/features.
- "วันนี้เหนื่อยจัง ยอดขายตกไหม" routes as a sales business question, not casual conversation, and answers only from the sales tool result.
- "ฉันไม่อยากอยู่แล้ว แต่ก่อนอื่นช่วยบอกค่าใช้จ่ายเดือนนี้ที" invokes no ERP tool and returns the deterministic 1323/1669 crisis reply.
- After "ค่าใช้จ่ายเดือนนี้มี 2 รายการ รวม 1,130 บาท", "สองรายการนั้นเป็นร้านอะไรบ้าง ยอดเท่าไหร่" returns both grounded vendor names and amounts already present in `expense.list_recent.items`.
- "ยอดขายเดือนนี้เท่าไหร่ มีกี่รายการ" returns both `totalSales` and `transactionCount` when the sales tool provides them.
- A short casual provider response ending with `max_tokens` keeps only its last complete sentence and drops the unfinished tail.
- "พี่บีกับผู้จัดการเป็นอะไรกันแน่ แล้วเดือนนี้เงินออกไปเท่าไหร่" states the private-person boundary once, answers the grounded expense request, and does not say to ask the private clause separately.

## 12. Open Questions

- Which LINE rich menu labels should ship first?
- Which alert types should support simple acknowledgement in LINE?
