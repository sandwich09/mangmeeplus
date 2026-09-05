# Agent Memory: auto-register-flow-b

Status: IMPLEMENTED (Slices A-C + P29 T1-T3) on `codex/auto-register-round1`, 2026-08-30 — 4 Opus agents in parallel worktrees, Fable integrated (wiring, P29 hook, claim-session BFF chain, line_linked_elsewhere code, expired-company switcher+role labels, reject-notify checkbox disabled). Flag off everywhere; NO UAT deploy until SES ops (Owner). Follow-ups: businessCategory at approve (PDPA tripwire gap — top), rejection-notice consumer, LINE expired-reply seam, DRAFT-seat loophole, EMAIL_PENDING→EXPIRED sweep, merge-accounts backend (dialog primary = เร็ว ๆ นี้), SES bounce→EMAIL_FAILED (Slice D).

Owner: thawatchai

Scope: Self-service company signup — public in-app form → auto validation → admin queue → approve → single claim email → set password / attach existing account → provision → LINE step. Covers P10 (signup contract) + P11 (email/claim) deltas.

Decisions (all Owner-confirmed in chat 2026-08-30):

- Flow B order: RECEIVED → VALIDATED (schema+MX+rate limit+dedupe hints, no email) → PENDING_REVIEW → approve → EMAIL_PENDING (single email) → EMAIL_VERIFIED (claim = prove mailbox + set password OR login existing) → PROVISIONING → READY → LINE_LINK_PENDING → COMPLETED. Reject default silent (email unverified) with optional per-case notice; approved-but-unclaimed → EXPIRED, no orphans.
- Email duplicates allowed by design: 1 email = 1 User = many companies (P13 multi-company); claim-page mandatory branch "มีบัญชีอยู่แล้วหรือยัง" — existing login (password or LINE) → attach membership via `attachUserId`, never a second User; attach only after mailbox proof. Company names always duplicable (no DB unique on Company.name — verified).
- No temp password ever; new-user path stores only `pendingPasswordHash` on the request, moved to UserCredential at provision.
- LINE step on success page reuses live P12 (OAuth mobile / QR desktop / OA add-friend); skippable; LINE-conflict dialog offers only "รวมเข้าบัญชีเดิม" (move membership+email, deactivate emptied account, keep audit) or "ไว้ก่อน" (consequences shown, re-offered every attempt); NO move-LINE option in that dialog. Role labels added to company pickers (web+LINE) this round.
- Ingress = public in-app page `/signup` + `POST /v1/public/company-signups` (customer-line-register precedent); signed official-site API deferred to future. Claim TTL 7 days default; queue SLA alert 24h; token = mint-at-send in workers consumer (outbox event carries signupRequestId only; hash-only invariant).
- Offer catalog replaced 2026-08-30 (Owner image + official site agree): STARTER 249 / BASIC 499 / PRO 999 / ENTERPRISE 1,999; **trial = PRO free** (5 branches, 10 staff, 100 slips/mo — supersedes the old 15-receipts idea and the 259/599/999/1299 catalog). Selectable key `PRO_TRIAL` only. Trial duration + post-trial answered 2026-08-30 via P29 Company Plan Term (default 30 days exact-hour, expiry = disable company, admin renew re-enables; provision sets PRO preset + 30d). Still TBD (non-blocking): "100 ร้านแรก" cap policy, AI budget. Slip-quota enforcement is P26.

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

## Update 2026-08-31: UAT live + first smoke PASS

