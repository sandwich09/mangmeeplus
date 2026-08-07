# Agent Memory: reimbursements-ui-fixes-round2

Status: Prisma defect fixed and verified; UI items 2–4 implemented and verified — one interaction
(collapse a line, then submit) still needs a click-test, see the results file
Owner: main thread (diagnosis + verification), Codex (UI implementation)
Scope: follow-up to `docs/agent-memory/reimbursements-ui-redesign.md` after the user's first
click-through of `การเบิกจ่ายและอนุมัติ`.

## 1. `⚠ Internal server error` — root cause found and FIXED (not a UI bug)

**Symptom.** The page showed `Internal server error` on load, and the same banner appeared inside the
`สรุปคำขอ` card of the create form (that card renders the shared `error` state, so it was the *same*
list error surfacing there — the create call itself was never reached).

**Root cause.** The generated Prisma client was **stale**. `prisma/schema.prisma:47` declares
`lines ReimbursementLine[]` on `ReimbursementRequest` (migration `20260726120000_add_reimbursement_line`,
table present with 9 rows), but `apps/api/src/generated/prisma` had been generated *before* that
relation existed. So `listRequests`' `include: { _count: { select: { lines: true } } }`
(`prisma-reimbursement.repository.ts:236`) failed client-side validation on every call:

```
PrismaClientValidationError:
Unknown field `lines` for select statement on model `ReimbursementRequestCountOutputType`.
Available options are marked with ?:  approvalSteps?, payments?, duplicateCandidates?
```

Captured from the API's own request log (`level:50`, `path:/v1/companies/seed-local-company/reimbursements`).

This is **environment/build drift, not a defect in the redesign** — the redesign changed no API call,
and the identical query existed before it (verified by diffing the API call inventory in round 1).

**Why only this tab.** `ReimbursementPolicy` has no `lines` relation, so `getReimbursementPolicy`
kept working — which is why the `ตั้งค่านโยบาย` tab rendered real data while the queues 500'd.

**Fix applied (main thread):**

```bash
cd apps/api && corepack pnpm exec prisma generate   # → Client 7.8.0 regenerated
corepack pnpm --filter @watchdog-bms/api build      # swc → dist
# restarted the API process on the fresh dist, same env (local-env.sh)
```

Verified: `ReimbursementRequestCountOutputType` now contains `lines: number` and `claimSignatures:
number`; the dist copy the API runs contains the updated datamodel; API restarted clean and answers
`401` (auth) rather than `500` on the previously failing route.

**Environment notes worth recording (not changed):**
- Root `.env` has `DATABASE_URL=…@localhost:15433`, but `docker-postgres-1` publishes **15432**
  (`.env.example` is the correct one). The running API had `…@localhost:5432` injected from a
  scratch `local-env.sh`, pointing at a **native** Postgres that holds the real seed data.
  Three different ports in play — worth reconciling, but it is not what caused the 500.
- `docker-postgres-1` was stopped; started during diagnosis. Redis and MinIO were already up.

## 2–4. UI items handed to Codex

| # | Item | Decision |
|---|---|---|
| 2 | `ตั้งค่านโยบาย` tab must be visible only to admin + company owner | Gate on **permission AND role** (`reimbursement.policy.manage` *and* `OWNER`/`ADMIN`), matching the house pattern at `CustomersPrototypePage.tsx:458`. Requires threading `roles` into the hub. |
| 3 | `รายการที่ขอเบิก` cards must collapse/expand | Per-line collapse with a one-line summary when closed, plus expand/collapse-all. Panels stay **mounted** (`hidden`), never unmounted. |
| 4 | `ตั้งค่านโยบาย` page does not fill the screen, looks unprofessional | Replace `max-w-3xl` single column with the two-column + sticky-summary layout already used by the create form, and let the setting cards go 2-up on wide screens. |

### Decisions and their reasons

- **D1 — role gate is UI-only; the server still enforces the permission.** `reimbursement.policy.manage`
  is granted by role template to OWNER and ADMIN, *and* by the assignable capability pack
  `pack.reimbursement.policy` (`capability-pack.registry.ts:268`). So a custom role can legitimately hold
  the permission. Restricting the tab by role is a **product choice by the user**, applied in the UI
  only — no API/permission change, so nothing that already works server-side breaks.
  **Flagged:** if the intent is that *nobody* outside OWNER/ADMIN may manage policy, the real fix is
  retiring `pack.reimbursement.policy` in the API. That is a bigger, separate decision — not done here.
- **D2 — collapsed line panels must stay mounted.** Same lesson as the expenses stepper: unmounting
  loses in-progress state. `hidden` keeps values and native `required` intact.
- **D3 — expand-all before submit.** A `required` input inside a `display:none` ancestor makes the
  browser throw *"An invalid form control … is not focusable"* and silently blocks submit. The submit
  button therefore expands every line on `onClick`, which runs **before** constraint validation.
  This is the whole reason the flow cannot simply hide collapsed lines.

## Verification

Round-2 verification is recorded in `docs/agent-memory/reimbursements-ui-fixes-round2.results.md`.

## Next

1. User reloads `การเบิกจ่าย` to confirm the 500 is gone (main-thread fix, already applied).
2. Codex implements items 2–4 against the handoff.
3. Main thread re-verifies: typecheck, tests, flow parity, and the round-1 invariants still hold.
