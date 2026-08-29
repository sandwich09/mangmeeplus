# LINE AI Channel and Auth Spec

## 1. Goal

Define LINE as the AI assistant and alert channel for WatchDog-BMS.

Web is the full source-of-truth workspace for creating, viewing, editing, approving, and managing business data. LINE is for talking with AI, checking data, receiving summaries, and getting alerts that link back to web detail when needed.

## 2. Non-goals

- Replacing the web admin for data entry, reporting, accounting, tax, BI, setup, inventory, CRM, approvals, or master data.
- Building a native mobile app in MVP.
- Letting LINE chat commands bypass permissions, approvals, or audit.
- Trusting LINE webhook payloads without signature verification.
- Letting AI make final changes to money, stock, tax, permissions, or accounting records.

## 3. Channel Model

Primary channels:

- Web admin: full Business OS for data entry, data viewing, reports, accounting, tax, inventory, CRM, approvals, setup, and audit.
- WatchDog shared LINE Official Account: AI chat, system-data Q&A, short summaries, alerts, and alert acknowledgement where safe for all partner companies.
- LIFF: lightweight bridge for LINE Login, account linking, and deep links from LINE alerts to web detail. LIFF is not the full workspace.

## 4. Login and Identity Model

LINE Login links a LINE user to an internal WatchDog-BMS user.

Authentication flow:

1. User adds WatchDog-BMS LINE Official Account or opens a LIFF/account-link URL.
2. LIFF starts LINE Login and obtains LINE identity tokens.
3. Backend validates LINE token, issuer, audience/channel id, expiration, nonce, and signature.
4. Backend maps LINE user id to an internal `User` through `ExternalIdentity`.
5. Backend issues a WatchDog-BMS first-party API session or JWT for protected web/LIFF routes.
6. ERP Core resolves company membership, roles, permissions, ABAC scope, and audit context.

Rules:

- LINE proves user identity; WatchDog-BMS owns company membership, roles, permissions, policy rules, and audit.
- LINE Messaging API user id is channel-scoped and must be linked to an internal user before business data is shown.
- Any user of any role may belong to multiple companies and may hold LINE company context; company selection is server-verified through LIFF/web context. (Owner decision 2026-08-29: replaces the earlier rule that only users who were OWNER of every company could select context — per-company authorization stays with the permission resolver and branch ABAC.)
- WatchDog uses one shared LINE OA in the first pass. The webhook validates the shared channel, then resolves company from linked identity plus selected company context, never from the channel alone.
- Removing or inactivating a user from a company immediately blocks LINE AI, alerts, deep links, uploads, and AI/tool access to that company's data.

## 5. Core User Flows

### Account Link

1. Admin creates internal user or invite link, then user opens the invite/account-link URL from LINE or web settings.
2. System performs LINE Login.
3. If LINE identity is unknown, system validates the invite before linking; self-join without invite is deferred.
4. System links the LINE identity to the current WatchDog user by creating or confirming `ExternalIdentity`.
5. System resolves the current web/session company from the post-password-change route or explicit selector and persists it to `LineCompanyContext`.
6. If a user has multiple companies and no current selected company is available, user chooses company context before LINE AI can answer company-scoped questions.
7. System confirms link and returns to LINE or web.

Shared OA chat behavior:

- Scanning the same shared LINE OA opens the same LINE chat history. This is expected and must not be used as company context.
- Company context lives only in WatchDog server state: `ExternalIdentity` plus `LineCompanyContext`, then current active `CompanyMembership` verification on each request.
- Re-linking the same LINE account from a different company the user is an active member of must update `LineCompanyContext` to the selected company instead of relying on old LINE chat state.
- Re-linking must be idempotent for the same WatchDog user and LINE user. It should refresh selected company context, not fail with a blocking conflict.
- A user holds exactly one selected company context at a time, whatever their role. Multiple active memberships are allowed; the user picks one and every request re-verifies it against current active memberships. (Owner decision 2026-08-29: replaces the earlier deny-and-audit rule for non-owners with multiple memberships.)
- Multi-company users of any role can manage shared-OA company context from LINE with control-plane commands: `/companies`, `/company`, or exact `เปลี่ยนบริษัท` lists their active companies and `/company <number-or-companyId>` switches context after server-side membership verification — the selection must be one of the user's own ACTIVE memberships. The immediately following reply may use the displayed bare number within 15 minutes; the server maps it from pending picker state and performs the same membership recheck. These commands are not AI classifier keywords.

### Ask AI About System Data

1. User asks a question in LINE chat, such as "today sales?", "which invoices are overdue?", or "low stock list?".
2. Messaging webhook verifies LINE signature, validates the shared WatchDog channel, and maps LINE user id to internal user plus selected company context.
3. AI Gateway receives request context and selects allowed tools.
4. ERP Core tools read source-of-truth data through permission-checked APIs.
5. AI replies in LINE with a short answer, source references where useful, confidence/unknowns, and a web detail link when more review is needed.

### Alert to Web Detail

1. Rule triggers alert: low stock, invoice overdue, tax due, approval pending, follow-up due, or daily summary ready.
2. Worker sends LINE push message with concise context.
3. User can ask follow-up questions in LINE.
4. If the user needs detail or action, LINE opens web or LIFF-authenticated deep link.
5. Any final data change happens in web through normal permission, validation, and audit.

