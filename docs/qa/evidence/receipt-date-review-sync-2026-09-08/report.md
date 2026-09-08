# UAT receipt date correction — 2026-09-08

Status: UAT deployment, signed Passport, live infrastructure acceptance and automatic signed READY/clone cleanup passed. Actual Drtb UI retest is pending Mac unlock. Production remains held for new owner approval.

## Cause and correction

The actual Drtb draft held the selected receipt date `2026-09-07` while its explicit AI `dateStatus` remained `unverified`, with an old unreadable-date reason and an empty missing-field list. The final review correctly honored the explicit status, so the user could save and advance but could not submit. The original regression fixture omitted this explicit status and therefore missed the contradiction.

The existing save transaction now reconciles an explicitly supplied date with verification status and date-specific warnings, records who resolved it and when, and preserves raw OCR and unrelated findings. Omitted dates do not become verified; cleared dates remain incomplete. The same validation now protects final API/DB state transitions. Customer copy no longer attributes manual corrections to AI and points to the correct visible form step.

The ordinary PANDA MALA form, theme, optional business purpose, accepted tax calculations, category and line identities are preserved. No schema migration, dependency or feature flag was added.

## Verification before release

- Two new PostgreSQL regressions reproduced the retained status and missing API guard before the fix. The corrected PostgreSQL suite passed 15/15.
- Existing focused API/domain/repository checks passed 160/160; the updated focused subset passed 14/14 (overlapping counts, not additional unique coverage).
- Web suite passed 1678/1678; API and web typechecks passed.
- Actual local browser tests passed 11/11 at mobile and desktop widths, using an explicit unreadable-date fixture. They kept purpose blank, clicked the final UI button, observed the reviewer-mark-ready POST and read `READY_FOR_CONFIRMATION` from PostgreSQL.
- Exact candidate PR CI [34191737998](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34191737998) and [34191759752](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34191759752) passed all six required jobs. The required jobs actually executed.
- PR [490](https://github.com/MangmeeDev/mangmeeplus/pull/490) and [491](https://github.com/MangmeeDev/mangmeeplus/pull/491) merged the exact reviewed candidate into develop and main.

## Release identities

- Candidate: `88a08ae3e8e93fe12840f1c46c006945fb96b3c8`.
- Frozen controller/main: `13a9ecf0f3a7a623cfa2c285212eba16d4383eaf`.
- UAT: [34193070736](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34193070736), one all-target dispatch.
- READY: automatic [34195025467](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34195025467), SUCCESS on the frozen controller. Canonical signature/artifact/READY validation passed with every check PASS. This is the maintenance-mode readiness proof and cannot be used as live Production approval.
- Production: no dispatch; existing live service and customer OPEN state must remain unchanged.

## Actual Drtb acceptance

Pending post-release browser retest. The Mac locked again during deployment; a request to unlock it is pending. This does not stop GitHub/AWS validation, but actual UI acceptance must not be substituted with a direct API write.

The supported read-only UAT DB baseline proves: DRAFT, date `2026-09-07`, dateStatus `unverified`, stale unreadable-date reason, one AMERICANO - ICED line, quantity 1, accepted base price 51.40, VAT 3.60, total 55.00, and the existing meals category. The final comparison must preserve the original line ID/category and money while recording the date resolution and actual submission state.

After deployment, a second scoped READ ONLY query proved those exact values, source header and original line ID were unchanged. This confirms that deployment did not silently rewrite historical date verification. It is deliberately a **pre-UI** comparison, not evidence that saving or submission passed. The SSM tunnel was closed after the query.

## Post-deploy service acceptance

- Signed Passport verified with the exact GitHub workflow/controller identity and canonical validator. Artifact digest: `sha256:007ea4c19b8723870ad10138f6d77ef1e87ea78924004666684ed3306bf1dd58`.
- Each of the three UAT services is ACTIVE with one stable configuration, running tasks, capacity 1/2 and the exact signed candidate digest.
- Deep DB readiness returned `service=api`, `status=ok`, `db=ok`. Health, signup page and signup JavaScript returned 200. Public customer gate is OPEN; login returned 200; unauthenticated me returned 401.
- Official LINE webhook endpoint was active and matched UAT; provider webhook test returned success/200. No customer message was sent.
- All eight expected receipt/onboarding flags are true on UAT; AUTO_FREE and 15 trial receipts are present. UAT sandbox email remains as before. No new flag was added in this corrective patch.
- Production services, revisions, images and capacity exactly match the prior baseline; customer gate remains OPEN and login 200. Production still uses the older code, four receipt flags are absent there and trial warmup is 10; the prepared deployment defaults provide the four flags and 15 on the next authorized release. Production email stays disabled. Environment-specific URLs/channels/secrets are not copied from UAT.

Machine-readable evidence is in this directory. The CI-reuse job log identifies successful exact-head run `34191759752`; skipped duplicate validations in UAT are not being mistaken for executed tests.

## Readiness and final boundary

READY artifact digest: `sha256:60dd3b5800e612a75535e6878f5f90cfb000835b6558f31f2241575c3227a5bd`. The two previously pending support/signup recovery migrations rehearsed successfully on the isolated clone; schema validation passed. Signed cleanup proves instance absent, temporary secret and snapshot deleted, task stopped and residual resource count zero. Production's real migration ledger was not advanced by this rehearsal. Both Passport and READY expire at `1788935470`; a future live promotion must satisfy the then-current runbook and new owner approval, not reuse this maintenance-mode proof as live authorization.

Main is still frozen at the exact controller. A fresh final read-back confirmed Production services/revisions/images/capacity and public OPEN/login state unchanged. No Production run was dispatched.

Remaining test requires the Mac to be manually unlocked. On the authenticated Drtb page, save the correct date through บันทึกแบบร่าง, verify the success toast and reload, leave purpose blank, advance through steps 2 and 3, then click ส่งตรวจสอบ once. Verify READY_FOR_CONFIRMATION and resolved date metadata with a scoped read-only DB query while preserving the existing line/category/money. Do not bypass a disabled UI with a direct API mutation; do not claim this live UI acceptance passed until it is observed.

The earlier failed live test remains historical evidence in [the prior report](../receipt-stable-review-2026-09-08/live-browser-report.md).
