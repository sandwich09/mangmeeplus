# Reimbursement Upgrade Write-Quiesce Spec

Status: Approved for implementation as a U5 production-safety amendment

Owner: Product owner / Release engineering

Related:

- `docs/specs/feature-entitlement-decoupling-spec.md` FR-H
- `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`
- `docs/plans/reimbursement-upgrade-write-quiesce-plan.md`

## 1. Problem and outcome

The production version of reimbursement creates a request from scalar header fields, while the
U5 candidate accepts a required `lines[]` contract. During an ordinary mixed-revision canary:

- old web to new API can fail validation; and
- new web to old API can discard line detail or create a header-only request.

Feature entitlement and database compatibility do not make those HTTP contracts compatible.
Production promotion must therefore pause reimbursement writes for the short upgrade window while
keeping all reimbursement reads available. Users must not migrate data, re-enter saved data, select
a compatibility version, or understand the deployment.

The system deliberately does **not** add a long-lived dual-payload adapter. The smallest safe
contract is a controller-first write quiesce, one forward compatibility migration, an atomic final
writer, and a machine-proved unquiesce after only the final compatible revision remains.

## 2. User contract

1. Reimbursement list, detail, queues, summaries, policy reads, exports and existing evidence remain
   readable during the window.
2. Every reimbursement mutation, including policy, draft, submit/cancel, approval/rejection,
   finance/payment, claim-form generation/signing/upload linking and receipt linking, is refused
   before DTO validation or domain mutation.
3. The refusal is HTTP `503`, stable code `reimbursement_upgrade_in_progress`, header
   `Retry-After: 60`, and a friendly Thai message explaining that the data on screen remains and the
   user can try the same action again in about one minute.
4. The web maps the stable code centrally. It does not clear a form/dialog after this refusal and
   never auto-retries a financial mutation.
5. The maintenance window is targeted at 30 minutes or less. A longer window is an incident and is
   surfaced to the owner; it never silently enables writes.

## 3. Runtime contract

`REIMBURSEMENT_WRITE_QUIESCE` is an API boolean configuration key with default `false`. Invalid
values fail configuration validation. Only the production release controller sets it during this
transition; it is not a tenant, partner, permission or commercial-feature switch.

A reusable reimbursement write-quiesce guard is attached to both reimbursement HTTP controllers.
Nest guards execute before parameter/body pipes, so both legacy and candidate payloads receive the
same `503` while quiesced. `GET`, `HEAD` and `OPTIONS` pass; every other method fails closed.
Authentication, tenant and permission guards remain in force, so the quiesce response does not
create a new anonymous route or bypass authorization.

The guard covers every current reimbursement HTTP mutation surface. A future worker, LINE, AI or
internal mutation surface must reuse the same gate before it may ship. Current LINE/AI reimbursement
tools are read-only. Generic attachment upload may complete before a later reimbursement link is
refused; existing orphan retention handles that file and no reimbursement truth changes.

## 4. Data compatibility contract

The candidate uses a new forward-only, idempotent migration; it never edits bytes of an already
applied migration. It must:

- backfill a deterministic line only for a legacy request that has no line;
- be idempotent and preserve requests that already have one or more lines;
- add a database defense for a legacy header-only insert during the bounded transition; and
- leave all existing customer values and identifiers intact.

The final repository writer creates/updates the request and its lines atomically. Durable invariants
prove every request has at least one same-company line and that the header amount equals the current
sum of its lines. Header `updatedAt` is not compared to historical line timestamps because valid
later header edits may change it.

Production's legacy build froze `PENDING_APPROVAL` snapshots with the header-only v1 algorithm,
whereas the final build freezes every line in the v2 hash. Backfilling the deterministic line must
not make an untouched historical request look stale or force the employee to cancel and submit it
again. The final verifier therefore accepts a stored v1 hash only when both predicates hold:

