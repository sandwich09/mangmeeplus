import { currentWithholdingPayments, withholdingPaperPayments } from './withholding-filing-state';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { WhtEstablishment, RequestContext } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { resolveWhtEstablishment, whtPayerModeInForce, type WhtPayerBranch, type WhtPayerModeFact } from '../../domain/logic/wht-payer-mode.logic';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';

export function partitionWithholdingPayments<T extends { branchId?: string | null; eventType?: string }>(events: T[], branches: WhtPayerBranch[], facts: WhtPayerModeFact[], month: string) {
  const mode = whtPayerModeInForce(facts, month);
  const unanswered = !mode && branches.filter(b => b.status === 'ACTIVE').length > 1;
  const papers: { establishment: WhtEstablishment; events: T[] }[] = [];
  const unassigned: T[] = [];
  // N2: each form answers its own paying-branch question.
  const payingBranches = new Map<string | undefined, Set<string | null>>();
  for (const event of events) {
    const ids = payingBranches.get(event.eventType) ?? new Set<string | null>();
    ids.add(event.branchId ?? null); payingBranches.set(event.eventType, ids);
  }
  const ambiguousForms = new Set([...payingBranches].filter(([, ids]) => unanswered && ids.size > 1).map(([form]) => form));
  for (const event of events) {
    let establishment = resolveWhtEstablishment(mode, branches, event.branchId ?? null);
    // S2.2: without an answer preserve the old single-source-branch paper, never guess a mode.
    if (establishment.kind === 'SHOP_HAS_NOT_ANSWERED' && !ambiguousForms.has(event.eventType)) {
      const branch = branches.find(b => b.id === event.branchId);
      establishment = { kind: 'ESTABLISHMENT', code: branch?.taxBranchCode ?? '00000', branchId: branch?.id ?? null,
        name: branch?.type === 'HEAD_OFFICE' || !branch ? 'สำนักงานใหญ่' : branch.name };
    }
    if (establishment.kind !== 'ESTABLISHMENT') { unassigned.push(event); continue; }
    let paper = papers.find(p => p.establishment.code === establishment.code);
    if (!paper) { paper = { establishment, events: [] }; papers.push(paper); }
    paper.events.push(event);
  }
  return { papers: papers.sort((a, b) => a.establishment.code.localeCompare(b.establishment.code)), unassigned, unanswered: ambiguousForms.size > 0 };
}

export async function loadWithholdingEstablishments(db: Prisma.TransactionClient, companyId: string, month: string) {
  const [branches, facts] = await Promise.all([
    db.branch.findMany({ where: { companyId } }),
    db.whtPayerModeFact.findMany({ where: { companyId, supersededAt: null, effectiveFromPeriodKey: { lte: month } } }),
  ]);
  return { branches, facts };
}
export function assertEstablishmentScope(ctx: RequestContext, branchId: string | null) {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) throw new ForbiddenException({ code: 'WHT_ESTABLISHMENT_FORBIDDEN', message: 'ไม่มีสิทธิ์เปิดแบบของสาขานี้ เลือกสาขาที่เปิดได้' });
}
export function selectWithholdingPaper<T extends { branchId?: string | null; eventType?: string }>(ctx: RequestContext,
  partition: ReturnType<typeof partitionWithholdingPayments<T>>, code?: string) {
  if (code !== undefined && !/^\d{5}$/.test(code)) throw new BadRequestException({ code: 'WHT_ESTABLISHMENT_INVALID', message: 'รหัสสาขาภาษีไม่ถูกต้อง เลือกสาขาอีกครั้ง' });
  if (partition.unanswered) throw new ConflictException({ code: 'WHT_PAYER_MODE_REQUIRED', message: 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี' });
  if (!code && partition.papers.length > 1) throw new ConflictException({ code: 'WHT_ESTABLISHMENT_REQUIRED', message: 'เดือนนี้มีหลายสาขาที่ยื่น เลือกสาขาก่อนดาวน์โหลดหรือบันทึกว่ายื่นแล้ว' });
  const paper = code ? partition.papers.find(p => p.establishment.code === code) : partition.papers[0];
  if (paper) assertEstablishmentScope(ctx, paper.establishment.branchId);
  return paper;
}

/** Roll-up is for old readers only; source locks always use the frozen lines. */
export async function rollUpWithholdingPeriod(db: Prisma.TransactionClient, companyId: string, periodId: string, currentEstablishmentCodes?: string[]) {
  const [papers, events] = await Promise.all([
    db.whtFiling.findMany({ where: { companyId, taxPeriodId: periodId }, include: { lines: true } }),
    db.taxEvent.findMany({ where: { companyId, taxPeriodId: periodId, status: 'ACTIVE' }, select: { sourceType: true, sourceId: true, sourceLineKey: true } }),
  ]);
  const key = (e: { sourceType: string; sourceId: string }) => `${e.sourceType}:${e.sourceId}`;
  const covered = new Set(papers.filter(p => p.status === 'FILED').flatMap(p => p.lines.map(key)));
  const relevant = papers.filter(p => p.status === 'FILED' || !currentEstablishmentCodes || currentEstablishmentCodes.includes(p.establishmentCode));
  const current = await currentWithholdingPayments(db, companyId, events);
  const allFiled = relevant.length > 0 && relevant.every(p => p.status === 'FILED') && withholdingPaperPayments(current, papers).length === 0;
  const status = allFiled ? 'FILED' : papers.length ? 'EXPORTED' : 'OPEN';
  await db.taxPeriod.update({ where: { id: periodId, companyId }, data: { status, filedAt: allFiled ? new Date() : null } });
  return status;
}

/** Best-effort certificate prefill; missing mode/code must never prevent recording a payment. */
export async function withholdingPayerPrefill(db: Prisma.TransactionClient, companyId: string, month: string, branchId: string | null, companyAddress: unknown) {
  const { branches, facts } = await loadWithholdingEstablishments(db, companyId, month);
  const resolved = resolveWhtEstablishment(whtPayerModeInForce(facts, month), branches, branchId);
  const owner = branches.find(b => b.id === (resolved.kind === 'ESTABLISHMENT' ? resolved.branchId : branchId));
  return { branchCode: resolved.kind === 'ESTABLISHMENT' ? resolved.code : resolved.kind === 'SHOP_HAS_NOT_ANSWERED' ? owner?.taxBranchCode ?? '00000' : null,
    address: owner?.type === 'HEAD_OFFICE' || !owner ? companyAddress : owner.addressJson ?? companyAddress };
}
