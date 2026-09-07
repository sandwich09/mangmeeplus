# Support resolution lane evidence

Date: 2026-09-07 (Asia/Bangkok)

Scope: request-bound support reply, ownership/handoff, explicit resolution, queue pagination,
unresolved-case retention, unlinked applicant follow-up routing, existing-company sender regression,
and responsive system support inbox. No real LINE message, AWS action, migration against a user
database, commit, push, or merge was performed by this lane.

## Focused API bundle

```sh
cd apps/api
pnpm exec tsx --test --test-reporter=spec \
  src/modules/line-ai/line-first-signup-webhook.spec.ts \
  src/modules/external-signup/application/support-request-admin.use-case.spec.ts \
  src/modules/external-signup/application/line-signup-notify.service.spec.ts \
  src/modules/system-partner-management/presentation/http/partner-support-tools.spec.ts
```

Result: PASS — 146 tests, 24 suites, 0 failed, 0 skipped.

This covers request-bound push success/failure/replay, the 24-hour retry window, stale operation
guards, same-key success/failure races, transactional reply-result audit repair, customer-message
races, ownership/release/takeover/resolution, DTO validation, paging/privacy projections, pause and
retention semantics, natural customer acknowledgements, unlinked follow-ups, and partner sender
regressions.

### Broad-suite webhook regression closure

The workspace test found one older fixture with a support pause but no live support request. Its
expectation still required the former acknowledgement that claimed the team had received the
message. The regression test now proves the capability question remains outside both intake and AI,
while the customer is told that the message was not recorded and receives the phone fallback.

```sh
cd apps/api
pnpm exec tsx --test --test-reporter=spec \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/line-first-signup-webhook.spec.ts
```

Result: PASS — 310 tests, 39 suites, 0 failed, 0 skipped.

## Focused web bundle

```sh
cd apps/web
pnpm exec tsx --test --test-reporter=spec \
  src/features/system-support-requests/support-requests.logic.spec.ts \
  src/features/system-support-requests/SupportRowActions.spec.ts \
  src/features/system-support-requests/SupportRequestsPage.qa.spec.ts
```

Result: PASS — 54 tests, 7 suites, 0 failed, 0 skipped.

This covers status and delivery labels, company/signup/no-target navigation, paging state, ownership
actions including a deleted assignee, error versus empty rendering, full question/latest reply,
mobile card stacking, separate question/latest paragraphs, and 44px minimum action height.

## Required real PostgreSQL support suite

Dedicated task database: local PostgreSQL on port 15571, database `watchdog_bms`. Both task
migrations and permission sync had already been applied by the coordinator. The test replaces the
LINE HTTP boundary and sends no real message.

```sh
cd apps/api
LINE_SUPPORT_TEST_DATABASE_URL='postgresql://watchdog:TEST_PASSWORD@127.0.0.1:15571/watchdog_bms?schema=public' \
  pnpm exec tsx --test --test-reporter=spec \
  src/modules/external-signup/line-support-request.pg.spec.ts
```

Result: PASS — 18 tests, 1 suite, 0 failed, 0 skipped.

Material database checks:

- A no-company case is claimed, replied to at a mocked LINE boundary, and explicitly resolved with
  durable operator evidence and audit.
- A queue of 205 live rows returns 200 plus the remaining 5 through the keyset cursor.
- Customer AI resume clears the pause while the unresolved support row stays live.
- Only old `CLOSED` rows are purged; old `OPEN` and `ANSWERED` rows remain managed.
- Customer follow-up reopens `ANSWERED`, while an explicitly resolved row cannot be resurrected.
- An unlinked applicant keeps the signup link and does not gain company context or access.

## Type and diff checks

```sh
cd packages/contracts && pnpm typecheck
cd apps/api && pnpm typecheck
cd apps/web && pnpm exec tsc --noEmit
git diff --check
```

Result: all PASS. The contracts build also passed before the final web typecheck:

```sh
pnpm --filter @watchdog-bms/contracts build
```

## Review gaps closed

- A client-stable UUID and `previousReplyOperationId` prevent a delayed old form from creating a
  duplicate logical reply. Same-operation replay returns the persisted result.
- The retry clock remains the first attempt time. After LINE's 24-hour dedupe window the UI requires
  a deliberate new message and warns that the earlier outcome may be unknown.
- `SENT` dominates overlapping failure for one operation. Provider result, answered decision, and
  audit commit in one database transaction after the external call; audit failure leaves the same
  operation retryable for provider dedupe repair.
- Failed or unknown delivery never changes the request to `ANSWERED`. A customer message arriving
  during delivery keeps the case `OPEN`.
- Latest bounded staff reply text and sender are retained with the case so another operator can see
  and safely retry the exact pending payload. Stored errors are bounded codes, not provider bodies.
- Claim, release, version-checked takeover, and explicit resolution are auditable. Assignment
  presence uses `assignedAt`, so a deleted assignee still exposes takeover rather than a dead claim.
- Resume AI, delivered reply, and resolution are separate outcomes. Operator and customer resume
  clear only the pause; neither hides an unresolved case.
- Pause expiry performs no support closure. Retention removes only explicitly `CLOSED` cases after
  the settled-case window.
- Ordinary text from an unlinked applicant with a live `OPEN`/`ANSWERED` case is recorded and can
  reopen it. Explicit signup/menu/resume commands keep their routes and grant no identity or tenant.
- A daily-limit denial and a failed follow-up write use natural Thai, state that no new request or
  message was recorded, and offer the existing phone fallback without request IDs or technical codes.
- REQUEST_INFO displays the current bounded signup resolution note as requested information. It is
  not copied into customer request text or the inline reply-operation fields.
- A generic partner-company message does not mass-answer every support case. A named request uses
  its current message snapshot and preserves the existing tenant/status checks.
- The mobile inbox stacks each row, shows the full original question and latest reply as separate
  paragraphs, exposes all actions, and keeps desktop table behavior at the medium breakpoint.

No remaining blocker in the support lane. The coordinator owns combined browser reruns, final plan
and playbook consolidation, Git operations, CI, and delivery.
