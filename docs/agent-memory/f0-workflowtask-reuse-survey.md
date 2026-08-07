# F0 Survey: `WorkflowTask` Reuse As `WorkCardUserState`

Generated: 2026-07-31
Git HEAD: `ba91c102c49ab7964697a540a2f63d42a497aa6a`
Lane: S5 (WorkflowTask reuse survey), phase F0
Scope: SURVEY ONLY — no code changes, no design beyond a reuse verdict.
Drivers: `docs/plans/feature-entitlement-decoupling-plan.md:24`, `:163-174`; `docs/specs/feature-entitlement-decoupling-spec.md:452-453` (AC29-30).

---

## 1. `WorkflowTask` Prisma model

`apps/api/prisma/schema.prisma:5701-5729`.

| Field | Type | Note |
|---|---|---|
| `id` | `String @id @default(cuid())` | schema.prisma:5702 |
| `companyId` | `String` | :5703 — tenant key |
| `workflowRunId` | `String?` | :5704 — **nullable**, confirms plan's assumption |
| `workflowActionRunId` | `String?` | :5705 — nullable, no FK relation declared |
| `sourceModule` | `String?` | :5706 |
| `sourceType` | `String?` | :5707 |
| `sourceId` | `String?` | :5708 |
| `title` | `String` | :5709 |
| `description` | `String?` | :5710 |
| `assigneeUserId` | `String?` | :5711 — no FK to User |
| `assigneeRole` | `String?` | :5712 |
| `priority` | `WorkflowTaskPriority @default(NORMAL)` | :5713 |
| `status` | `WorkflowTaskStatus @default(OPEN)` | :5714 |
| `dueAt` | `DateTime?` | :5715 |
| `snoozedUntil` | `DateTime?` | :5716 |
| `completedByUserId` | `String?` | :5717 |
| `completedAt` | `DateTime?` | :5718 |
| `cancelReason` | `String?` | :5719 |
| `webDeepLink` | `String?` | :5720 — stored string, not computed |
| `createdAt` / `updatedAt` | `DateTime` | :5721-5722 |

**Enums.**
- `WorkflowTaskStatus` = `OPEN | SNOOZED | DONE | CANCELED` — `schema.prisma:5526-5531`. **The plan (`plan.md:24`) states `OPEN|SNOOZED|DONE` and omits `CANCELED`.** Contract mirrors 4 values: `packages/contracts/src/workflow.ts:35`.
- `WorkflowTaskPriority` = `LOW | NORMAL | HIGH | CRITICAL` — `schema.prisma:5519-5524`.

**Relations.** `company Company @relation(... onDelete: Cascade)` (:5723); `workflowRun WorkflowRun? @relation(...)` (:5724) — **nullable, no cascade**, so standalone (non-workflow) tasks are already representable. Back-reference `tasks WorkflowTask[]` on `WorkflowRun` (`schema.prisma:5663`). No relation is declared for `workflowActionRunId` or `assigneeUserId`.

**Uniqueness / indexes.** Three indexes, **all non-unique**, and **zero `@@unique` constraints of any kind**:
- `@@index([companyId, assigneeUserId, status])` — :5726
- `@@index([companyId, status, priority])` — :5727
- `@@index([companyId, sourceModule, sourceType, sourceId])` — :5728

Confirmed at DDL level — `apps/api/prisma/migrations/20260701074822_item16_workflow_automation/migration.sql:167` (CREATE TABLE), `:273`, `:276`, `:279` (three `CREATE INDEX`, no `CREATE UNIQUE INDEX`, no partial/`WHERE` index).

---

## 2. Writers (5 production application sites, 2 repository primitives, 0 delete sites)

Repository primitives — `apps/api/src/modules/workflow/infrastructure/prisma-workflow.repository.ts`:
- `createTask` :364-383 → `prisma.client.workflowTask.create` :379, always forces `status: 'OPEN'` :380.
- `updateTask` :415-418 → `workflowTask.update({ where: { id }, data })` :416. **`companyId` is accepted as an argument but never used in the `where` clause** — tenant scoping depends entirely on the caller having first read the row via `findTaskById`.
- **No delete/deleteMany site exists anywhere in `apps/api/src`** (verified by grep for `workflowTask.delete` / `deleteTask`). Rows disappear only via `Company` cascade (:5723).

