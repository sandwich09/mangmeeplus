# ADR 0008: LINE AI Access and Authentication

## Status

Accepted

## Context

WatchDog-BMS targets Thai SMEs whose daily operations already happen in chat. The product needs fast adoption for alerts, AI questions, stock checks, CRM follow-up reminders, and account linking, while full business work stays in web.

A standalone native app adds install friction before the most important workflows are proven. LINE Official Account, Messaging API, LIFF, and LINE Login can provide a lower-friction chat and authentication surface while preserving web admin for full data and workflows.

## Decision

Use LINE as the primary AI assistant, alert, and account-linking channel for MVP.

- LINE Official Account handles alerts, AI assistant chat, summaries, and rich menu entry points.
- LIFF handles account linking, login handoff, and protected deep-link pages inside LINE.
- LINE Login is the primary login path for LINE and LIFF users.
- WatchDog-BMS backend validates LINE identity, maps it to an internal user, then issues first-party API session/JWT.
- WatchDog-BMS remains the source of truth for company membership, RBAC, ABAC, approval policy, and audit.
- Native mobile app is out of scope for MVP.

## Consequences

### Positive

- Lower adoption friction for Thai SME users.
- Alerts and AI answers arrive where users already work.
- LIFF can support account linking and protected handoff without native release overhead.
- Login can use LINE identity instead of custom username/password.
- Product can validate LINE AI assistant and alert workflows before investing in native app complexity.

### Trade-offs

- LINE platform dependency affects availability, UX constraints, and message costs.
- LIFF has browser/runtime limits compared with web or a native app, so MVP limits LIFF to account linking and handoff.
- Messaging API user ids are channel-scoped and require careful account linking.
- Heavy offline scanning or device-native flows may require a future native app decision.

## Alternatives Considered

### Native app first

Rejected for MVP because install friction and release overhead are high before daily workflows are validated.

### Web-only responsive app

Rejected as primary chat surface because alerts and conversational AI would lose LINE distribution advantages. Web remains the full workspace.

### Cognito hosted UI first

Deferred. Cognito or another identity broker may still issue first-party sessions behind the backend, but end-user login should start with LINE Login for MVP.

## Implementation Notes

- Add `ExternalIdentity` records for LINE provider ids.
- Verify LINE Login tokens and Messaging API webhook signatures server-side.
- Keep raw LINE tokens out of logs and audit metadata.
- Issue WatchDog-BMS first-party session/JWT after LINE identity validation.
- Keep all business APIs permission-checked through internal user and company context.
- Add rich menu links for Ask AI, Daily Summary, Alerts, Link Account, and Open Web.
- Keep web admin as the full workflow surface for data entry, approval, accounting, inventory, CRM, reports, and setup.

## Test Requirements

- Invalid LINE webhook signature is rejected.
- Expired or wrong-audience LINE login token is rejected.
- Unlinked LINE user cannot access business records.
- Linked LINE user resolves correct company memberships and permissions.
- Old LIFF deep links re-check current membership and permissions.
- LINE AI answers use current permission checks and source references.
- Deep links from LINE re-check current membership and permissions before showing web detail.

## Follow-up Questions

- Which LINE Official Account plan should be used for alpha volume?
- Should owner/admin actions require step-up verification before beta?
- Which invite/linking flow is simplest for first customers?
