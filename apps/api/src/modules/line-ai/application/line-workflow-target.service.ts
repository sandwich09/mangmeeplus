import { ListExpensesUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { expenseListReadScope } from '../../expenses/application/expense-list-read-scope';
import { validateStatusTransition } from '../../expenses/domain/logic/expense-status.logic';
import { ListCounterpartiesUseCase } from '../../accounting-documents/application/use-cases/counterparty.use-case';
import { DisbursementVoucherUseCase } from '../../expenses/application/use-cases/disbursement-voucher.use-case';
import { ListSubstituteReceiptCandidatesUseCase } from '../../expenses/application/use-cases/substitute-receipt.use-case';
import { LineVoucherActionService } from './line-voucher-action.service';
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { isExpenseDeletableState, type LineWorkflowId, type ReimbursementRequestSummary, type RequestContext, type ExpenseStatus, type ExpensePaymentStatus } from '@watchdog-bms/contracts';
import { ListReimbursementsUseCase } from '../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { canTransition } from '../../reimbursements/domain/logic/reimbursement.logic';
import { LineExpenseActionService, type ExpenseAction } from './line-expense-action.service';

import { CLAIM_WORKFLOW_ACTIONS, EXPENSE_WORKFLOW_ACTIONS, type ExpenseWorkflowId, type ClaimWorkflowId } from '../domain/logic/line-reimbursement-approval-control.logic';

export type LineWorkflowRecordTarget = { id: string; label: string; amount: string; currency: string;
  documentNumbers?: string[]; roundText?: string; revision?: string; branchId?: string };
export type LineWorkflowRecordTargets = { targets: LineWorkflowRecordTarget[]; total: number; exhaustive: boolean;
  latestOnly?: boolean; sellers?: Array<{ id: string; label: string }>; sellerSearch?: string };
type WorkflowSlots = { search?: string; vendorName?: string; vendorCounterpartyId?: string };
export type LineWorkflowTargets = { targets: ReimbursementRequestSummary[]; total: number; exhaustive: boolean; receiptBlocked?: ReimbursementRequestSummary[] };

@Injectable()
export class LineWorkflowTargetService {
  @Inject(ListExpensesUseCase) private readonly expenses!: ListExpensesUseCase;
  @Inject(ListCounterpartiesUseCase) private readonly counterparties!: ListCounterpartiesUseCase;
  @Inject(DisbursementVoucherUseCase) private readonly vouchers!: DisbursementVoucherUseCase;
  @Inject(ListSubstituteReceiptCandidatesUseCase) private readonly candidates!: ListSubstituteReceiptCandidatesUseCase;
  @Inject(LineVoucherActionService) private readonly voucherActions!: LineVoucherActionService;
  constructor(private readonly claims: ListReimbursementsUseCase, @Inject(forwardRef(() => LineExpenseActionService)) private readonly actions: Pick<LineExpenseActionService, 'permitted' | 'canSubmitClaim'> & Partial<Pick<LineExpenseActionService, 'claimSubmitReadiness'>>) {}

  pick(ctx: RequestContext, chat: string, workflow: ClaimWorkflowId, slots: WorkflowSlots, page: number): Promise<LineWorkflowTargets>;
  pick(ctx: RequestContext, chat: string, workflow: ExpenseWorkflowId, slots: WorkflowSlots, page: number): Promise<LineWorkflowRecordTargets>;
  pick(ctx: RequestContext, chat: string, workflow: LineWorkflowId, slots: WorkflowSlots, page: number): Promise<LineWorkflowTargets | LineWorkflowRecordTargets>;
  async pick(ctx: RequestContext, _chat: string, workflow: LineWorkflowId,
    slots: WorkflowSlots, _page: number): Promise<LineWorkflowTargets | LineWorkflowRecordTargets> {
    if (ctx.freeExpenseDrafts) return { targets: [], total: 0, exhaustive: true };
    if (Object.hasOwn(EXPENSE_WORKFLOW_ACTIONS, workflow) || workflow === 'substitute_receipt') return this.pickRecords(ctx, workflow as ExpenseWorkflowId, slots);
    if (!Object.hasOwn(CLAIM_WORKFLOW_ACTIONS, workflow)) return { targets: [], total: 0, exhaustive: true };
    const act = CLAIM_WORKFLOW_ACTIONS[workflow as ClaimWorkflowId];
    const targets = new Map<string, ReimbursementRequestSummary>();
    const receiptBlocked = new Map<string, ReimbursementRequestSummary>();
    let total = 0;
    const scanned = new Set<string>();
    for (let page = 1; page <= 3; page++) {
      const result = await this.claims.execute(ctx, { page, pageSize: 100, search: slots.search,
        ...(act === 'REIMBURSEMENT_SUBMIT' ? { bucket: 'draft' as const }
          : act === 'REIMBURSEMENT_RECORD_PAYMENT' ? { bucket: 'payment' as const }
            : act === 'REIMBURSEMENT_APPROVE' || act === 'REIMBURSEMENT_REJECT' ? { status: 'PENDING_APPROVAL' as const } : {}) });
      total = result.total;
      for (const claim of result.items) scanned.add(claim.id);
      for (const claim of result.items) {
        if (claim.cancellationPending) continue;
        const readiness = act === 'REIMBURSEMENT_SUBMIT' ? await this.actions.claimSubmitReadiness?.(ctx, claim.id) : undefined;
        const allowed = act === 'REIMBURSEMENT_APPROVE' ? claim.approvalActions?.canApprove
          : act === 'REIMBURSEMENT_REJECT' ? claim.approvalActions?.canReject
            : act === 'REIMBURSEMENT_SUBMIT' ? readiness?.ready ?? await this.actions.canSubmitClaim(ctx, claim.id)
              : (act !== 'REIMBURSEMENT_CANCEL' || canTransition(claim.status, 'CANCELLED'))
                && await this.actions.permitted(ctx, { expenseId: claim.id, createdByUserId: claim.requesterUserId, preview: { action: act as ExpenseAction } });
        if (allowed) targets.set(claim.id, claim);
        else if (readiness && 'receiptMissing' in readiness && readiness.receiptMissing
          && claim.status === 'DRAFT' && claim.requesterUserId === ctx.userId) receiptBlocked.set(claim.id, claim);
      }
      if (page * 100 >= total) break;
    }
    return { targets: [...targets.values()], total, exhaustive: total <= 300 && scanned.size >= total,
      ...(receiptBlocked.size ? { receiptBlocked: [...receiptBlocked.values()] } : {}) };
  }

  private async readPages<T extends { id: string }, S>(sets: readonly S[], read: (set: S, page: number) => Promise<{ rows: T[]; total: number }>) {
    const states = sets.map(set => ({ set, page: 0, total: 0, rows: new Map<string, T>() }));
    for (let call = 0; call < 3; call++) {
      const state = states.find(item => item.page === 0) ?? states.find(item => item.rows.size < item.total);
      if (!state) break;
      const result = await read(state.set, ++state.page);
      state.total = result.total;
      for (const row of result.rows) state.rows.set(row.id, row);
    }
    const rows = states.flatMap(state => [...state.rows.values()]);
    const total = states.reduce((sum, state) => sum + state.total, 0);
    return { rows, total, exhaustive: total <= 300 && states.every(state => state.page > 0 && state.rows.size >= state.total)
      && new Set(rows.map(row => row.id)).size === rows.length };
  }

  private async pickRecords(ctx: RequestContext, workflow: ExpenseWorkflowId, slots: WorkflowSlots): Promise<LineWorkflowRecordTargets> {
    if (workflow === 'wht_certificate') {
      await this.voucherActions.authorize(ctx, 'WHT_CERTIFICATE_ISSUE');
      const result = await this.readPages([null], async (_set, page) => {
        const list = await this.vouchers.listForLine(ctx, { page, pageSize: 100, status: 'PAID', q: slots.search });
        return { rows: list.data, total: list.total };
      });
      const targets: LineWorkflowRecordTarget[] = [];
      for (const row of result.rows) if (await this.voucherActions.canOfferCertificate(ctx, row.id)) {
        targets.push({ id: row.id, label: row.payeeName || row.documentNumber || '', amount: row.totalAmount, currency: 'THB',
          documentNumbers: row.documentNumber ? [row.documentNumber] : [] });
      }
      return { targets, total: result.total, exhaustive: result.exhaustive };
    }
    if (workflow === 'substitute_receipt') {
      const result = await this.readPages([null], async (_set, page) => {
        const list = await this.candidates.execute(ctx, { page, pageSize: 100, search: slots.search }, { channel: 'line' });
        return { rows: list.items, total: list.total };
      });
      return { targets: result.rows.map(row => ({ id: row.id, label: row.vendorNameSnapshot || row.expenseNumber || '',
        amount: row.grandTotalAmount, currency: row.currency })), total: result.total, exhaustive: result.exhaustive };
    }
    let vendorCounterpartyId = slots.vendorCounterpartyId;
    const latestOnly = !!slots.vendorName && !ctx.permissions.includes('accounting.counterparty.read');
    if (slots.vendorName && !latestOnly && !vendorCounterpartyId) {
      const sellers = await this.readPages([null], async (_set, page) => {
        const list = await this.counterparties.execute(ctx, page, 100, { search: slots.vendorName });
        return { rows: list.data, total: list.total };
      });
      if (!sellers.exhaustive || sellers.rows.length !== 1) return { targets: [], total: sellers.total, exhaustive: sellers.exhaustive,
        sellers: sellers.rows.slice(0, 3).map(row => ({ id: row.id, label: row.displayName })), sellerSearch: slots.vendorName };
      vendorCounterpartyId = sellers.rows[0]!.id;
    }
    const action = EXPENSE_WORKFLOW_ACTIONS[workflow];
    if (action === 'VOUCHER_CREATE') await this.voucherActions.authorize(ctx, action);
    const creatorOnly = !expenseListReadScope(ctx) && (action === 'MARK_READY' || action === 'DELETE_DRAFT');
    const status: ExpenseStatus | undefined = ['RECORD_PAYMENT', 'VOID', 'VOUCHER_CREATE'].includes(action) ? 'CONFIRMED'
      : action === 'CONFIRM' ? 'READY_FOR_CONFIRMATION' : undefined;
    const paymentSets: Array<ExpensePaymentStatus | undefined> = action === 'RECORD_PAYMENT' ? ['UNPAID', 'PARTIALLY_PAID'] : [undefined];
    const result = await this.readPages(paymentSets, async (paymentStatus, page) => {
      const list = await this.expenses.execute(ctx, { page, pageSize: 100, ...(slots.search ? { search: slots.search } : {}), ...(status ? { status } : {}),
        ...(paymentStatus ? { paymentStatus } : {}), ...(vendorCounterpartyId ? { vendorCounterpartyId } : {}),
        ...(creatorOnly ? { createdByUserId: ctx.userId } : {}) },
        action === 'MARK_READY' || action === 'DELETE_DRAFT' ? { lineAction: action } : {});
      return { rows: list.data, total: list.total };
    });
    const targets: LineWorkflowRecordTarget[] = [];
    for (const row of result.rows.sort((a, b) => b.expenseDate.getTime() - a.expenseDate.getTime() || b.id.localeCompare(a.id))) {
      if (creatorOnly && row.createdByUserId !== ctx.userId) continue;
      if (action === 'MARK_READY' && validateStatusTransition(row.status, row.status === 'REJECTED' ? 'NEEDS_REVIEW' : 'READY_FOR_CONFIRMATION')) continue;
      if (action === 'DELETE_DRAFT' && (!isExpenseDeletableState(row) || row.hasDeletionBlockingHistory || row.hasRetainedSubstituteReceiptEvidence)) continue;
      if (action !== 'VOUCHER_CREATE' && !await this.actions.permitted(ctx, { expenseId: row.id, createdByUserId: row.createdByUserId, preview: { action } })) continue;
      if (action === 'VOUCHER_CREATE' && (row.reservedByDisbursementVoucherId || Number(row.outstandingAmount) <= 0)) continue;
      targets.push({ id: row.id, label: row.vendorNameSnapshot || row.expenseNumber || '', currency: row.currency,
        documentNumbers: [row.expenseNumber, row.vendorDocumentNumber].filter((number): number is string => !!number),
        roundText: [row.vendorNameSnapshot, row.note, row.internalMemo].filter(Boolean).join(' '), revision: row.updatedAt.toISOString(),
        amount: action === 'RECORD_PAYMENT' ? row.outstandingAmount ?? row.grandTotalAmount : row.grandTotalAmount });
    }
    return { targets, total: result.total, exhaustive: result.exhaustive, ...(latestOnly ? { latestOnly } : {}) };
  }

}
