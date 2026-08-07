# AI Gateway and Agents Spec

## 1. Goal

Provide AI for asking questions about system data while keeping AI separate from ERP core logic. LINE is the primary conversational entry point for summaries, alerts, suggestions, and receipt/slip capture; web can expose the same assistant as a collapsible side chat while remaining the full workspace for records, reports, and actions.

## 2. Non-goals

- Embedding LLM logic inside ERP modules
- Allowing AI to bypass permissions
- Letting AI directly file tax, move money, mutate stock, or change permissions without approval
- Letting AI approve, pay, post, close periods, broadcast campaigns, or commit customer-facing actions in the current phase
- Treating AI output as accounting or tax legal advice

## 3. User Roles

- Owner: asks AI CFO for sales, ledger-backed profit, cash, overdue invoices, and risks
- Sales: asks AI Sales/CRM for follow-up priorities
- Inventory staff: asks AI Inventory about low stock and movement anomalies
- Accountant or finance: asks AI Tax about report explanations and missing records
- Marketing: asks AI Marketing for platform-specific campaign drafts

## 4. Business Workflow

1. User opens AI chat from LINE or web.
2. User selects or implicitly routes to an agent.
3. AI Gateway checks identity, company, role, and allowed tools.
4. Agent calls approved read, report, suggestion, or evidence-capture tools.
5. Agent responds with answer, assumptions, source references, and suggested next action.
6. Any final write action is refused in AI chat and routed to web.

## 5. Business Rules

- AI Gateway is a separate service from NestJS ERP core.
- ERP data access must go through permission-checked APIs/tools.
- Agent responses must state uncertainty when data is incomplete.
- Drafts, evidence captures, and suggestions are not final business approvals/payments/posts until user confirms in web.
- Tool calls must be auditable for sensitive data.
- Finance answers should use ledger report tools after Double-Entry Ledger item 10 is available.

## 6. Agent Map

- AI CFO: sales, ledger-backed profit, expenses, receivables, payables, cash, KPI
- Sales Agent: pipeline, quotes, follow-ups, conversion, overdue opportunities
- Inventory Agent: low stock, fast-moving products, stock anomalies, reorder suggestions
- Tax Agent: VAT, withholding tax, CIT calendar, missing tax documents, reminders
- CRM Agent: customers to contact, follow-up summary, customer history
- Accounting Agent: slip/receipt OCR, evidence capture, draft accounting updates, missing-field questions
- Marketing Agent: Shopee, TikTok, Facebook campaign drafts, captions, hashtags, scripts

## 7. API Behavior

- Chat endpoint accepts user message, company context, selected agent, and conversation id.
- Gateway routes to agent and tool policy.
- Read tools return scoped summaries, not raw unrestricted database access.
- Evidence-capture tools can create/update draft capture records from uploaded slips/receipts only.
- Audit logs record user, agent, tool, timestamp, and source objects.

## 8. UI Behavior

### LINE

- LINE chat is the primary AI entry point.
- Suggested prompts: today sales, low stock, overdue invoice, tax deadline, follow-up list, campaign idea.
- Responses should be short, source-aware, and link to web records.
- Alerts can include suggested follow-up questions.

### Web Admin

- AI side panel for reports, accounting explanations, CRM analysis, and receipt/slip capture.
- More detail and source links than LINE chat.
- Full actions and final confirmations happen in web.

## 9. Edge Cases

- User asks for data outside permission scope.
- Tax rule is ambiguous or outdated.
- Source data is incomplete.
- AI suggests action that conflicts with approval policy.

## 10. Acceptance Criteria

- [ ] AI Gateway is documented as separate from ERP core.
- [ ] Each agent has a clear business scope.
- [ ] AI cannot mutate sensitive records directly.
- [ ] AI answers are permission-aware.
- [ ] LINE supports agent chat as a core feature.
- [ ] Web side chat can reuse the same gateway contract without exposing provider keys.
- [ ] Current phase blocks approval/final mutation and allows only read/report/suggestion/evidence-capture tools.

## 11. Test Cases

- Unauthorized user cannot ask AI for restricted accounting data.
- AI Tax states uncertainty when no tax period exists.
- Marketing Agent creates draft only, not auto-post.
- Tool invocation is logged.

## 12. Open Questions

- Which LLM provider and model policy should be used?
- Should agents be separate deployable services or logical workers behind one Gateway?
- How should source citation appear in Thai LINE answers?
