# Agent Memory: Postmark domain DNS setup

Status: COMPLETE for domain DNS verification; Postmark account approval confirmed Live on 2026-09-12. Application integration and inbox proof remain outstanding.
Owner: Root, acting on the user's explicit request to control Chrome Developer profile.
Scope: Add Postmark DKIM and custom Return-Path records for mangmeeplus.com in Cloudflare, then verify in Postmark.

Decisions:
- Read the cloud-environment operations runbook before cloud changes.
- Added TXT `20260912060139pm._domainkey` using the exact public key displayed by Postmark; TTL Auto.
- Added CNAME `pm-bounces` pointing to `pm.mtasv.net`; DNS only, TTL Auto.
- Existing mail and website DNS records were not edited. No SPF, MX, or DMARC changes were needed for this task.

Open questions:
- Remaining server/stream configuration, credentials, billing, and application integration remain separate M4/runtime work.

Artifacts:
- [Postmark DNS settings](https://account.postmarkapp.com/signature_domains/8102051).
- [Transactional email provider plan](../plans/mangmee-transactional-email-provider-plan-th.md).

Verification:
- Chrome window confirmed Developer (mangmeeplus.com) profile.
- Cloudflare record list showed both saved records with the expected values, DNS-only status, and Auto TTL.
- Public resolver check: `dig +short TXT 20260912060139pm._domainkey.mangmeeplus.com @1.1.1.1` returned the configured public key.
- Postmark Return-Path: Verified. DKIM initially awaited DNS propagation, then Verify returned Verified and confirmed the domain.
- The assistant did not submit the account approval request, purchase, send a test email, change application configuration, or deploy. Domain verification is not inbox delivery or runtime acceptance evidence.

Next:
- Complete backend integration, remaining server/stream configuration, and controlled delivery proof under their own authorized scope.

## Approval form draft — 2026-09-12

- User continued to the account approval form and confirmed an initial volume of 1–1,000 emails/month.
- Filled that volume and the three explanatory fields in Chrome: provider choice, transactional verification/activation/password-reset messages, and direct application-user recipients with planned bounce/complaint suppression handling.
- Wording explicitly describes application integration and suppression handling as planned; it does not claim implementation or delivery tests have passed. Stripe remains responsible for customer payment documents.
- Read back all fields successfully. The form is prepared for user review; Request approval has not been clicked, and no test email was sent.

## Account approval confirmed — 2026-09-12

- User subsequently supplied an approval screenshot. Read-only browser verification confirmed the Postmark banner: account approved and live.
- Current allowance displayed: 0 of 100 emails this period. The approval-form estimate of 1–1,000 emails/month is not a purchased plan or quota increase.
- Opened the existing My First Server, ID `20896570`, and confirmed Default Transactional Stream (`outbound`) exists. The UI reports no use in the past 30 days.
- No new server/stream was created, no API token was opened, and no email was sent. Account approval does not establish application integration or inbox delivery acceptance.

## Repository delivery — 2026-09-12

- User explicitly authorized committing these documents and merging into develop and main with admin privileges without waiting for CI.
- Scope is this memory and the transactional email provider plan only. No runtime, workflow, or package changes are included.
- Local verification: all 8 relative links across the two documents resolve; whitespace validation passes. Application tests are not applicable to this documentation change.
