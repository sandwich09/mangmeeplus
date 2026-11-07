import { lineControlData, lineDisplayDate, type LineReplyLanguage } from '../domain/logic/line-language.logic';
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RequestContext } from '@watchdog-bms/contracts';
import { absoluteWebLink } from '../../../common/http/web-link';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { isBranchInScope } from '../../data-model-core/domain/logic/branch.logic';
import { LineDraftPreviewStore } from '../../expenses/application/services/line-draft-preview.store';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { LineSubstituteReceiptContinuationUseCase, substituteReceiptFactLines, type LineSubstituteReceiptContinuation, type LineSubstituteReceiptContinuationResult } from '../../expenses/application/use-cases/line-substitute-receipt-continuation.use-case';
import { ListMySubstituteReceiptSignaturesUseCase } from '../../expenses/application/use-cases/substitute-receipt.use-case';
import { SELF_APPROVAL_EXEMPT_ROLES } from '../../procurement/domain/logic/procurement.logic';
import type { ExpenseRecordWithRelations } from '../../expenses/domain/models/expense.model';
import type { ExpenseActionControl } from './line-expense-action.service';
import type { LineReplyMessage } from '../infrastructure/line-reply.adapter';
import { asCompleteLineCard } from '../domain/logic/line-business-card.logic';
import { formatThaiDate } from '../domain/logic/line-draft-update-card.logic';

export type SubstituteActionPreview = { language?: LineReplyLanguage; token: string; expiresAt: string; label: string; summary: string; webPath: string; webOnly?: boolean };
type StoredAction = {
  previewId: string; companyId: string; userId: string; membershipId: string; chatKeyHash: string;
  conversationId: string; ownerEpoch: number; expenseId: string; branchId: string | null;
  revision: string; digest: string; action: 'PREPARE' | 'WEB_LINK';
  decision?: 'ISSUE' | 'FORM';
  applied?: { revision: string; digest: string };
  preview: SubstituteActionPreview;
};
const EXPIRED = 'การ์ดนี้ใช้ไม่ได้แล้วค่ะ พิมพ์ “ทำใบรับรองต่อ” เพื่อขอการ์ดล่าสุด';
const CHANGED = 'ข้อมูลใบรับรองเปลี่ยนแล้วค่ะ พิมพ์ “ทำใบรับรองต่อ” เพื่อตรวจและยืนยันอีกครั้ง';
const signatureAsk = 'ส่งรูปลายเซ็นเข้ามาในแชทนี้ได้เลยค่ะ';
function stateOf(expense: ExpenseRecordWithRelations) {
  return expense.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation as LineSubstituteReceiptContinuation | undefined;
}
function digest(expense: ExpenseRecordWithRelations, decision?: 'ISSUE' | 'FORM') {
  return createHash('sha256').update(JSON.stringify([decision, stateOf(expense)?.acceptedValues, expense.substituteReceiptEvidence, expense.attachments])).digest('hex');
}