- the stored value exactly equals a recomputed header-only v1 hash; and
- the request has exactly one migration fallback line whose tenant, request, number, date,
  description, category/label, amount, evidence links and optional purpose exactly mirror the
  reviewed header-to-line mapping.

Every new submission uses v2. A changed/multi-line/otherwise unrecognized request with a v1 hash
still fails `stale_approval_snapshot`; no NULLing, blanket bypass, silent re-signing or customer
repair form is allowed. The private production A5 gates classify every pending request as v2-valid,
exact-v1-compatible, missing-hash legacy debt or invalid. PRE predicts the exact deterministic
fallback from the legacy header while the line relation is reviewed absent; POST reads actual lines
through the refreshed least-privilege grant. Every stage blocks on any missing/invalid shape.
Historical v1 hashes remain as the immutable value actually signed rather than being overwritten to
imply that the approver saw a v2 document.

Duplicate scoring before submit is read-only. A successful submit inserts its duplicate-candidate
rows, creates the approval step, reserves and commits the canonical reimbursement document number,
and performs the final request compare-and-set in one caller-owned Prisma transaction. There is no
fallback number. A failed or stale submit therefore leaves no candidate, approval step, reservation,
sequence increment or request transition; a retry receives the exact number that the failed attempt
would have used. Reserve/commit audit facts are emitted only after that transaction succeeds.

Draft edit and submit share one request-scoped transaction lock. A draft update replaces header and
lines under a `status=DRAFT` plus observed-`updatedAt` compare-and-set. Submit performs its final
same compare-and-set and creates the approval step plus request transition in one transaction. If an
edit and submit overlap, exactly one wins; the loser receives stable code
`reimbursement_draft_changed`, no partial lines/approval transition, and a Thai instruction to reload
and review. Before its final transition, submit takes sorted transaction-scoped locks for every
receipt attachment and linked expense and rechecks them against live claims. Two different drafts
submitting the same evidence therefore have exactly one winner; the loser remains a complete draft
and receives the existing evidence-already-claimed error. UI timing and the earlier advisory lookup
are never the concurrency control.

The pending approval decision is included in this upgrade boundary because approval both verifies
the migrated snapshot and materializes claim-born expenses, while a separately committed rejection
could otherwise overwrite that result. Under the same request-scoped transaction lock, both paths
re-read and validate pending status, observed `updatedAt`, self-approval policy and both header/step
assignment; approval additionally validates the stored v2 or exact-compatible v1 snapshot.
Approval-step decision, one expense plus line/link writes for every currently unlinked claim line,
and the final request status compare-and-set then commit in one Prisma transaction. Rejection-step
decision and its final request compare-and-set likewise commit together. Concurrent approve versus
approve or approve versus reject has exactly one winner. Any failure, including the final request
transition, rolls back the step and, for approval, all expense/expense-line/attachment-link rows and
every reimbursement-line link. The mapper may prepare values outside the transaction, but the
locked approval accepts them only when their line-id set exactly equals the re-read unlinked line
set. Finance review and payment transitions remain outside this amendment and are not implicitly
declared race-safe.

No customer repair form, migration wizard, default-account prompt or data re-entry is allowed.

## 5. Production sequence

The sequence is fail-closed and exact-SHA/image bound:

1. **Bridge first.** Merge a protected-main, old-schema-compatible bridge containing only the
   config, guard, friendly error and deployment controls. Deploy `api-web` with quiesce `true`.
2. **Retire unguarded tasks.** Prove every active/serving api-web revision is the reviewed bridge,
   carries quiesce `true`, and every pre-bridge task is retired. Migration cannot start before this.
3. **Signed PRE.** Bind bridge source/image, service revision, active task set, flag readback and
   quiesce start time to the production evidence chain.
