# LINE AI Assistant UX Spec

## 1. Goal

Define the LINE user experience for WatchDog-BMS as an AI assistant, summary, and alert channel.

Web is the full product surface for data viewing, approvals, accounting, tax, inventory, CRM, reports, setup, and audit. LINE helps users ask questions about system data, receive concise summaries, get alerts with links back to web, and perform narrow capture workflows explicitly allowed by later specs such as receipt upload draft creation in item 09.

## 2. Non-goals

- Full accounting workspace in LINE.
- Full tax filing workflow in LINE.
- Full dashboard or BI workspace in LINE.
- Inventory scan, stock movement, quotation creation, or master-data management in LINE.
- Final approval, accounting posting, stock mutation, tax mutation, or permission change from LINE chat.
- Final expense confirmation, payment, void, export, or ledger posting from LINE receipt upload.

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
2. User asks a natural-language question or chooses a rich-menu shortcut.
3. AI Gateway resolves user/company context from linked LINE identity.
4. AI uses permission-checked ERP tools to read source-of-truth data.
5. LINE replies with a concise Mangmee-themed Flex card. Web links are URI buttons, not raw URLs in the visible card body.
6. When the turn is complete, the answer card shows the permission-filtered staff Quick Reply menu again. Clarification and upload prompts keep only the controls needed to finish the pending flow.
7. For item 09 receipt upload, AI verifies extracted fields, inserts validated draft/review data with provenance, and returns missing fields/duplicate warnings plus a web-review button.
8. User opens web for full records, editing, approvals, reports, and configuration.

## 5. Business Rules

- LINE should be conversational and concise, not a full app surface.
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

## 12. Open Questions

- Which LINE rich menu labels should ship first?
- Which alert types should support simple acknowledgement in LINE?
