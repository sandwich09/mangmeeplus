# Postmark native delivery test — 2026-09-15

Status: provider-side Delivery confirmed for the intended UAT and Production senders. Gmail accepted the messages with SMTP `250 2.0.0 OK`; inbox-versus-spam placement and application integration remain unverified.

## Authorization and method

- User explicitly requested real test mail to their Gmail address in this conversation. Used that exact recipient, no Cc/Bcc or other test recipient. Recipient is masked here as `thawatchai.p…@gmail.com`.
- Sent through Postmark's template-editor Send test UI in the dedicated Live servers. No API token/password was read, copied or stored. This did not activate either application runtime.
- Created diagnostic templates only: UAT `47767476`, Production `47767477`, named `Delivery verification - <environment> - 2026-09-15`. HTML and plain text identify the environment and say no action is required. Templates remain in Postmark and are not wired into application flows.
- Added sender signature `contact@mangmeeplus.com` (ID `6141055`, name `Mangmee Plus`) under already verified mangmeeplus.com so it is selectable in the test UI. Existing developer signature `6137371` was unchanged.

## Native results

All times below are 2026-09-15, Asia/Bangkok, as displayed by the provider activity UI.

| Attempt | Server / stream | Actual From | Subject prefix | Processed / Delivered | Message ID | Result |
|---|---|---|---|---|---|---|
| UAT | `20950027` / `outbound` | `developer@mangmeeplus.com` | `[UAT] Mangmee Plus - ทดสอบส่งอีเมลจาก developer@mangmeeplus.com` | 21:42:24 / 21:42:26 | `6f359249-571b-40f7-b1f8-cb0c1f2e6b00` | Delivered; Gmail SMTP 250 |
| Production initial, sender-selection error | `20950034` / `outbound` | `developer@mangmeeplus.com` | `[PROD] Mangmee Plus - ทดสอบส่งอีเมลจาก contact@mangmeeplus.com` | 21:44:22 / 21:44:22 | `ec757778-883b-4095-afab-4e340cecc354` | Delivered, but failed intended From requirement |
| Production corrected | `20950034` / `outbound` | `contact@mangmeeplus.com` | `[PROD] Mangmee Plus - ยืนยันผู้ส่ง contact@mangmeeplus.com` | 21:45:56 / 21:45:57 | `a0865059-cb04-496c-9c61-1a696fb22d61` | Delivered; Gmail SMTP 250 |

Message details: [UAT](https://account.postmarkapp.com/servers/20950027/streams/outbound/messages/6f359249-571b-40f7-b1f8-cb0c1f2e6b00), [initial Production attempt](https://account.postmarkapp.com/servers/20950034/streams/outbound/messages/ec757778-883b-4095-afab-4e340cecc354), [corrected Production](https://account.postmarkapp.com/servers/20950034/streams/outbound/messages/a0865059-cb04-496c-9c61-1a696fb22d61).

The initial Production attempt was an agent UI-operation error: keyboard selection did not change the dropdown and Return submitted the form with its default developer sender. The user was informed before the corrective send. Correction used explicit `setValue` on the From dropdown, observed selected contact, visually verified To/From, then clicked Send test. Message details independently confirmed the actual From. Total real messages: **3**, matching account usage **3/100**. Do not report only two sends or count the initial Production message as a correct sender test.

## What this does and does not prove

- Proves each dedicated server can send an email from the required domain address and Gmail's receiving SMTP server accepts it.
- Does not prove Inbox placement, user reading, app token→server binding, deployed sender/recipient guards, outbox persistence, callbacks, OTP, verification/reset links, or release acceptance. No Gmail inbox was opened.
- Postmark's native Send test UI offers account-wide verified signatures and defaults to developer. It does not enforce the application's UAT/Production From mapping. The environment-specific application send guard remains necessary. Its source implementation is separate work in PR #558 and the associated working tree; it is not included or verified by this documentation-only change.
- UI UAT display name was the existing `Thawatchai Phuchana`; Production corrected display name was `Mangmee Plus`. App-specific From names and UAT subject-prefix enforcement must still be tested through the app after secret integration.
- This recipient authorization covered the requested manual test; a durable application UAT allowlist and further business-flow tests still need to be configured explicitly.

Next work: [provider implementation plan](../plans/mangmee-transactional-email-provider-plan-th.md) and [provider specification](../specs/mangmee-transactional-email-provider-spec-th.md). No AWS/runtime mutation, webhook test, API secret extraction, deployment, or source code change was performed during this test.
