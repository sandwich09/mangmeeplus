# Agent Memory: auto-register-flow-b

Status: Spec/plan locked to Flow B (Owner amendment v2, chat 2026-08-30); implementation NOT started per Owner order ("ยังไม่ implement").

Owner: thawatchai

Scope: Self-service company signup — public in-app form → auto validation → admin queue → approve → single claim email → set password / attach existing account → provision → LINE step. Covers P10 (signup contract) + P11 (email/claim) deltas.

Decisions (all Owner-confirmed in chat 2026-08-30):

- Flow B order: RECEIVED → VALIDATED (schema+MX+rate limit+dedupe hints, no email) → PENDING_REVIEW → approve → EMAIL_PENDING (single email) → EMAIL_VERIFIED (claim = prove mailbox + set password OR login existing) → PROVISIONING → READY → LINE_LINK_PENDING → COMPLETED. Reject default silent (email unverified) with optional per-case notice; approved-but-unclaimed → EXPIRED, no orphans.
- Email duplicates allowed by design: 1 email = 1 User = many companies (P13 multi-company); claim-page mandatory branch "มีบัญชีอยู่แล้วหรือยัง" — existing login (password or LINE) → attach membership via `attachUserId`, never a second User; attach only after mailbox proof. Company names always duplicable (no DB unique on Company.name — verified).
- No temp password ever; new-user path stores only `pendingPasswordHash` on the request, moved to UserCredential at provision.
- LINE step on success page reuses live P12 (OAuth mobile / QR desktop / OA add-friend); skippable; LINE-conflict dialog offers only "รวมเข้าบัญชีเดิม" (move membership+email, deactivate emptied account, keep audit) or "ไว้ก่อน" (consequences shown, re-offered every attempt); NO move-LINE option in that dialog. Role labels added to company pickers (web+LINE) this round.
- Ingress = public in-app page `/signup` + `POST /v1/public/company-signups` (customer-line-register precedent); signed official-site API deferred to future. Claim TTL 7 days default; queue SLA alert 24h; token = mint-at-send in workers consumer (outbox event carries signupRequestId only; hash-only invariant).
- Trial numbers (duration/receipts/AI budget) display-only this round — enforcement is P26; numbers still TBD, non-blocking.

Open questions:

- P10 §8.5 trial numbers (non-blocking). P11 §5.1–2 SES ops (blocking live email only): sender domain (recommend no-reply@mangmeeplus.com; DNS is on Cloudflare), region (recommend ap-southeast-1), IAM has zero SES perms today (account never configured = sandbox; production-access request ~1 day lead).

Artifacts:

- Spec P10: `docs/specs/mangmee-external-signup-contract-spec-th.md` (amendment v2 block, §3 in-app ingress, §4 Flow B states, §4B claim branch, §4C dup policy, §4D email/reject/bounce, §4F LINE+merge, §8 updated)
- Spec P11: `docs/specs/mangmee-email-delivery-claim-spec-th.md` (F-EM-3 post-approve single email, mint-at-send, TTL 7d, §5 updated)
- Plans: `docs/plans/mangmee-external-signup-plan-th.md` (Slice A–E), `docs/plans/mangmee-four-lane-gap-closure-plan-th.md` (P10-0B v2, P10-1 unblocked)

Verification: docs-only change; internal links checked by reading; no code touched.

Next:

- Owner answers P11 §5.1–2 (start SES ops in parallel — longest lead time) and trial numbers when ready.
- Implementation order on approval to build: Slice A (migration delta + public routes + form/status pages) → B (claim token + page, console provider) → C (admin queue + provisioning adapter + LINE/merge/role labels) → D (SES live, parallel ops) → E (flag default-off, UAT e2e, production per V2 runbook).