| # | Writer | Trigger | Concurrency | Idempotency |
|---|---|---|---|---|
| W1 | `workflow-action-runner.use-case.ts:220-243` `createTask()` | `CREATE_WORKFLOW_TASK` (:147-148) and `CREATE_APPROVAL_REVIEW_REQUEST` (:150) action types fired by workflow rules | No transaction; plain create | `findTaskByActionRunId` check-then-create (:221-222) keyed on `workflowActionRunId` — **TOCTOU, no DB constraint backing it** |
| W2 | `workflow-action-runner.use-case.ts:328-343` `createDisabledFallbackTask()` | Safe fallback when an action provider is unimplemented | No transaction | Same check-then-create on `workflowActionRunId` (:329-330) |
| W3 | `workflow-task.use-case.ts:48-60` `SnoozeWorkflowTaskUseCase` | `POST .../tasks/:taskId/snooze` | **Read (:49) then write (:54), two round trips, no transaction, no CAS, no version** | None |
| W4 | `workflow-task.use-case.ts:67-80` `CompleteWorkflowTaskUseCase` | `POST .../tasks/:taskId/complete` | Same read-then-write race (:68, :74) | None |
| W5 | `workflow-task.use-case.ts:87-102` `CancelWorkflowTaskUseCase` | `POST .../tasks/:taskId/cancel` | Same read-then-write race (:88, :95) | None |
| (seed) | `apps/api/prisma/seed.ts:2205` | Dev/demo seed only | `upsert` on a hardcoded `id` | id-keyed |

Notes:
- The repo rule "no create→catch-P2002 inside `$transaction`" is **not currently violated** — there is no P2002 catch anywhere in these paths, because there is no unique constraint to violate. Any added idempotency must therefore use `upsert` (as `seed.ts:2205` already does), not create-then-catch.
- Retry behaviour: the action runner retries failed action runs with backoff (`workflow-action-runner.use-case.ts:104-112`, `computeNextAttemptAt` / `isRetryExhausted` :11). Because retries reuse the same `workflowActionRunId`, W1/W2 are duplicate-safe **for retries of the same action run**, but not across distinct action runs (see §4).
- Audit writes on W3/W4/W5 are fire-and-forget (`void this.audit.log(...)` at :55, :75, :96).

---

## 3. Readers (7 surfaces)

| # | Surface | Path / evidence | Permission |
|---|---|---|---|
| R1 | `GET /companies/:companyId/workflow/tasks` | `workflow-task.controller.ts:18-36` → `ListWorkflowTasksUseCase` (`workflow-task.use-case.ts:13-33`) → `repo.listTasks` (`prisma-workflow.repository.ts:395-413`) | `@RequirePermissions('workflow.task.read')` (:19) + re-check in use-case (:14). Scope narrowing: `OWNER/ADMIN/AUDITOR_READONLY` see all, everyone else is forced to own-user/own-role rows (`use-case.ts:7`, :16-24) |
| R2 | `findTaskById(companyId, id)` | `prisma-workflow.repository.ts:385-388` — company-scoped `findFirst`; used by W3/W4/W5 | Internal |
| R3 | `findTaskByActionRunId` | `prisma-workflow.repository.ts:390-393` | Internal (idempotency check) |
| R4 | Reports / daily brief | `report-source-adapters.ts:603-604` — two `ListWorkflowTasksUseCase.execute` calls with `scope:'all'`, `status:'OPEN'` and `status:'SNOOZED'`, `pageSize:100` | Inherits R1's use-case permission check |
| R5 | LINE AI tool `workflow.list_assigned_tasks` | `erp-workflow-tools.use-case.ts:79-99` | Explicit `workflow.task.read` guard (:85-87), `scope:'own'`, `status:'OPEN'` (:88); emits `permissionChecked: true` source refs |
| R6 | **Expense delete blocker** | `delete-expense.use-case.ts:66-76` — direct `tx.workflowTask.findFirst({ where: { companyId, OR: [ {sourceType:'expense_record', sourceId}, {workflowRun: {...}} ] } })`; contributes the `WORKFLOW_TASK` blocker (:26, :97) | Inside the expense-delete transaction |
| R7 | Web UI `TasksTab` | `apps/web/src/features/workflow/WorkflowPages.tsx:424-451` (tab at :88); client calls `workflow.api.ts:57-68` | Server-enforced |

