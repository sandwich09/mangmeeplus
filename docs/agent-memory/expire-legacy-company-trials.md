# Agent Memory: expire-legacy-company-trials

Status: COMPLETE — local 1, UAT 14 and owner-authorized Production 60 companies adjusted; preservation, runtime health and UI verification passed.
Owner: user / Codex.
Scope: same verified operator script across local/UAT/Production; Production now authorized by “โอเค รันที่ prod ได้”.
Decisions: Company.createdAt <2026-09-05T00:00:00+07:00, exclusive; newer unchanged.
FREE_TRIAL_15 with1/2/15 limits, original creation+30days, already expired. User explicitly chose
skip all paid/financial history and preserve SYSTEM_ADMIN companies. Pending operations skipped.
Preserve manual/security holds, users/data/feature entitlements; no provider messages. User added
full management/purchase flow up to real Stripe screen, without paying.
Open questions: none. Local existing ownercheck runtime uses synthetic Stripe account and no
STRIPE_SECRET_KEY in process environment; do not claim real provider proof there.
Artifacts: apps/api/src/scripts/expire-legacy-company-trials.ts and .pg.spec.ts;
docs/runbooks/expire-legacy-company-trials.md;
private `/Users/thawatchai/.codex/package-adjustments/20261005-expired-trial/`.
Verification:
- Actual migrated PostgreSQL18:6/6 pass independently in Asia/Bangkok and UTC; initial regression
  caught/fixed7hour node-pg naive timestamp conversion by projecting JSON UTC source timestamps.
- AuthGuard39/39 pass including expired recovery boundaries. Final API typecheck passed. Production apply guard refused before DB connection.
- CLI help isolated from imported cleanup CLI, wrong-database apply guard passed.
- Full local backup2022323bytes, SHA54fab250d7e43845f645de37e15c6d9607342ea7bc23646b97fa6fa10213a17e;
  restored/rehearsed with266tables/16887preserved rows. Actual local operation
  d93270a4-1316-43f2-8e29-3d6c0b200c92 changed1,skipped9financial/pending, preservation hashes equal.
- Full UAT backup14793412bytes, SHAb17fec83d8a8df27c68656e8bc5e1221855f55684be0578fe3f4b11737bab546;
  restored/rehearsed257tables/117456preserved rows. Actual UAT operation
  dc857fd2-ae45-4d63-81ba-e8499eb88f9f changed14,skipped3:WatchDog UAT paid/pending,
  เจ๊เฟรส pending package operation,system company SYSTEM_ADMIN. Live preservation258tables
  (includes migration metadata) plus preexisting term untouched fields matched exactly.
- First UAT preservation query hit20s statement timeout before apply. Replaced sorting full row
  JSON with sorting fixed-size row digests; repeated only read-only preparation, then apply once.
  No service interruption, gate change or deployment; UAT/READY/PROD IDs NOT_DISPATCHED.
- UAT serving7b1b1c11ee7ada750caa84bcd01e60b6ff1cde19; exact runtime schema used. No application
  deploy or package.json change. Browser company test sand reaches expired page/settings.
Browser: expired page, settings, billing and STARTER249 CARD_ONCE quote succeeded without a
coupon. Owner answered “ลองกดดูได้เลย” after the action-time consent question. Refreshed the
expired quote with unchanged purchase options, accepted consent and reached real Stripe Sandbox.
No payment details entered, no Pay click. Used Stripe cancel return then the app's existing
“เลือกแพ็กเกจใหม่” action to end the unpaid Checkout. Screenshots uat-stripe-checkout.jpg and
uat-checkout-canceled.jpg saved and visually checked.
Next: no required work remains. Retain private backups/evidence. Any future execution requires
a fresh environment-bound preview and verified backup; do not blindly repeat a committed operation.
Preserve unrelated working-tree edits. No commit, push, package.json edit or deploy performed.

Retirement/proof follow-up: owned disposable PostgreSQL container expired-trial-check-pg removed;
other existing local containers untouched. Private bundle SHA256
17b9b634c143412f6401a316ba2fe5cd905679414176e84c89099b71e6fce642.
First final-readback wrapper had a JavaScript Client name collision after concatenating bundled
library and private readback helper; this read-only step failed before querying or retiring files.
Scoped the helper in a block, passed node --check locally, and resumed readback/retirement only.
No adjustment apply was repeated. Prior7transport phases closed14/14SSM sessions.

Final data/service acceptance passed:14/14exact target rows,14audit rows,0remaining changes;
API/AI/workers deep health and public health/OPEN/login marker passed. Same API container/image.
Removed only owned remote backup/CA and preview/result copies after saving local evidence.
Before the browser follow-up all8transport phases closed16/16SSM sessions.
Final browser follow-up readback at2026-10-05T06:50:43+07:00:
- attempt f44beccc-02ba-4b3d-b900-5bf623983e91 EXPIRED, activeAttemptId null;
- no invoices, paidSatang0, no subscription and no entitlement activation;
- all14adjusted target term fields/statuses unchanged;
- actual Stripe GET session: livemodefalse, statusexpired, payment_statusunpaid, amount_total24900,
  currencythb, subscriptionnull. Private uat-stripe-flow-proof.json records exact evidence.
