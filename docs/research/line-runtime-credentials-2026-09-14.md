# LINE runtime credential findings — 2026-09-14

Status: Messaging-only publication is implemented locally with8 actual HTTP/PostgreSQL/Next/Chromium groups PASS against synthetic LINE transport. No deployment or provider settings changes. Login/LIFF identity changes, webhook endpoint publication and rich-menu publication remain separate work.

## Verified provider constraints

LINE signs the original webhook body with the Messaging API channel secret. Verify before parsing/processing. Reissuing that secret invalidates the previous secret; a bot still using the old value will fail verification. A successful token check cannot prove that the stored signing secret matches LINE. Verify the incoming path with an actual signed webhook/probe and record the exact credential revision used. [LINE signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/).

The Messaging API reference separates token verification, webhook endpoint information/testing and message sending. It provides POST /v2/oauth/verify for short/long-lived tokens and GET /oauth2/v2.1/verify for v2.1 tokens. This increment supports the POST lane only, with URL-encoded access_token, exact client_id and bounded positive expires_in. A read/check must not be reported as message delivery, and a webhook probe is not a customer send. [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/).

## Initial repository findings

- SystemLineController and its UI are intentionally closed: the permission is not registered and the setter writes encrypted PlatformLineCredential, while webhook/reply consumers use AppConfig environment getters. Opening only that permission would create false success.
- PlatformLineCredential already has credentialKind, encryptedSecretJson, secretVersion, health, rotatedAt and lastValidatedAt. Reuse this storage and existing encryption; preserve secret-free DTO/audit behavior.
- Consumers include LINE webhook signature checks, reply/push, media reads, loading indicators, signup/notification/plan-term messages, LINE Login and LIFF identity configuration. Persisted ledger/source/recipient channel bindings must survive token rotation; a different channel is an identity migration, not an implicit remap.

## Implemented boundary and proof

The common uncached resolver is consumed by all15 shared Messaging consumer classes. Only an explicitly published row supersedes environment configuration; corrupt/failed reads do not fall back. Expired outbound tokens do not discard inbound requests signed by the published secret. Channel identity stays pinned. Publication requires current platform permission, password/session, expected revision, bounded token verification and an atomic encrypted save/audit. A stable rotationId recovers the same save. The UI separately shows credential readability, token observation and an observed raw-body signature for the exact revision; none claims native message delivery.

Local proof covers Admin/BFF→DB→signed current/legacy webhook routes, old-secret rejection, concurrent publications competing on the same revision with exactly one winner, reply/push/loading/media, current token in a previously queued notification with the same payload/retry key, no repeated send after acceptance, stale save/replay, role withdrawal during provider read, corrupt storage and unchanged identity/money/quota. Removed the ordinary notification worker's legacy cross-channel recipient fallback; a foreign-channel identity is skipped without sending. The mobile page was visually checked at390px. Standalone adapter/worker calls are not a full signed customer-message→AI queue proof. Remaining older recipient lookups in password-reset/employee/signup-admin/partner notices need their own channel-binding audit; Messaging token consistency does not certify that broader identity matrix.

Recovery uses the current provider secret/token in another reviewed replacement; this does not issue/revoke credentials or promise that an older secret is still valid. Native LINE acceptance, Login/LIFF, rich-menu/webhook endpoint publication, full intake/draft/live-capture, and remaining C07 daily/historical/drift work remain open. See [controls spec](../specs/mangmee-billing-controls-spec-th.md) and [evidence](../evidence/billing-integration-2026-09-13/README.md).

## Follow-up identity compatibility finding

LINE user IDs are scoped to a provider, and the same person has the same ID across Login/Messaging channels under that provider; channels from different providers use different IDs. Our providerChannelId field pins the approved local Messaging relationship, rather than proving that LINE IDs differ for every channel. Keep the configured Login/Messaging pair under the same provider; do not infer a valid pair from matching-looking channel IDs. [LINE provider design](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/), [LINE FAQ](https://developers.line.biz/en/faq/).

Existing account state reports any ACTIVE LINE link, while same-user relink can retain a legacy channel row. Before closing all identity acceptance, provide a proof-backed repair route for known legacy bindings and distinguish account linking from current Messaging deliverability. Arbitrary foreign-channel rows must not be silently reassigned or accepted as current delivery targets. This is a follow-up finding; no login or identity migration is implemented by the Messaging credential publication patch.
