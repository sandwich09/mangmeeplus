# Substitute receipt — notify the next signer on LINE — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Owner approved ("ต้องการให้ส่งไปที่ line"). Task state
[[substitute-receipt-standalone-menu]]. Phases 1–7 are applied and committed — build on them.

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e, no `prisma migrate`. **No schema change, no new dependency, no new adapter.**

## Why, and why this is small

When the payer or approver is someone else, the wizard's only handoff today is "copy this link and send it
yourself". The system already has everything needed to do better — and the important part of this handoff is
what **not** to build.

There is a working, guarded, employee-facing LINE rail:
`CreateOrUpdateNotificationEventUseCase` → a queued `NotificationDelivery` row per recipient per channel →
`ProcessDueNotificationDeliveriesUseCase`, swept every 30 s by the `delivery.sweep` worker job → push on the
shared WatchDog OA. Going through it gives you, for free: LINE identity resolution
(`ExternalIdentity` provider `LINE`, ACTIVE, channel-matched), per-user channel and trigger **preferences**,
**quiet hours** (Asia/Bangkok), dedup + 60-minute cooldown, retry with backoff (5 attempts), an idempotency
key derived from the delivery id, and a lifecycle fence that suppresses if the membership went inactive.

**Do not** use `pushSystemLineMessage` (`apps/api/src/modules/auth/infrastructure/system-line-push.ts`). It is
fire-and-forget with no preference check, no quiet hours, no retry and no audit — deliberately scoped to
security/auth notices that must not be suppressible. A signature reminder is not one of those.

**Do not** build a Flex card. The rail is text-only today (`buildLineMessage` / `pushLineMessage` in
`notification.use-cases.ts`), and its plain `<baseUrl><deepLinkHref>` tail is what every other staff
notification already sends. Widening the rail to carry Flex is a separate, larger change; if you think it is
required, say so in your report instead of doing it.

## What to change (4 files + specs)

### 1. Register the trigger key — mandatory

`apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts`: add
`'expense.substitute_receipt_signature_pending'` to `IMPLEMENTED_TRIGGER_KEYS`.

This is not optional bookkeeping: `ProcessQueuedDeliveryUseCase` defaults a user's `enabledTriggers` to that
array and **silently suppresses** any key missing from it. Skip this and the feature will look implemented,
pass every test, and deliver nothing.

### 2. Wire the module

`apps/api/src/modules/expenses/expenses.module.ts`: add `DashboardNotificationsModule` to `imports`. That
module already exports `CreateOrUpdateNotificationEventUseCase`.

### 3. Emit at the two handoff points

`apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`:

- **`PrepareSubstituteReceiptUseCase`** → notify the payer that a certificate awaits their signature.
- **`CertifySubstituteReceiptUseCase`** → notify the eligible approver(s) that a certificate awaits approval.
  Resolve them with the existing `repo.listEligibleSubstituteReceiptApprovers(companyId, branchId)`, and in
  `DESIGNATED_APPROVERS` mode intersect that with `policy.approverUserIds` — reuse the same predicate the
  approve guard applies rather than restating the rule.

```ts
await this.notify.execute({
  companyId: ctx.companyId,
  triggerKey: 'expense.substitute_receipt_signature_pending',
  sourceModule: 'expenses',
  sourceType: 'substitute_receipt_evidence',
  sourceId: evidence.id,
  severity: 'action',
  title: `ใบรับรองแทนใบเสร็จรอการลงลายมือชื่อ เลขที่ ${evidence.documentNumber}`,
  body: 'เปิดระบบเพื่อตรวจสอบเอกสารและลงลายมือชื่อ',
  deepLinkHref: `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence.id}`,
  recipientUserIds,
});
```

`severity: 'action'`, **not** `'critical'` — critical bypasses quiet hours and raises a HIGH-risk audit row on
failure. A signature reminder earns neither.

### 4. Never notify the person who just acted

**This is the requirement most likely to be missed.** Filter `ctx.userId` out of `recipientUserIds`, and skip
the call entirely when the list is then empty.

Two concrete cases this covers:
- A reviewer prepares a certificate naming **themselves** as payer — they are already looking at the screen.
- The **solo-owner** flow (`approvalMode === 'OWNER_SELF'`, owner is both payer and approver): after the owner
  certifies, the approver set resolves to themselves. Sending "a certificate awaits your approval" to the
  person who just signed it, seconds earlier, is exactly the kind of noise that makes people mute the OA.

A notification failure must never fail the business operation. Prepare and certify already succeeded and were
audited by the time you notify; wrap the call so a notification error is logged and swallowed, matching how
other producers in this repo treat it. Verify that claim against a neighbouring producer
(`ScanCrmSlaBreachesUseCase`, `CrmPaymentProofUseCase`) and follow whatever they do rather than inventing a
pattern.

### 5. Web: stop promising a manual copy when the system will tell them

`SubstituteReceiptWizardPage`'s waiting state currently offers only "copy the link". Keep the copy button —
LINE may not be linked — but change the surrounding line to say the request has been sent, e.g.
`ระบบได้แจ้งเตือนผู้จ่ายเงินผ่าน LINE แล้ว หากยังไม่ได้รับ สามารถคัดลอกลิงก์ส่งให้ด้วยตนเองได้`.

Do not claim delivery you cannot see: the rail is queued and preference-gated, so the honest wording is that a
notification was **sent**, not that it arrived.

## Correct the stale memo

`docs/agent-memory/notification-line-push-wiring.md` still says the LINE push design has "no implementation
yet". It has been implemented (queued rail + worker sweep + shared-OA push). Update that file to say so and
point at `ProcessQueuedDeliveryUseCase`, so the next person does not rebuild it.

## Copy, icons, dates (unchanged owner directives)

Formal-professional Thai a layperson understands; official vocabulary (ลงลายมือชื่อ); verb-first buttons; no
casual particles or emoji — including in the LINE body, which is Thai the recipient reads on a phone. UI dates
`5 ส.ค. 2569` via the shared `formatThaiDate`. Every new UI string goes through the `t()` dictionary with
**both** `th` and `en` entries. The LINE title/body are server-side and Thai-only, matching the other staff
notifications.

## Files

```
apps/api/src/modules/dashboard-notifications/domain/models/notification.model.ts
apps/api/src/modules/expenses/expenses.module.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx
apps/web/src/common/i18n/workspace-dictionary.ts
docs/agent-memory/notification-line-push-wiring.md
```

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/api && corepack pnpm exec node --import tsx --test \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts \
  src/modules/dashboard-notifications/domain/logic/notification.logic.spec.ts
cd apps/web && corepack pnpm exec node --import tsx --test src/common/i18n/workspace-i18n.spec.ts
```

Specs must cover: the payer is notified on prepare; the actor is **not** notified when they are the payer;
approvers are notified on certify; and the solo-owner case emits **nothing** on certify.

## Report back

1. The recipient resolution for both legs, and where the self-exclusion happens.
2. How a notification failure is prevented from failing prepare/certify, and which existing producer you
   copied.
3. Confirmation the trigger key is in `IMPLEMENTED_TRIGGER_KEYS`.
4. Test output for each verify command.
5. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
