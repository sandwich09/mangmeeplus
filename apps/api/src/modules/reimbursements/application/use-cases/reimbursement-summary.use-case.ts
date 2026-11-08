import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  reimbursementDuplicateWait, REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, THAI_SYSTEM_ROLE_NAMES, civilDate, civilDateToUtcDate, REIMBURSEMENT_DESK_LABELS, REIMBURSEMENT_SYSTEM_WAIT_LABEL,
  type RequestContext, type ReimbursementAiSummary, type ReimbursementAiSummaryItem, type ReimbursementAiReadFilters,
} from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import {
  claimDuplicateBlocksPayment, claimDuplicateReasons, ageHours, isSlaRisk, d, decStr, currentDesk, approvalWaitStartedAt, payoutCorrectionPhase, payoutCorrectionRequesterDesk,
} from '../../domain/logic/reimbursement.logic';
import type { ReimbursementApprovalStepRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';

/**
 * Read-only summary for LINE/AI. Enforces the same permissions as web and can never
 * mutate. Callers with only reimbursement.read_own are scoped to their own requests.
 */
@Injectable()
export class GetReimbursementAiSummaryUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, filters: ReimbursementAiReadFilters = {}): Promise<ReimbursementAiSummary> {
    if (filters.round !== undefined && !/^\d{1,4}$/u.test(filters.round)) throw new BadRequestException('ระบุรอบใบเบิกเป็นตัวเลข');
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadOwn = ctx.permissions.includes('reimbursement.read_own');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read reimbursements');

    if (filters.requester !== undefined && filters.requester !== 'me') throw new BadRequestException('ระบุผู้เบิกเป็นตัวเอง');
    for (const key of ['amountGt', 'amountGte', 'amountLt', 'amountLte'] as const) {
      if (filters[key] !== undefined && (typeof filters[key] !== 'string' || !/^\d+(?:\.\d{1,2})?$/u.test(filters[key]!))) throw new BadRequestException('ระบุยอดเงินเป็นตัวเลขไม่เกินสองตำแหน่ง');
    }
    const requesterUserId = filters.requester === 'me' || !canReadAll && !canReadRelated ? ctx.userId : undefined;
    const relatedUserId = !canReadAll && canReadRelated ? ctx.userId : undefined;
    const currentPolicy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const approvedUnpaid = filters.status === 'APPROVED_UNPAID';
    const scoped = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId,
      relatedUserId,
      scopes: ctx.scopes ?? {},
      withDuplicateCandidates: true,
      requesterName: filters.requesterName, categoryName: filters.categoryName,
      status: approvedUnpaid ? undefined : filters.status,
      statuses: approvedUnpaid ? ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID'] : undefined,
      paymentStatus: filters.paymentStatus,
    });
    const all = scoped.filter(row => (!approvedUnpaid || row.paymentStatus !== 'PAID')
      && (filters.amountGt === undefined || d(row.amount).gt(d(filters.amountGt)))
      && (filters.amountGte === undefined || d(row.amount).gte(d(filters.amountGte)))
      && (filters.amountLt === undefined || d(row.amount).lt(d(filters.amountLt)))
      && (filters.amountLte === undefined || d(row.amount).lte(d(filters.amountLte)))
      && (!filters.round || new RegExp(`รอบ\\s*(?:ที่\\s*)?${filters.round}(?![0-9])`, 'u').test(`${row.title ?? ''} ${row.reason}`)));
    const now = new Date();

    let pendingApproval = 0;
    let overdueApproval = 0;
    let unpaidApproved = 0;
    let duplicateBlocked = 0;
    let totalUnpaid = d('0');
    const unpaidItems: ReimbursementAiSummaryItem[] = [];
    const pendingItems: ReimbursementAiSummaryItem[] = [];
    const item = (r: (typeof all)[number], amount: string): ReimbursementAiSummaryItem =>
      ({ requestNo: r.requestNo ?? null, title: r.title ?? null, requesterDisplayName: r.requesterDisplayNameSnapshot ?? null, amount });

    for (const r of all) {
      // Being cancelled: approval and payment are refused meanwhile, so it waits for no approver and no
      // payer and is in none of the four figures. The backlog below and the claim page say the same of it.
      if (r.cancellationPendingAt) continue;
      // Sent back for its account to be corrected (spec §14) and still with its requester: it waits
      // for no approver. Once the account is given, its approvers' wait counts from then.
      if (r.status === 'PENDING_APPROVAL' && payoutCorrectionPhase(r) !== 'AWAITING_REQUESTER') {
        const policy = effectivePolicyForRequest(r, currentPolicy);
        pendingApproval++;
        if (pendingItems.length < 5) pendingItems.push(item(r, decStr(d(r.amount))));
        const waitingSince = approvalWaitStartedAt(r);
        const age = waitingSince ? ageHours(waitingSince, now) : 0;
        if (isSlaRisk(age, policy.slaHours)) overdueApproval++;
      }
      if ((r.status === 'FINANCE_REVIEW' || r.status === 'READY_FOR_PAYMENT' || r.status === 'PARTIALLY_PAID') && r.paymentStatus !== 'PAID') {
        if (claimDuplicateBlocksPayment(r, currentPolicy)) { duplicateBlocked++; continue; }
        unpaidApproved++;
        if (unpaidItems.length < 5) unpaidItems.push(item(r, decStr(d(r.outstandingAmount))));
        totalUnpaid = totalUnpaid.add(d(r.outstandingAmount));
      }
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.ai_tool.read',
      targetType: 'reimbursement_summary', requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    const matchedTotals = new Map<string, Money>();
    for (const row of all) addMoney(matchedTotals, row.currency, row.amount);
    return {
      appliedFilters: { ...filters },
      matchedTotalsByCurrency: moneyList(matchedTotals),
      matchedCount: all.length,
      matchedItems: all.slice(0, 5).map(row => ({ ...item(row, decStr(d(row.amount))), id: row.id, status: row.status, currency: row.currency })),
      pendingApprovalCount: pendingApproval,
      unpaidApprovedCount: unpaidApproved,
      overdueApprovalCount: overdueApproval,
      totalUnpaidAmount: decStr(totalUnpaid),
      duplicateBlockedCount: duplicateBlocked,
      unpaidApprovedItems: unpaidItems,
      pendingApprovalItems: pendingItems,
      // Item 1 (spec R-A1 row 18): mirrors the requesterUserId/relatedUserId precedence above exactly
      // (related wins whenever canReadRelated is true, same as `relatedUserId` there).
      accessScope: canReadAll ? 'company' : canReadRelated ? 'related' : 'own',
    };
  }
}

