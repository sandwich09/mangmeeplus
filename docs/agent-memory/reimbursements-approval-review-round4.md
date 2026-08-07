# Agent Memory: reimbursements-approval-review-round4

Status: planned — handoff written, implementation delegated to Codex
Owner: main thread (design + verification), Codex (implementation)
Scope: `apps/web` only. `การเบิกจ่ายและอนุมัติ` — stale-approval review dialog, detail popup
re-centred, table header alignment, search field.

Follows rounds 1–3. Their invariants still bind.

## Requests

1. Approving from คิวอนุมัติ can fail with `⚠ คำขอถูกแก้ไขหลังส่งอนุมัติ …`. Instead of a dead-end
   banner, pop up the claim for review with **the changed parts highlighted**, then let the approver
   decide.
2. The data popup should open **centred**, and its close control should be an **✕ icon**.
   *(User confirmed 2026-07-28: this covers **both** the new review dialog **and** the existing detail
   drawer — the drawer moves from the right edge to the centre.)*
3. Table **column headers centred**.
4. Search field: **magnifier icon on the right**, and **+20% wider**.

## How the staleness guard actually works (verified in the API)

`reimbursement-approval.use-case.ts:20` hashes exactly:

```
amount, currency, categoryKey, incurredDate, reason, primaryAttachmentId, lines
```

and throws `ConflictException('stale_approval_snapshot')` (HTTP 409) when the frozen hash no longer
matches. The raw message on the wire is the bare code; `err()` in the page translates it through
`ERROR_CODE_LABELS`, so **detection must read the untranslated `e.message`**.

### What the diff can honestly show

The approval-queue row (`toRequestSummary`) carries `reason`, `amount`, `currency`,
`categoryLabelSnapshot`/`categoryKey`, `lineCount` — four of the seven hashed inputs plus a line count.
It carries **no line rows**. So:

- **Detectable and highlightable:** เหตุผล, จำนวนเงิน, สกุลเงิน, หมวด, จำนวนรายการ.
- **Not detectable from the queue row:** an edit confined to a line's text, `incurredDate`, or the
  attachment. The hash changes but every comparable field looks identical.

**D1 — therefore the dialog always renders the current line breakdown**, not just the diff, and when no
field difference can be identified it says so explicitly rather than showing an empty "nothing changed"
table (which would be actively misleading on a safety-critical screen). Fetching a richer "before"
would require an API change; out of scope.

## Decisions

- **D2 — the detail drawer becomes a shared `Modal`.** `Modal.tsx` already centres
  (`flex items-center justify-center`), portals to `document.body` at `z-[99999]`, ships the **✕ close
  button**, traps focus, handles Escape, and has a `footer` slot. Converting therefore *deletes* code:
  the bespoke backdrop, the `top-[68px]` offset, the sticky header/footer, and the hub's document-level
  Escape effect all go away. Sibling modals keep working because React portals propagate events along
  the React tree, and `claimForm` / `signFor` / `payFor` / `rejecting` are siblings of the drawer, not
  children — so each owns its own Escape and the "topmost layer" rule is preserved structurally
  instead of by manual bookkeeping.
- **D3 — `size="xl"`** (`max-w-[min(1180px,96vw)]`), because the body holds the lines table and the
  four signature blocks. The old drawer was `max-w-3xl` (768px), which is too narrow once centred.
- **D4 — recovery approves with the *fresh* hash.** The dialog's confirm calls
  `approveReimbursement(companyId, id, undefined, freshDetail.approvalSnapshotHash)`. This keeps the
  server's guard fully intact: the approver is explicitly acknowledging the new data rather than the
  client bypassing the check. No API change, same endpoint, same shape.
- **D5 — centred headers are applied as asked**, with values keeping their own alignment (numbers
  right, text left). Noted: header-centred/value-aligned is unusual typographically; easy to revert to
  per-column alignment if it reads worse in practice.

## Invariants (carried from rounds 1–3)

No API call, payload, permission gate, or action-visibility conditional may change behaviour. Search
and paging stay pure `useMemo` projections; no `load()` dependency array gains an entry; KPI cards keep
reading unfiltered `data`. The new dialog adds one recovery path and must not alter the success path.

## Artifacts

- Implementation spec: `docs/agent-memory/reimbursements-approval-review-round4.handoff.md`
- Codex report (expected): `docs/agent-memory/reimbursements-approval-review-round4.results.md`
