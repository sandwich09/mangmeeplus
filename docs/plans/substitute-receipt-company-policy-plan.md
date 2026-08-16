# Substitute Receipt Company Policy Plan

## Status

COMPLETE — implemented and locally verified 2026-07-13

Supersession note (2026-08-06): the later owner-approved `OWNER_SELF` /
`DESIGNATED_APPROVERS` change supersedes this plan's original no-policy fail-closed and mandatory
distinct-approver decisions. No policy row now means default `OWNER_SELF`; `configured` and runtime
`ready` are distinct. The current contract/code and Expense and Receipt Upload Spec own that behavior.

## Goal

Add one company-scoped settings page that names the real users authorized to approve `ใบรับรองแทนใบเสร็จรับเงิน` and defines the minimum evidence required for cash payments. The runtime certificate flow must use the current approval mode, require distinct active payer/approver users under `DESIGNATED_APPROVERS`, allow only the explicit shared-role self-approval exemption under `OWNER_SELF`, and place each role's reviewed transparent signature into the exact certificate artifact.

## Decisions

- Route: `/companies/:companyId/settings/substitute-receipt`.
- Reuse `company.setup.manage` for the settings page and mutation; do not add a new permission family.
- Historical first-pass decision: a company had to configure an active member with `expense.confirm`.
  This was superseded by the approval-mode decision in the note above.
- Current preparation uses default `OWNER_SELF` when no policy row exists and still requires an eligible
  current approver in branch scope. `DESIGNATED_APPROVERS` requires a configured eligible approver.
- Current approval revalidates `expense.confirm`, membership and branch. Self-approval is permitted only
  under `OWNER_SELF` for roles covered by the shared owner/admin/manager exemption.
- Cash policy has two honest enforcement modes:
  - `REQUIRE_SEPARATE_PAYMENT_EVIDENCE`: at least one image/PDF linked as `expense.payment.evidence`, in addition to the existing supporting attachment.
  - `ALLOW_SUPPORTING_EVIDENCE_ONLY`: the existing supporting attachment is sufficient; finance remains responsible for review.
- New settings default to the stricter separate-payment-evidence mode. No policy record keeps
  `configured = false` but uses the `OWNER_SELF` runtime default; this does not weaken evidence rules.
- Company instructions may describe accepted evidence (for example payee acknowledgement, signed payment voucher, or recipient identity copy) but the application does not claim semantic verification of the uploaded file.
- Policy update is HIGH-risk audited. Existing immutable/issued certificates are not rewritten; pending preparation/approval is revalidated against the current policy.
- Payer and approver signature uploads are processed in-browser with the existing light-background removal, cropped to visible ink, previewed, and uploaded as the exact transparent PNG rendered into the certificate. Signing is disabled until this preview exists.
- The Revenue Department example certificate has payer/certifier and authorized-approver signature roles. A payee/recipient acknowledgement or signature belongs to separate payment-voucher/cash evidence and must not be mislabeled or inserted into either certificate role.

## Implementation

1. Add company policy storage and additive migration.
2. Add shared contracts plus GET/PATCH settings API.
3. Reuse membership/RBAC data to return eligible approver candidates.
4. Enforce policy in prepare and approve paths.
5. Add the settings page and settings landing-card entry.
6. Add transparent-signature processing and exact-artifact preview to payer/approver signing.
7. Add focused API/domain/web checks and run a two-user payer/approver smoke.

## Acceptance

- Owner/admin can select one or more eligible approvers and save a cash-evidence mode/instruction.
- Inactive users or users without `expense.confirm` cannot be saved as approvers.
- Ineligible approver, disallowed self-approval, stale membership/scope and strict
  cash-without-payment-evidence fail closed. Missing policy alone is not a blocker under `OWNER_SELF`.
- A configured, distinct payer and approver can complete prepare -> payer certify -> approve with real persisted users.
- Settings and approval mutations are tenant/permission/branch/audit bounded.
- Existing issued evidence remains immutable and readable.
- White/light signature backgrounds are removed, empty results are rejected, transparent edges are cropped, and the reviewed PNG is the file uploaded and placed into the payer/approver slot.
- A formerly configured approver who becomes inactive or loses `expense.confirm` is shown as invalid and removed from the editable draft so an owner can replace them without carrying a stale ID into the update.

## Verification

- Focused API policy/substitute/storage/retention suite: 31/31 passed; focused web policy/signature/image suite: 8/8 passed.
- Contracts build plus API/web typechecks and API build passed; webpack production web build passed.
- Fresh isolated database applied all 59 migrations and seed completed.
- Authenticated settings-page browser smoke loaded the saved policy, eligible owner, strict cash rule, Revenue Department boundary, saved successfully, and produced no console errors.
- Two persisted users completed prepare -> payer certify -> approve: `seed-room45-user-mind` and distinct `seed-local-owner`; final status `ISSUED`, one supporting file, one payment-evidence file, and two embedded PNG signatures.
- The first real PostgreSQL smoke exposed order-dependent JSON snapshot hashing; canonical recursive key sorting plus regression coverage fixed the `jsonb` round-trip before the passing rerun.