**Deep-linking to sources.** Two mechanisms, both stored at create time: `webDeepLink` (`schema.prisma:5720`, populated from `resolveDeepLink(...)` at `workflow-action-runner.use-case.ts:229` and passed at :241) and the `sourceModule/sourceType/sourceId` triple (:5706-5708, set at :234-236). R5 synthesises its own `webPath` to `/companies/:companyId/workflow` rather than using `webDeepLink` (`erp-workflow-tools.use-case.ts:96`).

**Permission registry.** `workflow.task.read` (LOW) and `workflow.task.work` (MEDIUM, "Snooze/complete/cancel workflow tasks") — `apps/api/src/modules/auth/permission-registry.ts:324-325`; granted to many roles (:533, :588, :621, :640, :709, :756, :772, :785).

---

## 4. Identity: is there a deterministic key today?

**No.** Evidence:

1. **No unique constraint exists at all** — `schema.prisma:5726-5728` are three plain `@@index`; migration DDL confirms three `CREATE INDEX` and no unique/partial index (`migration.sql:273`, `:276`, `:279`).
2. `(sourceModule, sourceType, sourceId)` is **indexed but not unique** (`schema.prisma:5728`) and all three columns are **nullable** (:5706-5708). W2 (`createDisabledFallbackTask`) is the only writer that could omit them, but nothing enforces their presence.
3. The only de-duplication in production is `findTaskByActionRunId` (`workflow-action-runner.use-case.ts:221`, `:329`) — keyed on `workflowActionRunId`, i.e. **on the workflow execution, not on the business issue**. Two different rule/action runs touching the same `(sourceModule, sourceType, sourceId)` each create their own task. Both `create_reorder_task` and `create_escalation_task` style rules exist in the same catalog (`workflow-template-catalog.ts:77`, `:129`, `:230`, `:279`, `:296`, `:330`, `:347`), so multi-rule fan-out onto one source is a real configuration, not hypothetical.
4. There is no `businessIssueKey`-like column in the field list (`schema.prisma:5702-5722`).

**Conclusion: duplicates per business issue can and will exist.** There is no existing column or constraint that can serve as a `businessIssueKey → task` lookup.

Repo precedent for the shape that would work: `JournalEntry` uses `@@unique([companyId, sourceType, sourceId, entryType])` (`schema.prisma:2260`, referenced in a comment at `:978`) — deterministic source identity is an established pattern in this schema.

---

## 5. Semantics gaps vs work-card needs

**5.1 Assignment.** Storage exists (`assigneeUserId` :5711, `assigneeRole` :5712) and read paths honour both (`use-case.ts:16-24`, `repository.ts:396-400`, `assertCanWork` :36-42). **But there is no assignment write path anywhere** — grep across `apps/api/src`, `apps/web/src`, `packages` shows `assigneeUserId` is only ever *set* inside `createTask` (`repository.ts:373`, `action-runner:238` sets `assigneeRole` only from rule config; `seed.ts` sets `assigneeUserId` directly). The controller exposes only snooze/complete/cancel (`workflow-task.controller.ts:38-60`). Delegating a card to an accountant (plan §5.1.3) has no existing endpoint to reuse.

Positive: assignment today grants no access — `assertCanWork` (:36-42) *restricts* who may act; permissions come from `ctx.permissions`, never from the task row. This matches the spec rule "assignment grants no access".