// ---- ใบเบิกค้างที่ใคร (advisor spec §5.3) ----

/** Claims still waiting on someone. APPROVED is the transient hand-off to finance or payment. */
const BACKLOG_STATUSES = ['PENDING_APPROVAL', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'APPROVED'];

/** The web's desk words (`REIMBURSEMENT_DESK_LABELS`, the one source both read) plus the two waits only this view names.
 *  Finance says what it waits for (eval 2026-09-30: a bare "ฝ่ายการเงิน" came back as "(รออนุมัติ)"). Payment is whoever
 *  holds the pay right, never "ฝ่ายการเงิน": a claim with no finance-review step has no finance desk (spec §18.3). */
export const BACKLOG_DESK_LABELS = {
  finance: `${REIMBURSEMENT_DESK_LABELS.FINANCE} (รอตรวจสอบ)`,
  payment: REIMBURSEMENT_DESK_LABELS.PAYMENT,
  duplicate_blocked: REIMBURSEMENT_DUPLICATE_BLOCK_LABEL,
  no_active_approver: 'ไม่มีผู้อนุมัติที่ยังใช้งานอยู่',
  // The system's desk: the same words the claim page prints for the same claim.
  status_pending: REIMBURSEMENT_SYSTEM_WAIT_LABEL,
} as const;
export const SHARED_PILE_LABEL = 'กองกลาง (อนุมัติได้หลายคน)';
/** The recovery rule (`frozenApprovalAuthority` FALLBACK → `matchesApproverRole`), so the answer names the real next
 *  step instead of guessing one (eval 2026-09-30: "ติดต่อทีม HR", "จะค้างไม่มีกำหนด"). */
export const NO_ACTIVE_APPROVER_NOTE = `ผู้ที่ถูกกำหนดให้อนุมัติไม่อยู่หรือไม่ได้ดูแลสาขานี้แล้ว ${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีบทบาทอนุมัติเดิมอนุมัติแทนได้บนเว็บ`;
const BACKLOG_DESK_NOTES: Partial<Record<keyof typeof BACKLOG_DESK_LABELS, string>> = { no_active_approver: NO_ACTIVE_APPROVER_NOTE };