/** LINE prepares through the existing use case; signing and approval continue in the web hub. */
@Injectable()
export class LineSubstituteReceiptActionService {
  private readonly store: LineDraftPreviewStore<StoredAction>;
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly repo: PrismaExpenseRepository,
    private readonly continuation: LineSubstituteReceiptContinuationUseCase,
    private readonly queue: ListMySubstituteReceiptSignaturesUseCase,
  ) { this.store = new LineDraftPreviewStore<StoredAction>(config); }

  private key(chat: string) { return `substitute-action:${chat}`; }
  private owner(ctx: RequestContext, chat: string) {
    return this.prisma.client.aiConversation.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, chatKeyHash: chat, channelKind: 'USER', channel: 'line' } });
  }
  private sign(entry: StoredAction) {
    if (!this.config.aiGatewayInternalSecret) throw new ForbiddenException();
    const { applied: _applied, ...signed } = entry;
    return createHmac('sha256', this.config.aiGatewayInternalSecret).update('line-substitute-action-v1\0')
      .update(JSON.stringify({ ...signed, preview: { ...entry.preview, token: '' } })).digest('base64url');
  }
  private async bound(ctx: RequestContext, chat: string, entry: StoredAction, token: string) {
    if (entry.action === 'PREPARE' && !['ISSUE', 'FORM'].includes(entry.decision ?? '')) return false;
    if (ctx.authProvider !== 'line' || entry.companyId !== ctx.companyId || entry.userId !== ctx.userId
      || entry.membershipId !== ctx.membershipId || entry.chatKeyHash !== this.key(chat)
      || !isBranchInScope(ctx.scopes ?? {}, entry.branchId) || Date.parse(entry.preview.expiresAt) <= Date.now()) return false;
    const owner = await this.owner(ctx, chat);
    if (!owner || owner.id !== entry.conversationId || owner.lifecycleEpoch !== entry.ownerEpoch) return false;
    const expected = `${entry.previewId}.${this.sign(entry)}`;
    return expected.length === token.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }
  private async canApprove(ctx: RequestContext, expense: ExpenseRecordWithRelations) {
    if (!ctx.permissions.includes('expense.confirm')) return false;
    const evidence = expense.substituteReceiptEvidence!;
    if (evidence.correctionOfEvidenceId) {
      const original = await this.repo.findSubstituteEvidence(ctx.companyId, expense.id, evidence.correctionOfEvidenceId);
      if (original?.approverUserId !== ctx.userId) return false;
    }
    const policy = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const mode = policy?.approvalMode ?? 'OWNER_SELF';
    if (evidence.payerUserId === ctx.userId && (mode !== 'OWNER_SELF'
      || !ctx.roles.some(role => SELF_APPROVAL_EXEMPT_ROLES.includes(role)))) return false;
    const eligible = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId, expense.branchId);
    return eligible.some(item => item.userId === ctx.userId)
      && (mode !== 'DESIGNATED_APPROVERS' || policy!.approverUserIds.includes(ctx.userId));
  }

  async resume(ctx: RequestContext, chat: string, message: string, language: LineReplyLanguage = 'th'): Promise<{ preview?: SubstituteActionPreview; reply?: string } | null> {
    const match = /^(?:ลงนามใบรับรอง(?:แทนใบเสร็จ)?|อนุมัติใบรับรอง(?:แทนใบเสร็จ)?|ทำใบรับรองต่อ)(?:\s+(\S+))?$/u.exec(message.trim());
    if (!match) return null;
    const queue = await this.queue.execute(ctx, { limit: 10 });
    const items = [...(queue.asPayer?.items ?? []), ...(queue.asApprover?.items ?? [])];
    const selected = match[1] ? items.find(item => item.documentNumber === match[1]) : items.length === 1 ? items[0] : undefined;
    if (!selected) return items.length > 1 ? { reply: (language === 'en' ? `Choose a document to continue on the web:\n${items.map(item => `${item.documentNumber} · ${item.payeeName} · ${item.amount} THB`).join('\n')}` : `เลือกใบที่ต้องการแล้วพิมพ์ “ลงนามใบรับรอง” ตามด้วยเลขที่เอกสารค่ะ\n${items.map(item => `${item.documentNumber} · ${item.payeeName} · ${item.amount} บาท`).join('\n')}`) } : null;
    const row = await this.prisma.client.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: ctx.companyId,
      documentNumber: selected.documentNumber }, select: { expenseId: true } });
    if (!row) return { reply: language === 'en' ? 'The expense changed; please check the latest details before continuing.' : CHANGED };
    const next = await this.prepare(ctx, chat, row.expenseId, language);
    return next.preview || next.reply ? next : null;
  }

  async prepare(ctx: RequestContext, chat: string, expenseId: string, language: LineReplyLanguage = 'th', decision: 'ISSUE' | 'FORM' = 'ISSUE'): Promise<{ preview?: SubstituteActionPreview; reply?: string }> {
    const en = language === 'en';
    if (ctx.authProvider !== 'line') return {};
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, expenseId, undefined, ctx.scopes ?? {});
    if (!expense || !isBranchInScope(ctx.scopes ?? {}, expense.branchId)) return {};
    const evidence = expense.substituteReceiptEvidence;
    const state = stateOf(expense);
    const webPath = absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${evidence?.id ?? `new?expenseId=${encodeURIComponent(expense.id)}${state?.workflowId ? `&workflow=${encodeURIComponent(state.workflowId)}` : ''}`}`);
    if (evidence?.status === 'ISSUED') return { reply: en ? `The substitute receipt has been issued; open it on the web: ${webPath}` : `ออกใบรับรองแล้วค่ะ เปิดเอกสารได้ที่ ${webPath}\nพิมพ์ “ยืนยันรายการนี้” เพื่อทำค่าใช้จ่ายต่อค่ะ` };
    let action: StoredAction['action'];
    let label: string;
    let summary: string;
    if (!evidence || evidence.status === 'SUPERSEDED') {
      if (!ctx.permissions.includes('expense.review') || state?.status !== 'OPEN' || state.pendingDecision !== 'ISSUE_CONFIRM'
        || state.userId !== ctx.userId || state.companyId !== ctx.companyId || state.chatKeyHash !== chat
        || state.targetRevision !== expense.updatedAt.toISOString()) return {};
      if (decision === 'ISSUE' && state.signatureRequested && !await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId)) return { reply: en ? 'Please send your signature photo here.' : signatureAsk };
      action = 'PREPARE';
      label = decision === 'FORM' ? en ? 'Prepare paper form' : 'เตรียมแบบไปเซ็น' : en ? 'Prepare document' : 'เตรียมใบรับรอง';
      summary = en ? 'Review the details before preparing the document.' : 'ตรวจข้อมูลก่อนกดเตรียมเอกสารค่ะ';
    } else {
      const approver = await this.canApprove(ctx, expense);
      if (evidence.payerUserId !== ctx.userId && !ctx.permissions.includes('expense.review') && !approver) return {};
      action = 'WEB_LINK';
      label = (evidence.status !== 'PREPARED' || evidence.payerUserId !== ctx.userId) && approver
        ? en ? 'Approve on web' : 'เปิดอนุมัติในเว็บ' : en ? 'Sign on web' : 'เปิดลงนามในเว็บ';
      summary = en ? 'The substitute receipt is prepared; sign and approve it on the web.' : 'เตรียมใบรับรองแล้วค่ะ เปิดเว็บเพื่อลงนามและอนุมัติ';
    }
    const owner = await this.owner(ctx, chat);
    if (!owner || !this.store.available || !this.config.aiGatewayInternalSecret) return { reply: (language === 'en' ? 'I could not prepare the confirmation card; please try again.' : 'ยังเตรียมการ์ดยืนยันไม่ได้ค่ะ กรุณาลองใหม่อีกครั้ง') };
    const preview: SubstituteActionPreview = { language, token: '', expiresAt: new Date(Date.now() + 600_000).toISOString(), label,
      ...(action === 'WEB_LINK' ? { webOnly: true } : {}), summary: [summary, `${en ? 'Payee' : 'ผู้รับเงิน'}: ${(action === 'PREPARE' ? state?.acceptedValues.payeeName : evidence?.payeeName) ?? expense.vendorNameSnapshot ?? '-'}`,
        `${en ? 'Amount' : 'ยอด'}: ${expense.grandTotalAmount} ${en ? 'THB' : 'บาท'}`,
        ...(evidence ? [`${en ? 'Reason' : 'เหตุผล'}: ${evidence.missingReceiptReason}`, `${en ? 'Purpose' : 'วัตถุประสงค์'}: ${evidence.businessPurpose}`,
          `${en ? 'Payer' : 'ผู้รับรอง'}: ${evidence.payerName}`, `${en ? 'Funding' : 'แหล่งเงิน'}: ${evidence.fundingSource === 'COMPANY' ? en ? 'Shop funds, paid in full' : 'บริษัทจ่ายเต็มจำนวน' : en ? 'Personal advance, paid in full' : 'พนักงานสำรองจ่ายเต็มจำนวน'}`,
          `${en ? 'Payment method' : 'วิธีจ่าย'}: ${evidence.paymentMethod === 'BANK_TRANSFER' ? en ? 'Bank transfer' : 'โอนเงิน' : evidence.paymentMethod === 'CASH' ? en ? 'Cash' : 'เงินสด' : evidence.paymentMethod === 'CARD' ? en ? 'Card' : 'บัตร' : en ? 'Cheque' : 'เช็ค'}`,
          `${en ? 'Payment date' : 'วันที่จ่าย'}: ${evidence.paymentDate ? lineDisplayDate(evidence.paymentDate, language) : '-'}`] : substituteReceiptFactLines({
          missingReceiptReason: expense.missingReceiptReason ?? undefined,
          paymentMethod: expense.paymentMethod ?? undefined, paymentDate: expense.paidAt?.toISOString().slice(0, 10),
          ...state!.acceptedValues,
        }, await this.repo.listCategories(ctx.companyId), language)),
        ...(action === 'PREPARE' && state?.acceptedValues.expenseCategoryId
          ? [state.acceptedValues.expenseCategoryId === expense.expenseCategoryId
            ? en ? 'The selected category matches the expense.' : 'หมวดที่เลือกตรงกับรายการค่าใช้จ่ายค่ะ'
            : en ? 'The category is still proposed in the draft. The expense has not changed.' : 'หมวดยังอยู่ในร่าง รายการค่าใช้จ่ายยังไม่เปลี่ยนค่ะ'] : []),
        (en ? 'This substitute receipt is not a tax invoice.' : 'ใบรับรองนี้ไม่ใช่ใบกำกับภาษีค่ะ')].join('\n'), webPath };
    const entry: StoredAction = { previewId: `sub_${randomUUID()}`, companyId: ctx.companyId, userId: ctx.userId,
      membershipId: ctx.membershipId, chatKeyHash: this.key(chat), conversationId: owner.id, ownerEpoch: owner.lifecycleEpoch,
      expenseId, branchId: expense.branchId, revision: expense.updatedAt.toISOString(), digest: digest(expense, decision), action, decision,
      preview };
    preview.token = `${entry.previewId}.${this.sign(entry)}`;
    return await this.store.save(entry) ? { preview } : { reply: (language === 'en' ? 'Your earlier request is still processing; please try again shortly.' : 'กำลังดำเนินการคำขอก่อนหน้าค่ะ กรุณาลองอีกครั้ง') };
  }

  async current(ctx: RequestContext, chat: string, token: string, applied = false) {
    const entry = applied ? await this.store.loadApplied(ctx.companyId, this.key(chat)) : await this.store.load(ctx.companyId, this.key(chat));
    if (!entry || !await this.bound(ctx, chat, entry, token)) return false;
    const expense = await this.repo.findByIdWithRelations(ctx.companyId, entry.expenseId, undefined, ctx.scopes ?? {});
    if (!expense || expense.updatedAt.toISOString() !== (applied ? entry.applied?.revision : entry.revision)
      || digest(expense, entry.decision) !== (applied ? entry.applied?.digest : entry.digest)) return false;
    if (entry.action === 'PREPARE') return ctx.permissions.includes('expense.review');
    return entry.action === 'WEB_LINK' && (expense.substituteReceiptEvidence?.payerUserId === ctx.userId
      || ctx.permissions.includes('expense.review') || await this.canApprove(ctx, expense));
  }

  async pending(ctx: RequestContext, chat: string, token: string, applied = false): Promise<SubstituteActionPreview | null> {
    if (!await this.current(ctx, chat, token, applied)) return null;
    return (applied ? await this.store.loadApplied(ctx.companyId, this.key(chat)) : await this.store.load(ctx.companyId, this.key(chat)))?.preview ?? null;
  }

  async quoteRecords(ctx: RequestContext, chat: string, token: string, applied = false): Promise<Array<{ tool: 'expense.get_detail'; id: string }>> {
    if (!await this.current(ctx, chat, token, applied)) return [];
    const entry = applied ? await this.store.loadApplied(ctx.companyId, this.key(chat)) : await this.store.load(ctx.companyId, this.key(chat));
    return entry ? [{ tool: 'expense.get_detail', id: entry.expenseId }] : [];
  }

  webHandoff(ctx: RequestContext, language: LineReplyLanguage = 'th'): SubstituteActionPreview {
    if (language === 'en') return { token: '', expiresAt: new Date(Date.now() + 600_000).toISOString(), label: 'Open substitute receipts', summary: 'Review, sign and approve substitute receipts in the web app.', webOnly: true, webPath: absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts`) };
    return { token: '', expiresAt: new Date(Date.now() + 600_000).toISOString(), webOnly: true,
      label: ctx.permissions.includes('expense.confirm') ? 'เปิดอนุมัติในเว็บ' : 'เปิดลงนามในเว็บ',
      summary: 'เปิดเว็บเพื่อลงนามและอนุมัติใบรับรองค่ะ',
      webPath: absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts`) };
  }

  async apply(ctx: RequestContext, chat: string, control: ExpenseActionControl, language: LineReplyLanguage = 'th'): Promise<{ reply: string; expenseId?: string; preview?: SubstituteActionPreview; refused?: true }> {
    if (!['expense_action_confirm', 'expense_action_cancel'].includes(control.action)) return { refused: true, reply: language === 'en' ? 'This proposal expired; please prepare a fresh card.' : EXPIRED };
    const claim = await this.store.claimCurrent(ctx.companyId, this.key(chat), control.token.split('.')[0]!);
    if (!claim) { const preview = this.webHandoff(ctx, language); return { reply: preview.summary, preview, refused: true }; }
    const entry = claim.entry;
    try {
      if (entry.action === 'PREPARE' && !entry.decision) return { refused: true, reply: language === 'en' ? 'Request a fresh preparation card.' : EXPIRED };
      if (!await this.bound(ctx, chat, entry, control.token)) { const preview = this.webHandoff(ctx, language); return { reply: preview.summary, preview, refused: true }; }
      // Old sign/approve cards are navigation only, even if their source revision has changed.
      if (entry.action !== 'PREPARE') {
        const expense = await this.repo.findByIdWithRelations(ctx.companyId, entry.expenseId, undefined, ctx.scopes ?? {});
        const preview = this.webHandoff(ctx, language);
        if (expense && isBranchInScope(ctx.scopes ?? {}, expense.branchId) && expense.substituteReceiptEvidence) {
          preview.webPath = absoluteWebLink(this.config.webBaseUrl, `/companies/${ctx.companyId}/expenses/substitute-receipts/${expense.substituteReceiptEvidence.id}`);
          preview.label = (expense.substituteReceiptEvidence.status !== 'PREPARED' || expense.substituteReceiptEvidence.payerUserId !== ctx.userId)
            && await this.canApprove(ctx, expense)
            ? (language === 'en' ? 'Approve on web' : 'เปิดอนุมัติในเว็บ') : (language === 'en' ? 'Sign on web' : 'เปิดลงนามในเว็บ');
        }
        return { reply: preview.summary, preview };
      }
      if (control.action === 'expense_action_cancel') {
        await this.store.discard(ctx.companyId, this.key(chat)); return { reply: (language === 'en' ? 'This step was cancelled; the existing details are retained.' : 'ยังไม่ทำขั้นตอนนี้ค่ะ ข้อมูลเดิมยังอยู่') };
      }
      const expense = await this.repo.findByIdWithRelations(ctx.companyId, entry.expenseId, undefined, ctx.scopes ?? {});
      if (!expense || expense.updatedAt.toISOString() !== entry.revision || digest(expense, entry.decision) !== entry.digest) return { reply: language === 'en' ? 'The expense changed; please check the latest details before continuing.' : CHANGED };
      if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException();
      const result = await this.continuation.execute(ctx, { language, messageText: entry.decision === 'FORM' ? '2' : '1', confirmedDecision: entry.decision, chatKeyHash: chat,
        recentCandidates: [{ id: expense.id, label: 'รายการนี้' }], boundCandidateExpenseIds: [expense.id], webBaseUrl: this.config.webBaseUrl });
      const reply = result.replyText;
      if (result.blockers.some(item => item.code === 'reusable_signature_required')) {
        await this.store.discard(ctx.companyId, this.key(chat));
        return { reply };
      }
      const after = await this.repo.findByIdWithRelations(ctx.companyId, expense.id, undefined, ctx.scopes ?? {});
      if (!after) throw new ConflictException();
      entry.applied = { revision: after.updatedAt.toISOString(), digest: digest(after, entry.decision) };
      await this.store.remember(ctx.companyId, this.key(chat), entry);
      await this.store.discard(ctx.companyId, this.key(chat));
      return { reply, expenseId: expense.id, preview: entry.preview };
    } catch (error) {
      return { reply: error instanceof ForbiddenException ? (language === 'en' ? 'Ask a signer authorized by your shop to complete this step.' : 'คุณไม่มีสิทธิ์ทำขั้นตอนนี้ค่ะ ให้ผู้ลงนามที่บริษัทอนุญาตดำเนินการ')
        : error instanceof ConflictException ? (language === 'en' ? 'This expense changed; review its current details before continuing.' : CHANGED) : (language === 'en' ? 'This step did not finish; say “resume substitute receipt” to check its current state.' : 'ยังดำเนินการไม่สำเร็จค่ะ พิมพ์ “ทำใบรับรองต่อ” เพื่อตรวจข้อมูลล่าสุด') };
    } finally { await this.store.releaseClaim(ctx.companyId, this.key(chat), claim.token); }
  }
}

export function buildSubstituteReceiptActionCard(preview: SubstituteActionPreview, text = preview.summary, applied = false, language: LineReplyLanguage = preview.language ?? 'th'): LineReplyMessage {
  return asCompleteLineCard({ type: 'flex', altText: language === 'en' ? preview.webOnly ? 'Continue on web' : 'Prepare substitute receipt' : preview.label, canonicalText: text, contents: { type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      ...text.replace(/https?:\/\/[^\s]+/gu, '').split('\n').filter(line => line.trim())
        .map(text => ({ type: 'text', text, wrap: true })),
      ...(!applied && !preview.webOnly ? [{ type: 'text', text: language === 'en' ? 'View document' : 'ดูเอกสาร', color: '#157B56', action: { type: 'uri', uri: preview.webPath } }] : []),
    ] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      ...(applied || preview.webOnly ? [] : (['expense_action_confirm', 'expense_action_cancel'] as const).map((action, i) => ({ type: 'button', style: i === 0 ? 'primary' : 'secondary',
        action: { type: 'postback', label: i === 0 ? preview.label : language === 'en' ? 'Cancel action' : 'ยังไม่ทำ', data: lineControlData(new URLSearchParams({ action, token: preview.token }).toString(), language) } }))),
      ...(applied || preview.webOnly ? [{ type: 'button', style: 'primary', action: { type: 'uri', label: language === 'en' ? preview.webOnly ? 'Continue on web' : 'View document' : preview.webOnly ? preview.label : 'ดูเอกสาร', uri: preview.webPath } }] : []),
    ] },
  } });
}

export function buildSubstituteReceiptFactsCard(result: LineSubstituteReceiptContinuationResult, text = result.replyText, language: LineReplyLanguage = 'th'): LineReplyMessage | undefined {
  if (result.status !== 'BLOCKED' || !result.webPath || !result.blockers.some(item => item.code === 'payer_required')) return undefined;
  const self = { type: 'message' as const, label: language === 'en' ? 'I am the payer' : 'ฉันเป็นผู้จ่าย', text: language === 'en' ? 'I am the payer' : 'ฉันเป็นผู้จ่าย' };
  const other = { type: 'uri' as const, label: language === 'en' ? 'Choose another member' : 'เลือกสมาชิกคนอื่น', uri: result.webPath };
  return asCompleteLineCard({ type: 'flex', altText: language === 'en' ? 'Review details and choose the payer' : 'ตรวจข้อมูลและเลือกผู้รับรองการจ่ายค่ะ', canonicalText: text,
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents:
      text.replace(/https?:\/\/[^\s]+/gu, '').split('\n').filter(line => line.trim()).map(text => ({ type: 'text', text, wrap: true })) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [self, other].map((action, index) => ({
      type: 'button', style: index === 0 ? 'primary' : 'secondary', action,
    })) } } });
}