**5.2 Acknowledgement.** **No representation exists.** No field in `schema.prisma:5702-5722` expresses "seen/acknowledged". `completedAt`/`completedByUserId` (:5717-5718) are written only by the DONE path (`use-case.ts:74`) and mean completion, not acknowledgement. Notification dedupe keyed on acknowledgement (plan §5.1.8) has nothing to read.

**5.3 Snooze.** Field exists (`snoozedUntil` :5716) and a snooze endpoint exists (`controller.ts:38-44` → `use-case.ts:48-60`). Two gaps:
- **No legal-due-date bound.** `use-case.ts:54` writes `new Date(snoozedUntil)` straight from the request body (`controller.ts:42-43`) with no comparison against `dueAt`. Nothing prevents snoozing past a legal deadline — directly contrary to plan §5.1.8 ("no snooze beyond a legal due date"). `dueAt` is available on the row and would make the bound implementable in the application layer.
- **Snooze never expires.** No sweeper un-snoozes tasks (no `SNOOZED` handling in `apps/api/src/workers` or any `workflow-*.use-case.ts` besides the snooze writer), and the mapper returns the raw stored status without computing an effective one (`workflow.mapper.ts:130-147`). A SNOOZED task therefore leaves the `status:'OPEN'` list permanently. Contrast the CRM sibling, which *does* compute an effective status: `effectiveFollowUpStatus` used at `crm-follow-up.use-case.ts:225` with a transition table at `crm.logic.ts:148-150` (`SNOOZED: ['OPEN','DONE','CANCELED']`). Work cards need the card to reappear when the snooze lapses.

**5.4 DONE semantics — does anything treat task DONE as completing business work?**

**No — and the codebase is explicit about it.** `CompleteWorkflowTaskUseCase` carries the comment "Completion only closes the workflow task, not the source business record" (`use-case.ts:73`); the endpoint summary says the same (`controller.ts:49`); approval-review tasks are created with the description "Completing this task does not approve the source record." (`action-runner:237`). No writer in the DONE path touches any domain table (`use-case.ts:74` writes only task columns).

**The violation runs the other way.** The spec requires that task DONE "may only reflect an already-terminal domain result" (`spec.md:453`, `plan.md` §5.1.2). Today `complete` is a **user-asserted** status flip: any caller with `workflow.task.work` who passes `assertCanWork` can set DONE with **no check that the domain issue is terminal** (`use-case.ts:67-80`). Consequently `POST /tasks/:taskId/complete` (`controller.ts:46-52`) *is* exactly the "generic card-completion mutation" that plan §5.1.1 forbids ("Never add a generic card-completion mutation"). Reusing this endpoint on the work-card surface would let a card read DONE while its domain issue is still open — a false-belief risk the usability criteria (`spec.md:454`, AC31) explicitly target.

**5.5 Retry behaviour of task-creating flows.** Retries are bounded and backed-off (`action-runner:104-112`, `WORKFLOW_MAX_RETRY_ATTEMPTS`, `computeNextAttemptAt`/`isRetryExhausted` :11), and exhausted runs go to `WorkflowDeadLetter` (:121-132). Retry of the *same* action run is deduped by `findTaskByActionRunId` (:221, :329) — but see §6 for the race.

**5.6 Cross-feature side effect (not in the original question list, but material).** `delete-expense.use-case.ts:66-76` blocks expense deletion when **any** `WorkflowTask` row matches `sourceType:'expense_record', sourceId` — **the query has no status filter**, so DONE and CANCELED tasks block deletion just as OPEN ones do. If work cards begin writing `WorkflowTask` rows against expenses, expense deletion will start failing in cases where it previously succeeded. This is a behavioural regression risk that reuse introduces for free.

---

## 6. Concurrent-writer risk

**Two flows can write the same logical task simultaneously today, and nothing prevents it.**

