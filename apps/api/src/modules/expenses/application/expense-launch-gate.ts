import { ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../audit/application/audit.service';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../employee-access/application/entitlement.helper';
import { LaunchGateGuardService } from '../../feature-launch/application/launch-gate.guard';
import { isLaunchRouteOpen } from '../../tax/application/use-cases/wht-certificate-handoff.use-case';

/**
 * What a person sees while `expenses/DEFAULT` is CLOSED. Plain Thai, no gate or route key: those
 * are internal control-plane identifiers and must never reach a customer (runbook §2.3).
 *
 * It says what still works, because `BLOCK_NEW_ROOT` really does leave it working — the runoff
 * matrix keeps every existing record readable and lets review/confirm/payment of drafts already in
 * the system run to completion. "ปิดปรับปรุง" without that second sentence would read as data loss.
 */
export const EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE =
  'ระบบบันทึกค่าใช้จ่ายปิดปรับปรุงชั่วคราว รายการเดิมยังเปิดดูได้ตามปกติ';

/**
 * THE EXPENSES KILL SWITCH (plan §P3 item 2), the web sibling of the AI lane's
 * `refuseWhenLaunchRouteClosed`. Called by the two entry points that create NEW expense work —
 * the manual draft and the receipt upload — and by nothing else.
 *
 * `BLOCK_NEW_ROOT`, not "stop everything": a CLOSE refuses new roots and leaves runoff alone, so
 * `mark-ready`, `confirm` and `payment` of a draft that already exists stay ungated on purpose
 * (`feature-entitlement-runoff-matrix.md:38`). Closing the gate must not strand work mid-journey.
 *
 * FAIL MODE, deliberately not fail-open: `isLaunchRouteOpen` converts only the control-plane
 * refusal (`feature_temporarily_unavailable`) into `false` and rethrows anything else — a failed
 * read inside the guard lands on the caller's normal error path instead of quietly creating a
 * record, per runbook R8 rule 2 ("availability problems therefore degrade toward closed").
 *
 * Audits the refusal the way this module audits every other denial (`DeleteExpenseUseCase`): the
 * SAME action as the success row, `result: 'DENIED'`, with the reason in metadata.
 */
export async function assertExpenseRootOpen(
  launchGate: LaunchGateGuardService,
  audit: AuditService,
  ctx: RequestContext,
  action: string,
): Promise<void> {
  if (await isLaunchRouteOpen(launchGate, 'expenses', 'DEFAULT')) return;
  await audit.log({
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    action,
    targetType: 'expense_record',
    requestId: ctx.requestId,
    result: 'DENIED',
    riskLevel: 'LOW',
    metadataJson: { reason: 'launch_route_closed' },
  });
  throw new ForbiddenException({
    code: FEATURE_TEMPORARILY_UNAVAILABLE,
    message: EXPENSE_LAUNCH_ROUTE_CLOSED_MESSAGE,
  });
}