## 6. Data Model Draft

Minimum additional records:

```text
ExternalIdentity
- id
- provider: "line"
- providerUserId
- lineChannelId
- userId
- status
- linkedAt
- lastLoginAt

PlatformLineChannel
- id
- lineOfficialAccountId
- messagingChannelId
- liffChannelId
- status
- secretVersion
- lastValidatedAt

LineCompanyContext
- id
- lineUserId
- companyId
- selectedAt
- updatedAt

LineConversation
- id
- companyId
- userId
- lineUserId
- lastEventAt
- stateJson

LineDelivery
- id
- notificationEventId
- lineUserId
- messageType
- status
- sentAt
- error
```

## 7. API and Webhook Behavior

- Webhook endpoint verifies LINE signature before parsing events.
- Login/account-link endpoint validates LINE identity and links to internal user.
- LINE chat endpoint routes messages to AI Gateway with server-derived user/company context. Shared-OA requests without selected company context must not run company-scoped tools.
- AI Gateway calls ERP Core through permission-checked tools only.
- Notification worker sends LINE messages only to linked users with enabled preferences.
- LINE replies should be short and include web links for full records, reports, and actions.
- Web remains responsible for final create/update/approve/post/export workflows.

LINE verification model:

- LINE Login proves interactive user identity for login/linking.
- LINE Messaging webhook signature proves the event came from the configured LINE channel.
- WatchDog-BMS authorization still requires active `User`, active `ExternalIdentity`, active `Company`, active `CompanyMembership`, role grants, permissions, and ABAC scope.
- A valid LINE identity or valid webhook signature never bypasses inactive membership, removed membership, disabled user, disabled external identity, or suspended company checks.

Local tunnel verification model:

- Real LINE Login, LIFF, and Messaging webhook tests require an HTTPS public URL. `localhost` is valid only for browser/web app smoke, not for LINE platform callbacks or mobile LINE webview.
- When a tunnel already exists, continue from the tunnel URL: configure LINE webhook to `<tunnel>/v1/line/webhook`, open the tunnel-hosted `/v1/auth/line/link-page`, and use the same tunnel origin for LIFF/deep-link callbacks.
- After password change, the web success screen must show the LINE OA add QR/short link and account-link QR/short link so the user can continue without a separate admin handoff package.
- The account-link short link must point to the active public API/tunnel origin when LINE mobile/webview testing is required.
- Tunnel-served account-link pages must be no-store/cache-busted for local retest so LINE webview does not reuse stale JavaScript or API base URLs.
- Local-only dev-token or bootstrap helpers may be used only outside production and must still create normal WatchDog sessions and pass the same membership/permission checks.
- Successful local tunnel verification requires: LINE OA added, account linked through LIFF/Login, signed webhook received by API, linked user resolved to active membership, and a safe LINE reply or refusal returned.

## 8. Security and Compliance Rules

- Do not store raw LINE access tokens in application logs or audit metadata.
- Do not expose business data to unlinked LINE users.
- Do not expose business data to inactive users, inactive memberships, disabled LINE identities, or suspended companies.
- Verify webhook signatures with the active channel secret.
- Do not infer company from shared LINE `messagingChannelId`.
- Do not trust user-submitted company ids, roles, permissions, approval state, price, tax, or stock quantities.
- AI answers must follow the same permissions as the requesting user.
- AI cannot perform final money, stock, tax, accounting, approval, or permission mutations from LINE.
- Role changes, account linking, failed login mapping, sensitive AI tool calls, and alert delivery are audited.

## 9. Acceptance Criteria

- [ ] User can link LINE account to internal user.
- [ ] Unlinked LINE user cannot see business data.
- [ ] User can ask LINE AI for permitted business summaries.
- [ ] LINE AI answer cites source records or links to web detail when needed.
- [ ] LINE alert links back to web detail/action page.
- [ ] AI cannot bypass ERP permissions or final-action rules.
- [ ] Web remains the full source-of-truth workspace.
- [ ] Local tunnel flow can verify real LINE account linking and webhook delivery without using `localhost` in LINE callbacks.

## 10. Test Cases

- Invalid LINE signature returns `401` or `403`.
- Expired LINE token fails account linking.
- Unknown LINE user receives link/invite flow, not business data.
- User removed from company cannot query that company's data from LINE.
- Inactive company membership gets a safe no-access response and no business tool call.
- User without finance permission cannot ask LINE AI for invoice detail.
- AI chat cannot access records outside user permission scope.
- LINE alert opens web detail that re-checks current permission and record state.
- Tunnel-hosted link page can complete account linking from LINE webview; stale cached link pages are not reused.

## 11. Open Questions

- Which LINE rich menu items should ship first: Ask AI, Daily Summary, Alerts, Link Account?
- Which AI answer format should be default in Thai: short bullets, table-like summary, or Thai natural prose?
- Which alerts should allow acknowledgement in LINE, and which must always open web?

## 12. Owner Decisions

- First account-linking flow uses admin-created internal user or invite link, then LINE identity attach.
- Unknown LINE users receive link/invite-required response and no business data.
- Self-join without admin-created invite is deferred.