- **Duplicate creation.** `findTaskByActionRunId` → `createTask` (`action-runner:221-230`, `:329-331`) is a check-then-act across two round trips with **no transaction and no unique constraint** (`schema.prisma:5726-5728`). Two concurrent runners for the same action run both see "not found" and both insert. The window is small but unbounded by the database.
- **Lost updates on state.** W3/W4/W5 each do `findTaskById` then `updateTask` with no transaction, no compare-and-set and no version column (`use-case.ts:49→54`, `:68→74`, `:88→95`). The status guards (`:52`, `:71`, `:93`) are read from a stale snapshot, so concurrent snooze+complete, or two completes, resolve last-write-wins. Concurrent assignment cannot race today only because no assignment write path exists (§5.1) — adding one without CAS would inherit the same defect.
- **Tenant scoping is indirect.** `updateTask` issues `where: { id }` without `companyId` (`repository.ts:416`); safety rests entirely on the preceding company-scoped read (`repository.ts:386`). A future caller that skips the read would write cross-tenant.

Repo precedent for the fix shape (no schema change required): `crmCampaignRecipient.claim` uses a CAS `updateMany({ where: { id, status: 'PENDING' }, ... })` — `apps/api/src/modules/crm-inbox/infrastructure/prisma-crm-campaign.repository.ts:24`. Optimistic `version Int @default(1)` columns are also an established pattern in this schema (`schema.prisma:2326`, `:2822`, `:2865`, `:2912`, `:2942`, `:5966`, `:6367`).

---

## 7. Notification linkage from tasks

**None exists.** Grep across `apps/api/src/modules/dashboard-notifications` and `apps/api/src/workers` for `workflow_task` / `taskId` returns nothing. `SEND_NOTIFICATION` and `CREATE_WORKFLOW_TASK` are independent action types (`workflow.constants.ts:17`, `contracts/src/workflow.ts:22`) — the notification action builds its own `NotificationEvent` with its own `deepLinkHref`/`sourceRefs`/`recipientUserIds` (`action-runner:210-213`) and returns `targetType:'notification_event'` (:214), with no reference back to a task row. `WorkflowTask` has no notification-side field (`schema.prisma:5702-5722`).

Consequence: the plan §5.1.8 notification policy keyed on `businessIssueKey + policy window`, with "no duplicate after acknowledgement", has **no existing task↔notification seam to reuse**. `NotificationRecipient` does carry its own `snoozedUntil` (`notification.model.ts:63`) but it is unrelated to task state.

---

## 8. Verdict

Conservative, evidence-based. "Smallest additive field" is named only where reuse is otherwise impossible; no further schema is proposed.

