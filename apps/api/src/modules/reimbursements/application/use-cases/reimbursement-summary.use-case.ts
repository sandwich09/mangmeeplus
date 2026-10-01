import { Injectable, ForbiddenException } from '@nestjs/common';
import { civilDate, civilDateToUtcDate, REIMBURSEMENT_DESK_LABELS, type RequestContext, type ReimbursementAiSummary } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { ageHours, isSlaRisk, d, decStr, currentDesk } from '../../domain/logic/reimbursement.logic';
import type { ReimbursementApprovalStepRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';

/**
 * Read-only summary for LINE/AI. Enforces the same permissions as web and can never
 * mutate. Callers with only reimbursement.read_own are scoped to their own requests.
 */
@Injectable()
export class GetReimbursementAiSummaryUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext): Promise<ReimbursementAiSummary> {
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadOwn = ctx.permissions.includes('reimbursement.read_own');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read reimbursements');

    const requesterUserId = canReadAll || canReadRelated ? undefined : ctx.userId;
    const relatedUserId = !canReadAll && canReadRelated ? ctx.userId : undefined;
    const currentPolicy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const all = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId,
      relatedUserId,
      scopes: ctx.scopes ?? {},
    });
    const now = new Date();

    let pendingApproval = 0;
    let overdueApproval = 0;
    let unpaidApproved = 0;
    let totalUnpaid = d('0');

    for (const r of all) {
      if (r.status === 'PENDING_APPROVAL') {
        const policy = effectivePolicyForRequest(r, currentPolicy);
        pendingApproval++;
        const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
        if (isSlaRisk(age, policy.slaHours)) overdueApproval++;
      }
      if ((r.status === 'FINANCE_REVIEW' || r.status === 'READY_FOR_PAYMENT' || r.status === 'PARTIALLY_PAID') && r.paymentStatus !== 'PAID') {
        unpaidApproved++;
        totalUnpaid = totalUnpaid.add(d(r.outstandingAmount));
      }
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.ai_tool.read',
      targetType: 'reimbursement_summary', requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return {
      pendingApprovalCount: pendingApproval,
      unpaidApprovedCount: unpaidApproved,
      overdueApprovalCount: overdueApproval,
      totalUnpaidAmount: decStr(totalUnpaid),
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
  no_active_approver: 'ไม่มีผู้อนุมัติที่ยังใช้งานอยู่',
  status_pending: 'รอระบบปรับสถานะ',
} as const;
export const SHARED_PILE_LABEL = 'กองกลาง (อนุมัติได้หลายคน)';
/** The recovery rule (`frozenApprovalAuthority` FALLBACK → `matchesApproverRole`), so the answer names the real next
 *  step instead of guessing one (eval 2026-09-30: "ติดต่อทีม HR", "จะค้างไม่มีกำหนด"). */
export const NO_ACTIVE_APPROVER_NOTE = 'ผู้ที่ถูกกำหนดให้อนุมัติไม่อยู่หรือไม่ได้ดูแลสาขานี้แล้ว เจ้าของร้านหรือผู้มีบทบาทอนุมัติเดิมอนุมัติแทนได้บนเว็บ';

type BacklogDeskKind = keyof typeof BACKLOG_DESK_LABELS;
type BacklogMoney = { currency: string; amount: string };
/** Approval-stage waits count from `submittedAt`; finance and payment have no arrival time, so from `approvedAt`. */
type BacklogGroup = { count: number; totalsByCurrency: BacklogMoney[]; oldestSubmittedOn?: string; oldestApprovedOn?: string; longestWaitDays: number };
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
    waitingOn: string; submittedOn: string; approvedOn?: string; waitDays: number }>;
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
    const rows = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId: mine ? ctx.userId : undefined,
      relatedUserId: !mine && !canReadAll ? ctx.userId : undefined,
      scopes: ctx.scopes ?? {},
      statuses: BACKLOG_STATUSES,
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

    const desk = (kind: BacklogDeskKind) => ({ key: kind, kind });
    const pile = { key: 'pile' };
    const deskOf = (row: ReimbursementRequestRecord): { key: string; kind?: BacklogDeskKind; approverUserId?: string } => {
      if (row.status !== 'PENDING_APPROVAL') {
        return currentDesk({ status: row.status, financeReviewStatus: row.financeReviewStatus })?.kind === 'FINANCE' ? desk('finance') : desk('payment');
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
    type Acc = { label: string; approver: boolean; approved: boolean; count: number; totals: Map<string, Money>; oldest: string };
    const groups = new Map<string, Acc>();
    const overall = new Map<string, Money>();
    const items = rows.map((row) => {
      const entry = deskByRow.get(row.id)!;
      const approved = entry.kind === 'finance' || entry.kind === 'payment';
      const submittedOn = civilDate(row.submittedAt ?? row.createdAt);
      const approvedOn = approved ? civilDate(row.approvedAt ?? row.submittedAt ?? row.createdAt) : undefined;
      const since = approvedOn ?? submittedOn;
      const label = entry.approverUserId ? names[entry.approverUserId] ?? REIMBURSEMENT_DESK_LABELS.APPROVER
        : entry.kind ? BACKLOG_DESK_LABELS[entry.kind] : SHARED_PILE_LABEL;
      const group = groups.get(entry.key) ?? { label, approver: !!entry.approverUserId, approved, count: 0, totals: new Map(), oldest: since };
      group.count += 1;
      if (since < group.oldest) group.oldest = since;
      addMoney(group.totals, row.currency, row.outstandingAmount);
      addMoney(overall, row.currency, row.outstandingAmount);
      groups.set(entry.key, group);
      return { id: row.id, documentNumber: row.requestNo ?? null, requesterName: row.requesterDisplayNameSnapshot,
        amount: d(row.outstandingAmount).toFixed(2), currency: row.currency, waitingOn: label, submittedOn,
        ...(approvedOn ? { approvedOn } : {}), waitDays: waitDays(since) };
    });
    const summary = (group: Acc): BacklogGroup => ({ count: group.count, totalsByCurrency: moneyList(group.totals),
      ...(group.approved ? { oldestApprovedOn: group.oldest } : { oldestSubmittedOn: group.oldest }), longestWaitDays: waitDays(group.oldest) });
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
      desks: (Object.keys(BACKLOG_DESK_LABELS) as BacklogDeskKind[]).flatMap((kind) => {
        const group = groups.get(kind);
        return group ? [{ kind, label: group.label, ...summary(group), ...(kind === 'no_active_approver' ? { note: NO_ACTIVE_APPROVER_NOTE } : {}) }] : [];
      }),
      items: items.sort((a, b) => b.waitDays - a.waitDays || a.submittedOn.localeCompare(b.submittedOn)
        || (a.documentNumber ?? a.id).localeCompare(b.documentNumber ?? b.id)).slice(0, 10),
      ...(hasOwnClaims !== undefined ? { hasOwnClaims } : {}),
    };
  }
}