- Status: Slices A–D **deployed to UAT and working end-to-end up to the approve gate**. Candidate `b2cc9d1a` (all services) + hotfix `8fc26b20` (api-web only, deploy run 33371408927).
- Deploy saga: wave order (workers before api-web) caused a 404 storm from new workers timers hitting the old api → RollbackAlarm auto-rolled api-web twice. Resolution: restore old workers image, deploy per-service api-web → workers. Two held release ops recovered via recover-release-intent.yml. Durable fix required before production all-target round: workers callInternal 404 backoff (mixed-version tolerance).
- Post-deploy bug found+fixed: `/signup`, `/signup/welcome`, `/claim-account` were prerendered → CSP nonce missing → pages dead. PR #385 (force-dynamic, verify-email pattern) → #386 → deployed. Probe: `curl -sD - <url> | grep x-nextjs-prerender` must be empty.
- Smoke PASS: availability enabled:true; /signup renders; real submission via browser (ร้านทดสอบระบบ มั่งมี (UAT), contact@mangmeeplus.com, PRO_TRIAL) → requestId `cmtgzg42a000x4k5xje8ot9mg` status PENDING_REVIEW; status page 200. SES env on api-web verified (provider=ses, ap-southeast-1, from contact@mangmeeplus.com); SES sandbox allows @mangmeeplus.com recipients; production access under AWS review.
- Handoff: Owner approves the queued request in system console → verifies SES claim email → runs docs/plans/mangmee-auto-register-uat-test-plan-th.md (5 rounds).
- Next code batch (one PR per CI-cost rule): workers 404 backoff; new-signup LINE+dashboard notification to Owner (no notification exists today — queue page only); rejection-notice email consumer; DMARC TXT record.

## Update 2026-08-31 (2): round-3 hardening batch (Owner order: items 1-13 except production)

One integration branch `codex/round3-hardening` merged four reviewed workstreams (each spec-verified, all typechecks + boot green):
- **Account merge live (spec §4F)**: AccountMergeTicket (hash-only, 15 min) minted on the web link 409; POST /v1/auth/account-merge moves ACTIVE memberships (+EmployeeAccessProfile.userId), moves email when target has none, DISABLES + session-revokes the emptied account, auto-signs-in as the merged account. Welcome dialog primary is live; sidebar LINE entry returns to /signup/welcome.
- **Workers 404 backoff root-cause**: shared postInternal + missing-endpoint gate (5-min backoff, warn once) across 7 timer callers; notification-worker intentionally ungated (per-record 404s must reach the DLQ).
- **P29 LINE + caps**: expired-company OWNER gets the renewal reply on both webhook entry points (status plan_term_expired, excluded from AI-failure alarm); employee cap enforced at completeDraft AND re-enable.
- **Signup pipeline**: PENDING_REVIEW → dashboard + LINE push to system admins (dedup per request); opt-in rejection email (reason ≤500, escaped, outbox-driven); 30-day silent-after-approve sweep → EXPIRED (reissue still allowed); SES bounce/complaint SNS endpoint (signature-verified, fail-closed) → EMAIL_FAILED via claimEmailSesMessageId.
- Wiring: deploy.sh env EMAIL_LOGO_URL / SES_CONFIGURATION_SET / SES_EVENTS_TOPIC_ARN (UAT on, production empty = fail closed), pins re-synced; 4 new spec files registered in apps/api test list.
- Post-deploy ops still owed: SNS HTTPS subscription per runbook ses-email-setup.md ขั้นที่ 6 (subscribe the ECS origin, NOT the custom domain), then simulator bounce proof.
- Done outside the repo: Cloudflare DMARC Management enabled (p=none, dashboard reports); mangmee_web branch `signup-cta` ready (do NOT upload until production signup activates); SES production access still under AWS review.
- Owner order 2026-08-31 (evening): claim email carries NO trial-benefits block and NO LINE-invitation block (both removed from the template with regression guards — package terms and the LINE step are in-app only). The LIFF/rich-menu signup flow (spec §4F future note) is **ON HOLD** by Owner order — do not build until they lift it.

## Update 2026-09-05: external review P1 round — branch `codex/flow-b-p1-fixes`

Status: **P1 ปิดครบ** (R01, R02, R03, R04, R05, R06, R08, R09) บน `codex/flow-b-p1-fixes` แตกจาก `origin/develop` `91704151`; ยังไม่ merge, ยังไม่ deploy. รายงานต้นทางและตารางว่าอะไร reproduce/ไม่ reproduce อยู่ใน `docs/agent-memory/auto-register-review-2026-09-05.md` (commit ไว้ทั้งฉบับเป็น baseline แล้วต่อท้ายด้วยหัวข้อ "รอบแก้ P1 2026-09-05")

ทุกข้อทำแบบ red-first: เขียนเทสต์ที่ fail บน develop ก่อน commit แล้วจึงแก้ ทั้งสองส่วนเก็บไว้

Owner decisions ที่บันทึกรอบนี้:

- **แพ็กเกจตอนสมัคร (2026-09-05):** ไม่มีการเลือกแพ็กเกจที่หน้าสมัครอีกต่อไป ทุก self-signup — ทั้งฟอร์มเว็บและ LINE — ได้ **free trial เดียวกัน** (`FREE_TRIAL_15`, 30 วัน, 15 สลิป/เดือน) เดิมฟอร์มเว็บให้ `PRO_999` ทั้งที่หน้าเว็บโฆษณาว่าทดลองฟรี `requestedOfferKey` เหลือไว้เป็นหลักฐาน attribution เท่านั้น (รับค่าใน catalog, ค่าอื่นทิ้ง, ไม่ปฏิเสธคำขอ) — คิว admin ไม่ได้แสดงคีย์นี้ จึงไม่มี DTO ต้องแก้
- **merge ที่สิทธิ์ทับกัน (R05):** fail closed ด้วย `account_merge_role_conflict` เมื่อสอง membership ของร้านเดียวกันมี role ไม่ตรงกัน หรือ membership ฝั่งปลายทางไม่ ACTIVE และบังคับ invariant "ต้องเหลือ ACTIVE OWNER อย่างน้อยหนึ่งคนต่อร้าน" ก่อนปิด membership ใด ๆ พร้อม preview รายร้าน (`POST /v1/auth/account-merge/preview`) ที่บอกว่าร้านไหนย้าย ร้านไหนติด และหลังรวมแล้วเข้าสู่ระบบด้วยอะไร

Schema delta: `CompanySignupRequest.claimWindowStartedAt` (nullable, additive migration `20260905173000_signup_claim_activation_window` พร้อม backfill จาก `approvedAt`) — R09 ต้องการนาฬิกาที่ reissue รีสตาร์ทได้ โดยไม่แตะ `approvedAt` ซึ่งเป็น audit fact

ชื่อ migration ตั้งเป็น `173000` เพื่อไม่ให้ prefix ชนกับ `20260905170000_line_support_request` บน `codex/line-support-request` (คนละตาราง: อันนั้นสร้าง enum และตาราง `LineSupportRequest` ใหม่, อันนี้เพิ่มคอลัมน์บน `CompanySignupRequest` — additive ทั้งคู่ ลำดับไหนก่อนก็ได้) ลำดับที่จะ apply จริงคือ `170000_line_support_request` → `173000_signup_claim_activation_window` → `180000_line_support_request_notified_at`

Verification (รอบสุดท้ายบน `43fd6d05`): api 6537 tests / 1323 suites / 6438 pass / 0 fail / 99 skipped; web 1489 tests / 322 suites / 1489 pass / 0 fail; `apps/web` build ผ่าน; `pnpm -r typecheck` ผ่าน; `prisma validate` ผ่าน; maintenance pins `--check` = current; pg spec ใหม่ `signup-provisioning-recovery.pg.spec.ts` (5 tests) รันบน docker postgres จริงและถูกเพิ่มใน ci.yml pg step แบบ invocation ของตัวเอง

Follow-ups ที่ยังไม่ทำ:

- ALB / Cloudflare access log ยังบันทึก path เดิม (R01 ชั้น infra) — งาน ops ไม่ใช่โค้ดนี้
- `apps/web/app/api/auth/login/route.ts` มีอาการ R06 เหมือนกัน แต่อยู่ใน maintenance pins จึงไม่แตะ
- ~~free trial ทางเว็บยังไม่ได้ AI budget/warm-up ของ LINE~~ **ปิดแล้ว 2026-09-05 (Owner follow-up):** `applyLineTrialGuards` → `applyTrialGuards` รันทั้งสอง source โดยดูจาก `SIGNUP_TRIAL_TIER` ไม่ใช่ source — ร้านจากฟอร์มเว็บได้ AI budget cap, warm-up 7 วัน และ term 30 วันชุดเดียวกับ LINE; `LineCompanyContext` และ LINE push ยังเป็นของ LINE เท่านั้น (gate ด้วย `lineProviderUserId`); `adoptExistingCompany` ไม่เขียน plan term ของตัวเองอีกแล้ว — มี writer เดียว. env keys ยังชื่อ `lineSignupWarmupSlips` / `lineFreeAiBudgetSatang` (การเปลี่ยนชื่อต้องแก้ deploy.sh จึงไม่ทำในรอบนี้)
- P2 ทั้งหมด (R07, R10–R13) และ integration matrix ท้ายรายงาน