/**
 * The desks, in the order the answer lists them. The last is a claim sent back from the pay step that is with its
 * requester (spec §14, §17.3). It has no label of its own: its row takes the claim page's status label for what
 * THAT claim holds, and the sentence that goes with it (`payoutCorrectionRequesterDesk`). So there is one row per
 * label, each true of every claim it counts ("รอผู้เบิกแก้บัญชีรับเงิน" was said of a claim with no account, and of
 * one that asked for cash). The answer says where the claim stands and nothing of an account itself.
 */
type BacklogDeskKind = keyof typeof BACKLOG_DESK_LABELS | 'requester_correction';
const BACKLOG_DESK_KINDS: BacklogDeskKind[] = [...Object.keys(BACKLOG_DESK_LABELS) as Array<keyof typeof BACKLOG_DESK_LABELS>, 'requester_correction'];
type BacklogMoney = { currency: string; amount: string };
/**
 * Approval-stage waits count from `submittedAt`; finance and payment have no arrival time, so from `approvedAt`.
 * In an account correction round (spec §14) the wait is the round's own: since the claim was sent back while
 * it is with its requester, since the account was given while it waits for its approvers.
 */
type BacklogGroup = {
  count: number; totalsByCurrency: BacklogMoney[]; oldestSubmittedOn?: string; oldestApprovedOn?: string;
  /** The desk of claims with their requester for the account: since when the oldest of them was sent back. */
  oldestSentBackOn?: string;
  longestWaitDays: number;
};
export type ReimbursementApprovalBacklog = {
  accessScope: 'company' | 'related' | 'own';
  /** Claims at every stage: approval, finance review and payment. */
  total: number;
  /** The part still waiting for an approver (eval 2026-09-30: answers called the whole total "ค้างอนุมัติ"). */
  awaitingApprovalCount: number;
  totalsByCurrency: BacklogMoney[];
  /** Only claims exactly one active person can approve. */
  byApprover: Array<{ name: string } & BacklogGroup>;
  /** Owner 2026-09-30 ("แยกเป็นกองกลาง"): claims several people can approve, counted for no one. */
  sharedPile: ({ label: string } & BacklogGroup) | null;
  desks: Array<{ kind: BacklogDeskKind; label: string; note?: string } & BacklogGroup>;
  /** Longest wait first, at most 10: the desk of each claim ("ใบของฉันค้างที่ใคร"). */
  items: Array<{ id: string; documentNumber: string | null; requesterName: string; amount: string; currency: string;
    waitingOn: string; submittedOn: string; approvedOn?: string;
    /** In a correction round, the day `waitDays` counts from: sent back to its requester, or sent to its approvers again. */
    sentBackOn?: string; resubmittedOn?: string;
    waitDays: number }>;
  /** Only when the caller's own claims came back empty: none on record vs. none waiting (eval R-20). */
  hasOwnClaims?: boolean;
};

type Money = ReturnType<typeof d>;
const addMoney = (totals: Map<string, Money>, currency: string, amount: string) => totals.set(currency, (totals.get(currency) ?? d('0')).add(d(amount)));
const moneyList = (totals: Map<string, Money>): BacklogMoney[] => [...totals].sort(([a], [b]) => a.localeCompare(b))
  .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));

/**
 * Read-only "whose desk are the claims waiting on" for LINE. Same scope as the AI summary (web read
 * permissions, branch scope); `requester: 'me'` narrows any scope to the caller's own claims. A person
 * is counted or named only while they can still act on that claim's branch (`findActiveApproverUserIds`),
 * because `getUserDisplayNames` still returns people who have left.
 */