- All9transport phases closed18/18SSM sessions, with0failures. Owned local PG container and its
  identified anonymous volume removed; original local services untouched. No remaining operator
  files on UAT. Browser workflow complete; no handoff/payment tab needs to remain open.

Production authorization (2026-10-05): user explicitly instructed running Prod after actual UAT
Stripe acceptance. Preserve the same date cutoff/exclusions/holds. Fresh live runtime/schema
review, private backup, restore rehearsal, reviewed Prod-bound manifest, atomic apply and
readback are required. Use the exact UAT-tested bundle; no deployment, gate change or root.
Prod evidence: `/Users/thawatchai/.codex/package-adjustments/20261005-prod-expired-trial/`.
Workflow IDs remain NOT_DISPATCHED for this operator data adjustment.

Prod preparation: serving908e7aab9b15561317609a67bac770b7ca8a2886 on bothAPI replicas plus
AI/workers, allhealthy. Schema, billing, plan-term/lifecycle/auth and billing/workspace web source
are byte-identical in Git to UAT7b1b1c11ee7ada750caa84bcd01e60b6ff1cde19 for the checked paths.
Full fresh backup26293087bytes, SHA0134246c0c12355a81f5328fc9b9be732f2d7644e1f30951c02fce32c40d47bf.
Fresh Prod preview selected63,eligible60(allACTIVEwith noCompanyPlanTerm),skipped3:
Sales Mangmee Youngyuen Company and บริษัท มั่งมียั่งยืน จำกัด pending operations; internal
SYSTEM_ADMIN company. Latest eligible created2026-09-02T13:13:55.539Z,expires2026-10-02T13:13:55.539Z.
Initial local restore's768MiBtmpfs container was OOM-killed during index creation. No Prod writes.
Saved failure log, retired only that owned container, and moved clone to a labeled disk volume
with1536MiBlimit before repeating the local restore. No remote backup or preview was repeated.

Production completion — 2026-10-05 Asia/Bangkok:
- Exact UAT-tested bundle SHA17b9b634c143412f6401a316ba2fe5cd905679414176e84c89099b71e6fce642.
- Disk-backed restore and rehearsal passed:60changes,3skips,258tables/348848preserved rows;
  repeat preview0changes. Local transaction196ms. No application code or package.json changed.
- Prod operation3c2146e8-270a-419d-bba5-16296dd2eb53, manifest digest
  5911331b470027a6634ea5fd4c7ddbc57b6a6ff3c18f240263166ffc74487f4c, invoked once with explicit
  --production-authorized. Operator apply/read-receipt interval07:08:40–07:08:49(+07:00).
- All60eligible companies were ACTIVE with no term. Created FREE_TRIAL_15 term1branch/2members/
  15receipts, original creation+30days; lifecycle DISABLED with machine-expiry marker. Inserted
  60audit rows atomically. No data deletion, notifications, provider mutation or charges.
- Live before/after hashes matched across258tables/348849preserved rows (allowed Company status/
  disabledAt/updatedAt columns, new target terms and operation audits excluded by exact scope).
  Remaining24companies created at/after the cutoff and3excluded companies unchanged.
- Final07:09:41(+07:00) readback:60exact target terms,60audits,3exact excluded company/term sources,
  24newer of87total companies,0remaining changes; all have the normal expiry recovery shape.
- BothAPI replicas, AI and workers retain the same containers/images/start times. Deep readiness,
  publichealth, PlatformAccessOPEN and login-open marker passed. No stop/start, deployment,
  customer-gate or IAM change. UAT/READY/Production workflow IDs NOT_DISPATCHED.
- Existing authenticated SYSTEM_ADMIN browser verified one affected company: ทดลองใช้ฟรี,
  หมดอายุ,1/2/15limits, original Aug16start and Sep15expiry, and the package-recovery notice.
  Screenshot prod-expired-trial-proof.jpg. No owner Checkout or Stripe operation on Production;
  exact relevant Prod code matches UAT where the real Sandbox purchase flow already passed.
- Owned remote dump/CA/manifest/receipt copies removed after retaining verified local evidence;
  owned local clone container and labeled disk volume removed. All3Prodtransport phases closed
  12/12SSM sessions. Backups and proofs retained0600/private dirs0700.
- Primary evidence: prod-apply-result.json, prod-live-proof.json, prod-final-readback.json,
  prod-acceptance.json, retirement.json and transport-summary.json in the Prod evidence folder.