| Capability | Status | Detail | Evidence |
|---|---|---|---|
| **Deterministic identity** | `NEEDS_MINIMAL_ADDITIVE_FIELD` | Nothing today can key a business issue. Smallest addition: **`businessIssueKey String?` + `@@unique([companyId, businessIssueKey])`**. (Uniquing the existing `(companyId, sourceModule, sourceType, sourceId)` instead is not safe without a duplicate scan — see BLOCKED-1 — and all three columns are nullable.) | schema.prisma:5726-5728; migration.sql:273,276,279; action-runner:221,329; precedent schema.prisma:2260 |
| **Application idempotency** | `NEEDS_MINIMAL_ADDITIVE_FIELD` | Depends entirely on the constraint above; with it, `upsert` on `(companyId, businessIssueKey)` is sufficient and needs no further field. Today's check-then-create is unbacked. Repo rule: must be `upsert`, **not** create→catch-P2002 inside `$transaction`. | action-runner:221-230, 329-331; upsert precedent seed.ts:2205 |
| **Assignment** | `REUSABLE_AS_IS` (storage) | `assigneeUserId`/`assigneeRole` columns, indexes and read-side scoping all exist and correctly grant no access. **No schema change needed**, but no assignment write path exists at all — a new application-layer use-case/endpoint must be built (with CAS, per Concurrency below). | schema.prisma:5711-5712, 5726; use-case.ts:16-24, 36-42; controller.ts:38-60 (no assign route) |
| **Acknowledgement** | `NEEDS_MINIMAL_ADDITIVE_FIELD` | No representation exists; `completedAt`/`completedByUserId` mean DONE, not ack. Smallest addition: **`acknowledgedAt DateTime?`** (add `acknowledgedByUserId String?` only if the notification-dedupe rule must be per-user). | schema.prisma:5702-5722 (absent); use-case.ts:74 |
| **Snooze** | `REUSABLE_AS_IS` (storage) | `snoozedUntil` + `SNOOZED` status + endpoint all exist; **no schema change needed**. Two mandatory application-layer additions: (a) bound the value by `dueAt` — currently written raw from the request body; (b) compute an effective status so a lapsed snooze reappears — no sweeper exists and the mapper returns raw status. CRM already demonstrates (b). | schema.prisma:5716; use-case.ts:52-54; controller.ts:42-43; mapper.ts:130-147; crm.logic.ts:148-150; crm-follow-up.use-case.ts:225 |
| **Domain-terminal projection** | `UNSAFE` | `complete` sets DONE on user assertion with **no domain-terminality check**, and is precisely the generic card-completion mutation plan §5.1.1 forbids. Reuse would let a card display DONE over a still-open domain issue. Not fixable by adding a field — the work-card surface must not expose `POST /tasks/:id/complete`, and DONE must be written only by a domain-terminal projection. (Mitigating: nothing today lets task DONE mutate domain truth — the existing code asserts this in three places.) | use-case.ts:67-80 (esp. :73); controller.ts:46-52; action-runner:237; plan.md §5.1.1-5.1.2; spec.md:453 |
| **Concurrency safety** | `UNSAFE` today; fixable without schema | All three mutations are unguarded read-then-write (no transaction, no CAS, no version); `updateTask` omits `companyId` from its `where`. Preferred fix needs **no schema change**: CAS via `updateMany({ where: { id, companyId, status: <expected> } })` per the existing `crmCampaignRecipient.claim` precedent. If the plan's "expected-version" wording requires a monotonic token, the smallest additive field is **`version Int @default(1)`**. | use-case.ts:49-54, 68-74, 88-95; repository.ts:416; precedent prisma-crm-campaign.repository.ts:24; version precedent schema.prisma:2326 |

**Overall:** exact reuse is **not** possible as-is. Reuse remains viable — and materially cheaper than a new store — behind **two additive columns (`businessIssueKey`, `acknowledgedAt`) plus one unique constraint**, with the remaining gaps closed in the application layer. Per plan §5.1.2 this is the "smallest additive collaboration field/schema" branch, not the "parallel workflow engine" branch.

### Additional findings for the plan owner (not capability verdicts)
- **Plan text correction:** `plan.md:24` lists the status enum as `OPEN|SNOOZED|DONE`; the real enum has a fourth value `CANCELED` (`schema.prisma:5530`, `contracts/src/workflow.ts:35`). The work-card `friendlyState` mapping must cover it.
- **Expense-delete coupling:** writing work-card tasks against expenses will newly block expense deletion, because the blocker query matches tasks of **any** status (`delete-expense.use-case.ts:66-76`).
- **No task↔notification seam** exists to hang the §5.1.8 policy on (§7).

### BLOCKED
1. **Duplicate-scan evidence for UAT/prod.** Whether existing rows already contain multiple tasks per `(companyId, sourceModule, sourceType, sourceId)` cannot be determined from the repository. This is required **only** if the plan chooses to unique the existing source triple instead of adding `businessIssueKey`; a new nullable `businessIssueKey` column needs no backfill scan. Missing: a read-only count query against UAT/prod. Owner: deploy/data owner.

---

## Verification

- Method: `grep`/`Read` only over `apps/api`, `apps/web`, `packages` at HEAD `ba91c102`. `.claude/worktrees/**`, `node_modules`, `.next` and `apps/api/src/generated/**` excluded from all counts.
- No builds, no tests, no DB queries run (survey scope; DB claim deferred to BLOCKED-1).
- Counts: 5 production writer sites + 1 seed; 2 repository write primitives; **0 delete sites**; 7 reader surfaces.