@Injectable()
export class GetReimbursementApprovalBacklogUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, input: { requester?: 'me' } = {}, now = new Date()): Promise<ReimbursementApprovalBacklog> {
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadRelated && !ctx.permissions.includes('reimbursement.read_own')) {
      throw new ForbiddenException('Missing permission to read reimbursements');
    }
    const mine = input.requester === 'me' || (!canReadAll && !canReadRelated);
    const currentPolicy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const rows = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId: mine ? ctx.userId : undefined,
      relatedUserId: !mine && !canReadAll ? ctx.userId : undefined,
      scopes: ctx.scopes ?? {},
      statuses: BACKLOG_STATUSES,
      withDuplicateCandidates: true,
    });

    // currentDesk's own step: the lowest open sequence of each waiting claim.
    const stepOf = new Map<string, ReimbursementApprovalStepRecord>();
    const pending = rows.filter((row) => row.status === 'PENDING_APPROVAL').map((row) => row.id);
    for (const step of await this.repo.findPendingApprovalSteps(ctx.companyId, pending)) {
      if (!stepOf.has(step.reimbursementRequestId)) stepOf.set(step.reimbursementRequestId, step);
    }
    // Frozen assignees, or a legacy named approver; undefined is a legacy role-routed step.
    const candidates = (step: ReimbursementApprovalStepRecord) => step.assignedApproverUserIds ?? (step.approverUserId ? [step.approverUserId] : undefined);
    const idsByBranch = new Map<string, string[]>();
    for (const row of rows) {
      const step = stepOf.get(row.id);
      const ids = step && candidates(step);
      if (ids) idsByBranch.set(row.branchId ?? '', [...(idsByBranch.get(row.branchId ?? '') ?? []), ...ids]);
    }
    // One lookup per branch, same as the approval queue: branch responsibility decides who can still act.
    const activeByBranch = new Map(await Promise.all([...idsByBranch].map(async ([branch, ids]) =>
      [branch, await this.repo.findActiveApproverUserIds(ctx.companyId, ids, branch || undefined)] as const)));

    const desk = (kind: keyof typeof BACKLOG_DESK_LABELS) => ({ key: kind, kind, label: BACKLOG_DESK_LABELS[kind], note: BACKLOG_DESK_NOTES[kind] });
    const pile = { key: 'pile' };
    const deskOf = (row: ReimbursementRequestRecord): { key: string; kind?: BacklogDeskKind; label?: string; note?: string; approverUserId?: string } => {
      // Being cancelled: approval and payment are refused meanwhile, so it waits for no approver and no payer
      // (audit B3). The web's desk rule (`currentDesk`) says the same of it.
      if (row.cancellationPendingAt) return desk('status_pending');
      const current = currentDesk({ status: row.status, financeReviewStatus: row.financeReviewStatus });
      if (current?.kind === 'PAYMENT' && claimDuplicateBlocksPayment(row, currentPolicy)) {
        const cancellation = reimbursementDuplicateWait({ status: row.status, duplicateReasons: claimDuplicateReasons(row), currentDesk: current });
        return { ...desk('duplicate_blocked'), ...(cancellation ? { key: `confirmed_duplicate:${cancellation.actor}`, note: cancellation.waiting } : {}) };
      }
      if (row.status !== 'PENDING_APPROVAL') {
        return currentDesk({ status: row.status, financeReviewStatus: row.financeReviewStatus })?.kind === 'FINANCE' ? desk('finance') : desk('payment');
      }
      // With its requester, and no step open by design: not a decided claim the system has yet to move on. Its
      // desk is named for what the claim holds: an account to correct, one to add, or the method to choose again.
      if (payoutCorrectionPhase(row) === 'AWAITING_REQUESTER') {
        const { order, label, note } = payoutCorrectionRequesterDesk(row);
        return { key: `requester_correction:${order}`, kind: 'requester_correction', label, note };
      }
      const step = stepOf.get(row.id);
      if (!step) return desk('status_pending'); // decided; the status has not moved on yet
      const ids = candidates(step);
      // Legacy role routing: any holder of that role, or the owner, decides it.
      if (!ids) return step.approverRoleSnapshot ? pile : desk('no_active_approver');
      const active = [...new Set(ids)].filter((id) => activeByBranch.get(row.branchId ?? '')?.has(id));
      if (active.length === 1) return { key: `approver:${active[0]}`, approverUserId: active[0] };
      return active.length > 1 ? pile : desk('no_active_approver');
    };
    const deskByRow = new Map(rows.map((row) => [row.id, deskOf(row)]));
    const names = await this.repo.getUserDisplayNames(ctx.companyId,
      [...deskByRow.values()].flatMap((entry) => (entry.approverUserId ? [entry.approverUserId] : [])));

    // Whole Thai days, never hours: the delivery re-read must return the same data (spec §5.0).
    const today = civilDate(now);
    const waitDays = (since: string) => Math.max(0, Math.round((civilDateToUtcDate(today).getTime() - civilDateToUtcDate(since).getTime()) / 86_400_000));
    type Acc = { label: string; kind?: BacklogDeskKind; note?: string; approver: boolean; approved: boolean; count: number; totals: Map<string, Money>; oldest: string };
    const groups = new Map<string, Acc>();
    const overall = new Map<string, Money>();
    const items = rows.map((row) => {
      const entry = deskByRow.get(row.id)!;
      const approved = entry.kind === 'finance' || entry.kind === 'payment' || entry.kind === 'duplicate_blocked';
      const submittedOn = civilDate(row.submittedAt ?? row.createdAt);
      const approvedOn = approved ? civilDate(row.approvedAt ?? row.submittedAt ?? row.createdAt) : undefined;
      // A round's wait is its own: since the send-back while with the requester, since the new account for its
      // approvers. The claim says which day that is, so its wait reads true beside the day it was first sent.
      const phase = entry.kind === 'status_pending' ? undefined : payoutCorrectionPhase(row);
      const round = phase === 'AWAITING_REQUESTER' && row.payoutCorrectionRequestedAt ? { sentBackOn: civilDate(row.payoutCorrectionRequestedAt) }
        : phase === 'AWAITING_APPROVAL' && row.payoutCorrectionSubmittedAt ? { resubmittedOn: civilDate(row.payoutCorrectionSubmittedAt) } : undefined;
      const since = approvedOn ?? round?.sentBackOn ?? round?.resubmittedOn ?? submittedOn;
      const label = entry.approverUserId ? names[entry.approverUserId] ?? REIMBURSEMENT_DESK_LABELS.APPROVER : entry.label ?? SHARED_PILE_LABEL;
      const group = groups.get(entry.key) ?? { label, kind: entry.kind, note: entry.note, approver: !!entry.approverUserId, approved, count: 0, totals: new Map(), oldest: since };
      group.count += 1;
      if (since < group.oldest) group.oldest = since;
      addMoney(group.totals, row.currency, row.outstandingAmount);
      addMoney(overall, row.currency, row.outstandingAmount);
      groups.set(entry.key, group);
      return { id: row.id, documentNumber: row.requestNo ?? null, requesterName: row.requesterDisplayNameSnapshot,
        amount: d(row.outstandingAmount).toFixed(2), currency: row.currency, waitingOn: label, submittedOn,
        ...(approvedOn ? { approvedOn } : {}), ...round, waitDays: waitDays(since) };
    });
    const summary = (group: Acc, kind?: BacklogDeskKind): BacklogGroup => ({ count: group.count, totalsByCurrency: moneyList(group.totals),
      ...(group.approved ? { oldestApprovedOn: group.oldest } : kind === 'requester_correction' ? { oldestSentBackOn: group.oldest } : { oldestSubmittedOn: group.oldest }),
      longestWaitDays: waitDays(group.oldest) });
    const all = [...groups.values()];
    const shared = groups.get('pile');
    // Eval R-20: a manager with no claims heard "all of yours were processed"; nothing waiting and nothing on record differ.
    const hasOwnClaims = mine && rows.length === 0
      ? (await this.repo.listRequests({ companyId: ctx.companyId, requesterUserId: ctx.userId, scopes: ctx.scopes ?? {}, take: 1 })).length > 0
      : undefined;

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.ai_tool.read',
      targetType: 'reimbursement_approval_backlog', requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return {
      accessScope: mine ? 'own' : canReadAll ? 'company' : 'related',
      total: rows.length,
      awaitingApprovalCount: [...deskByRow.values()].filter((entry) => entry.approverUserId || entry.key === 'pile' || entry.kind === 'no_active_approver').length,
      totalsByCurrency: moneyList(overall),
      byApprover: all.filter((group) => group.approver).map((group) => ({ name: group.label, ...summary(group) }))
        .sort((a, b) => b.count - a.count || b.longestWaitDays - a.longestWaitDays || a.name.localeCompare(b.name, 'th')),
      sharedPile: shared ? { label: shared.label, ...summary(shared) } : null,
      // One row per desk, and for claims with their requester one row per label, in the order of what a claim can hold.
      desks: BACKLOG_DESK_KINDS.flatMap((kind) => [...groups].filter(([, group]) => group.kind === kind).sort(([a], [b]) => a.localeCompare(b))
        .map(([, group]) => ({ kind, label: group.label, ...summary(group, kind), ...(group.note ? { note: group.note } : {}) }))),
      items: items.sort((a, b) => b.waitDays - a.waitDays || a.submittedOn.localeCompare(b.submittedOn)
        || (a.documentNumber ?? a.id).localeCompare(b.documentNumber ?? b.id)).slice(0, 10),
      ...(hasOwnClaims !== undefined ? { hasOwnClaims } : {}),
    };
  }
}