4. **Migrate.** The signed PRE private reader first classifies every live pending approval as v2,
   exact deterministic v1, missing or invalid; missing/invalid must both be zero. Apply only the
   exact reviewed migration manifest under the signed lock/statement budgets and run schema and
   reimbursement invariants before traffic changes. On the isolated, fully migrated PostgreSQL 18
   clone, run the required compatibility/race gate through its in-container `DATABASE_URL`.
   Missing/unreachable DB, any skipped case, migration/byte/invariant drift, an unrecognized live
   pending hash/line shape or race failure blocks progress.
5. **Final while closed.** Deploy the exact UAT-accepted final api-web image with quiesce `true`,
   then the compatible AI Gateway/workers wave. Prove health, exact digests and retirement of the
   bridge/older revisions.
6. **Unquiesce last.** Roll only api-web to the same final source/image with quiesce `false`. Re-prove
   one stable active final revision, health, invariants and no old task before recording the end time.
7. **Signed POST.** Record exact source/image/revisions, flag transitions, window duration, blocked
   request count when available, invariant hashes and rollback authority. This proves deployment
   safety only; it does not OPEN an entitlement route or WHT.

Any failure after step 1 leaves quiesce `true`. If schema has not changed, recovery may roll the
bridge back and unquiesce only after exact proof. If schema has changed, recovery keeps writes closed
until a compatible final/repaired build is stable; it never re-enables an incompatible old web/API
mix.

## 6. Security and evidence

- A repository/operator variable alone is not evidence. The controller reads the active ECS service
  revision and primary-container environment after each rollout.
- The bridge and final images, source SHAs, service revision ARNs, task sets, flag values, start/end
  timestamps and invariant/catalog hashes are canonical signed evidence under FR-H.
- A missing, duplicate, moving or unexpected service revision; an unguarded active task; a flag
  mismatch; or an expired evidence attempt blocks migration/unquiesce.
- Rollback may use only the exact reviewed compatible image and never changes tenant entitlements,
  route states, permissions or customer data.
- Logs and evidence contain no request body, receipt, employee name, tenant row or financial amount.

## 7. Acceptance criteria

1. With quiesce `true`, old-scalar and new-lines create/update payloads both return the same coded
   `503` before validation; all other reimbursement mutations and policy PUT do likewise.
2. Authorized reads remain successful; existing tenant/permission failures remain unchanged.
3. Web tests prove the Thai message is used and typed form/dialog state is retained after refusal.
4. With quiesce `false`, the final lines-only journey works and an old scalar payload is rejected
   rather than silently stored.
5. Real PostgreSQL tests prove deterministic zero/one/many-line handling, byte preservation for
   existing one/many-line rows, trigger defense, legacy/current writers, repeat application,
   transaction rollback and detection of line-less, amount and cross-company corruption.
6. Real PostgreSQL race tests prove edit-versus-submit has one winner; a stale submit leaves no
   candidate/approval/number and retry receives the exact unconsumed number; two requests submitting
   the same receipt have one winner and one intact draft.
7. UAT proves all four old/new web/API pairings are safe while closed, then proves the final
   unquiesced journey. Exact active revision/flag readback is attached.
8. Production migration cannot start before bridge-only/quiesced proof, and unquiesce cannot occur
   before final-only/post-invariant proof.
9. The production clone invokes the two explicit spec-reporter files in required mode against its
   isolated in-container DB and accepts exactly 2 suites / 13 tests / 13 pass / 0 skipped. Required
   mode without that DB fails; ordinary developer runs may skip only when required mode is absent.
10. No customer migration, data entry, entitlement flip, enforcement flip or WHT OPEN occurs.
11. A legacy pending approval with an exact deterministic fallback remains approvable without
    resubmission, while edits to any header/fallback field, extra lines or a forged legacy hash are
    rejected; all final-build submissions remain line-bound v2 snapshots.
12. Real PostgreSQL tests prove two concurrent approvals and approve-versus-reject each yield one
    complete decision only. Injected final-transition failures roll approval and rejection steps,
    request status and all approval materialization/link writes back, after which normal retry
    succeeds.
