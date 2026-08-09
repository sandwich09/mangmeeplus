# MangmeePlus — Operator identity and rights-intake evidence register

Status: **RELEASE BLOCKED — evidence required**
Reviewed: 2026-08-09 (Asia/Bangkok)
Public surfaces: `/privacy`, `/terms`, `/data-deletion`, immutable legal releases

This register separates facts visible in source code from facts independently proven for production.
Never mark an item `VERIFIED` from a developer assertion, a third-party company directory, DNS alone,
or a screenshot without its source, date and reviewer.

## Status vocabulary

- `VERIFIED`: primary evidence was checked and its reference/hash is recorded below.
- `OBTAIN`: evidence must be obtained from the named authoritative owner.
- `DECIDE`: management/legal decision must be signed and recorded.
- `NOT APPLICABLE`: reviewer recorded why the item does not apply.

## Operator identity

| Fact | Source-code value | Status | Required evidence before VERIFIED |
|---|---|---:|---|
| Legal name | บริษัท มั่งมียั่งยืน จำกัด | OBTAIN | Current DBD e-Certificate; RefNo/QR lookup result; digital-signature validation; independent reviewer |
| Registration number | 0105569135722 | OBTAIN | Same DBD package; a checksum-valid 13-digit number is not proof |
| Juristic status | Not published as a verified fact | OBTAIN | Current DBD status from the verified certificate/service |
| Registered head office | Not published as a verified fact | OBTAIN | Current DBD certificate and verification result |
| Contact address | 123/219 หมู่ที่ 11 แขวงบางขุนเทียน เขตจอมทอง กรุงเทพมหานคร 10150 | DECIDE | Management confirmation that correspondence can be received; do not relabel as registered address |
| Domain/operator linkage | mangmeeplus.com | OBTAIN | Registrar/organization-admin evidence or corporate authorization linking the domain/service to the entity |

Authoritative starting points:

- DBD e-Service: <https://ebiz.dbd.go.th/eservice-web/index.xhtml>
- DBD RefNo verification: <https://ebiz.dbd.go.th/eservice-inquiry/index.xhtml>
- DBD home/DataWarehouse entry point: <https://www.dbd.go.th/th>

Third-party directories may be corroborating leads only and must not be recorded as official DBD proof.
Keep the certificate/director/signing-authority material in restricted compliance storage, not public git.

## Rights and support mailbox

Public notices currently use one intake address: `contact@mangmeeplus.com`.

| Control | Status | Evidence required |
|---|---:|---|
| Mailbox or alias exists and accepts external mail | OBTAIN | Google Workspace admin export plus inbound test from an external domain |
| Primary and backup operators | DECIDE | Named owner, backup, on-call/escalation record and least-privilege group membership |
| Request acknowledgement and case creation | OBTAIN | Rehearsal showing received mail, acknowledgement, durable case ID and timestamps |
| Deadline/escalation monitoring | OBTAIN | Queue/dashboard evidence for 30-day and 90-day thresholds and missed-deadline escalation |
| Reply/completion delivery | OBTAIN | Rehearsal showing verified recipient, approved response and delivery evidence |
| Mailbox security | OBTAIN | MFA/admin access evidence, retention/access settings, Google DKIM verification |
| Domain anti-spoofing | OBTAIN | DMARC record/reporting rollout; policy tightened after monitored validation |
| Application outbound email | OBTAIN | A production-capable provider adapter and end-to-end delivery test; current SES path is not implemented |

DNS/MX/SPF can show routing capability but do not prove that a mailbox exists or is monitored.
Until the register is complete, public email copy is a declared release gate, not operational evidence.

## Evidence manifest template

Complete one row per reviewed artifact. Do not paste secrets or raw identity documents here.

| Evidence ID | Artifact type | Restricted reference | SHA-256 | Issued/captured at | Verified at | Reviewer | Result/expiry |
|---|---|---|---|---|---|---|---|
| _pending_ | DBD e-Certificate | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| _pending_ | DBD RefNo/signature verification | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| _pending_ | Google Workspace mailbox evidence | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| _pending_ | External inbound/reply rehearsal | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| _pending_ | Production public-route/hash smoke | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

## Release decision

The release approver must confirm all of the following in a signed change record:

1. operator name/number/status and registered office were verified from current DBD primary evidence;
2. public copy distinguishes registered office from contact address;
3. the published mailbox has a named primary/backup and a rehearsed durable-case workflow;
4. production `/privacy`, `/terms`, `/data-deletion` and immutable release bytes match the approved release;
5. DPO wording matches the signed DPO necessity/appointment decision; and
6. Thai privacy/accounting counsel approved the final public facts and response templates.

Without that record, legal acceptance may be tested locally but must not be treated as production-ready proof.
