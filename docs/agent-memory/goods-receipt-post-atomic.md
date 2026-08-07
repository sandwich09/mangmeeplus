# Agent Memory: goods-receipt-post-atomic

Status: Done. Landed on `develop` by the void session at the owner's
request as `7206bdbd` (fix), `9c2a46fa` (test), `f22653c3` (docs). Reviewed by
that session; the reservation-cancel question it raised is answered under
Decisions.

Owner: claude/clever-feistel-bb12f8

Scope: `PostGoodsReceiptUseCase` and its repository seam. Duplicate movement
number on same-product/location receipt lines, plus non-atomic posting.

## Decisions

- **Duplicate movement number.** `CreateMovementUseCase.reserveMovementNumber`
  keys on `${requestId}:${productId}:${locationId}:${movementType}`, and
  `PrismaDocumentSequenceRepository.reserveNumber` replays an existing
  idempotency key. Two STOCK lines on one receipt for the same product and
  location therefore got the same `movementNumber`, and the second insert hit
  `StockMovement @@unique([companyId, movementNumber])`. The post now reserves
  one number per receipt line keyed `gr:${receiptId}:${lineId}` — stable across
  a retry, distinct per line.

- **Atomicity via the repository, not `executeMany`.** The task asked for
  `CreateMovementUseCase.executeMany(ctx, cmds[])`, described as already added
  by the goods-receipt void fix. It does not exist — on any branch. The void fix
  (`b44b22f8`, PR #48) deliberately did not route
  through `CreateMovementUseCase`: doing so 403s an actor holding the receipt
  permission but not `inventory.movement.create`, and loses atomicity. Post has
  the same two problems, and `executeMany` would only have made the movements
  atomic with each other — the purchase-order roll-forward and the status flip
  would still have been separate transactions, which is the half that actually
  left stock added against an unposted receipt.

  New `PrismaProcurementRepository.postGoodsReceiptWithInventory` does the CAS
  `DRAFT -> POSTED` claim, the `STOCK_IN` movement and line pointer per stock
  line, and the PO `receivedQuantity` roll-forward in one Serializable
  transaction — the mirror of `voidGoodsReceiptTrueReversal`.

- **Validation kept.** `CreateMovementUseCase.assertStockTargets` exposes the
  existing `assertActiveStockTarget` check without the write, so archived /
  non-stockable products, archived locations, and out-of-branch-scope locations
  are still rejected. The transaction re-reads lines, so a stock line that
  appeared after that check has no reserved number and fails the post closed
  with `goods_receipt_changed`.

- **Roll-forward covers every line**, service lines included, because the void
  rollback mirrors it line for line. `increment` keeps it in the column Decimal.

- `postingStatus` on post moves `pending` -> `posted`: the inventory write is no
  longer deferred. Nothing reads goods-receipt `postingStatus` but the mapper.

- The receipt poster no longer needs `inventory.movement.create`. Previously a
  poster without it got a 403 *after* the status claim and number commit.

- **No cancel path for the per-line reservations, deliberately.** Raised in
  review: a throwing post leaves them RESERVED, where `VoidVendorBillUseCase`
  cancels in a catch. Adding the cancel here would be a regression, because the
  two designs are coupled to their key shape:

  - `reserveNumber` matches on `idempotencyKey` alone and returns the row
    whatever its status; `commitNumber` throws `Only RESERVED document numbers
    can be committed` on anything else.
  - So with the deterministic `gr:${id}:${lineId}` key, cancelling on failure
    hands the retry that CANCELLED row. The movements get written with its
    number inside the transaction, and the commit — fired with `void` — then
    throws as an unhandled rejection, leaving a live movement carrying a
    cancelled number.
  - Leaving it RESERVED means the retry reuses and commits the same row, so a
    post that eventually succeeds leaks nothing, and
    `@@unique([companyId, documentType, idempotencyKey])` caps the residue at
    one row per receipt line even if it never retries.
  - Vendor-bill void can cancel because its key carries `Date.now()`, which
    trades a burnt number per attempt for that freedom. Posting prefers stable
    movement numbers across retries.

  The pre-existing `post:${id}` receipt-number reservation has the same shape,
  so this is consistent rather than a new exception. Reasoning is recorded in
  `reserveMovementNumber` so it does not get "fixed" later.

## Open questions

None blocking.

## Artifacts

- `apps/api/src/modules/procurement/application/use-cases/goods-receipt.use-case.ts`
- `apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts`
  (adds `postGoodsReceiptWithInventory`; deletes `postGoodsReceipt`,
  `updateGoodsReceiptLineMovement`, `updatePurchaseOrderLineReceived`, all now
  dead)
- `apps/api/src/modules/inventory/application/use-cases/create-movement.use-case.ts`
- `apps/api/src/modules/procurement/application/use-cases/post-goods-receipt-atomic.use-case.spec.ts`
  (registered in the `apps/api` `test` script file list)
- `e2e/procurement.spec.ts` — PROC-04. Goods-receipt posting had no e2e
  coverage at all before this; PROC-01..03 stop at issuing a purchase order,
  and the only PO line they build is a SERVICE line, so no inventory path was
  ever exercised. `createPurchaseOrder` now takes its lines as a parameter.

## Verification

- New unit spec 5/5. Both guards proven load-bearing: reverting the reservation
  key to product+location fails the duplicate-number test; removing the
  `Object.hasOwn` line-set check fails the fail-closed test.
- `apps/api` full suite 2171/2171, `tsc --noEmit` 0 errors, after symlinking
  `node_modules` and the generated Prisma client into the worktree.
- Live, against the real HTTP API and the local database (swc build, server on
  :3199, seeded company/product/location): supplier -> PO with two STOCK lines
  -> approve -> issue -> receipt with two STOCK lines sharing product and
  location -> post. Movement numbers `MOV-202607-00001` and `-00002` (distinct),
  receipt `GR-202607-00001` POSTED with `postingStatus` `posted`, both line
  pointers set, PO lines rolled forward 4 and 6, on-hand +10 exactly, repost
  rejected 400 with no extra movements and no double count.
- PROC-04 e2e passes against that stack, and fails on the reverted key — there
  it surfaces as a NULL movementNumber rather than a duplicate, because the two
  reservations race inside `Promise.all` and one loses the `idempotencyKey`
  unique constraint, which `reserveMovementNumber` swallows to null. Same bug,
  second symptom. PROC-01..03 still pass after the helper change.
- Nest DI cannot be booted under `tsx`: esbuild does not emit
  `design:paramtypes`, so every constructor injection resolves undefined. The
  app builds with swc. Drive the built `dist` over HTTP instead. Note the
  server binds IPv4 `127.0.0.1` — `localhost` resolving to `::1` gives a silent
  connection refusal.

### Playwright evidence (`npm test` does not run it)

Flagged in review: `npm test` runs only the node test list, so the
`e2e/procurement.spec.ts` changes went onto `develop` unexecuted by the
merging session. They were executed here, twice — once on the pre-merge rebase
and once on the merged tip `abf30907`, both against a real stack (swc build,
API on :3199, Playwright's own web server):

    npx playwright test e2e/procurement.spec.ts    # 4 passed

PROC-01..03 pass unchanged after `createPurchaseOrder` grew its lines
parameter, and PROC-04 passes. PROC-04 was also confirmed to fail on a
deliberately reverted reservation key, so it is a real guard and not a test
that passes regardless.

Not from this change, but found in the same session: `e2e/inventory.spec.ts`
fails 4 of 11 on `develop` — INV-01 (two nav links match
`/สินค้า|Products/`, strict-mode violation), INV-03 (product-detail heading),
INV-06 (save toast), INV-07 (missing `select`). All are browser assertions
against `apps/web`, which this change does not touch at all; they look like UI
drift against stale selectors. The A/B isolation run was not done, so
"pre-existing" is inference from the file set, not measurement.

### Post -> void round trip, on the merged tip

The check that could not be run until both halves were on one branch. Against
`abf30907`, same live stack:

- post: receipt POSTED, movement numbers `MOV-202607-00012` / `-00013`
  (distinct), on-hand +10, PO lines rolled forward `[4, 6]`
- void: receipt VOIDED, one reversing OUT movement per forward movement,
  on-hand back to the exact baseline (134 -> 144 -> 134), PO lines back to
  `[0, 0]`, re-void rejected 400 with stock unchanged

So posting adds exactly what voiding takes back. Before the merge this same
script showed the void returning 201 while on-hand stayed at +10, which was the
pre-`b44b22f8` gap; it is closed.

Also on that tip: `tsc --noEmit` 0 errors and the node suite green. A first
`tsc` run there reported `businessCategory does not exist` — that was a stale
generated Prisma client symlinked in from the main checkout, not a real error.
The field is in the schema; regenerating the client into the worktree cleared
it. Symlink the client across trees and it will lie to you whenever the schema
has moved.

## Next

- `e2e/inventory.spec.ts` is 4-of-11 red on `develop` (details above).
  Unrelated to this change, but it is failing on the integration branch now and
  nobody owns it.
- Merge history, kept because the same shapes recur:
  - `claude/silly-rubin-fc1105` (`f01395a9`) rewrote
    `updatePurchaseOrderLineReceived`, deleted here; its `increment` semantics
    are preserved inside the transaction.
  - `b44b22f8` (PR #48) edits the same two files for the void side, in
    different regions — `VoidGoodsReceiptUseCase` and
    `voidGoodsReceiptTrueReversal`. Forward movements still carry
    `referenceType: 'goods_receipt'` / `referenceId`, which is how that void
    finds them.
  - The `test` script line in `apps/api/package.json` will conflict: PR #48
    adds `--test-reporter=dot` and its own spec registrations there, and it hit
    that conflict on three rebases. Keep **both** sides' spec registrations.
- Not covered: receipts posted before this fix may hold PO quantities rolled
  forward by a post whose movements failed; no heal written.
