import { LINE_TOOL_REGISTRY, lineReplyLanguage, hasToolPermissions, hasToolFeature, isCivilDate, todayCivilDate, civilPeriodKey, type LineAiTurnRequest, type SpecialistOutput, type ToolMeta, type ToolResult } from '@watchdog-bms/contracts';
import type { ErpToolContext } from '../infrastructure/erp-tool.client';
import { productHelpAction } from './approved-product-help';

export const DOCUMENT_ADVISOR_READ_TOOLS = new Set(['voucher.list_recent', 'voucher.get_detail', 'wht.get_month_summary', 'wht.calculate_withholding']);

/** These answers are computed by permission-checked ERP reads, including money and ask-backs. */
export function documentAdvisorReadText(results: Pick<ToolResult, 'toolName' | 'status' | 'data'>[]): string | undefined {
  if (!results.length || results.some(r => r.status !== 'ok' || !DOCUMENT_ADVISOR_READ_TOOLS.has(r.toolName))) return undefined;
  const messages = results.map(r => r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>)['message'] : undefined);
  return messages.every(m => typeof m === 'string' && m.trim()) ? [...new Set(messages as string[])].join('\n\n') : undefined;
}

export function documentAdvisorOutputText(outputs: SpecialistOutput[]): string | undefined {
  if (outputs.some(o => o.status !== 'SUCCEEDED')) return undefined;
  return documentAdvisorReadText(outputs.flatMap(o => (o.toolData ?? []).map(d => ({ toolName: d.tool, status: 'ok' as const, data: d.data }))));
}


/** The selected due-date card reads the same ERP tool as the month page, without a model call. */
export async function pnd53DueHelp(req: LineAiTurnRequest, help: NonNullable<ReturnType<typeof productHelpAction>>, ctx: ErpToolContext,
  invoke: (meta: ToolMeta, context: ErpToolContext, args: Record<string, unknown>) => Promise<ToolResult>) {
  if (!help.allowed || help.presentation.cards[0]?.chatActionId !== 'pnd53' || !req.selectedKnowledgeCardIds?.includes('wht.pnd53-due')) return { help };
  const language = req.language ?? lineReplyLanguage(req.messageText, req.responsePreferences?.language);
  const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === 'wht.get_month_summary')!;
  const result = await invoke(meta, { ...ctx, groundingText: req.messageText, locale: language === 'en' ? 'en-GB' : 'th-TH' }, { dueDateOnly: true })
    .catch((): ToolResult => ({ toolName: meta.name, status: 'unavailable', asOf: new Date().toISOString(), sourceRefs: [] }));
  if (result.status === 'forbidden' || result.status === 'unsupported_module') {
    const refusal = productHelpAction({ actionId: 'pnd53', language, companyId: ctx.companyId, packageOffers: req.packageOffers,
      permissions: result.status === 'forbidden' ? ctx.permissions.filter(key => key !== 'wht.pnd53.read') : ctx.permissions,
      featureKeys: result.status === 'unsupported_module' ? (req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys ?? []).filter(key => key !== 'wht_pnd53')
        : req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys ?? null })!;
    return { help: refusal, result };
  }
  const replyText = documentAdvisorReadText([result]) ?? (language === 'en' ? 'The filing date could not be read; please try again.' : 'ยังอ่านวันยื่นไม่ได้ ลองอีกครั้งค่ะ');
  return { help: { ...help, replyText, presentation: { ...help.presentation, cards: help.presentation.cards.map(card => ({ ...card, text: replyText })) } }, result };
}


function helpDate(value: unknown, language: 'th' | 'en'): string | undefined {
  if (!isCivilDate(value)) return undefined;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'th-TH',
    { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
}

export function helpDataSentence(id: string, value: unknown, language: 'th' | 'en'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, any>;
  const en = language === 'en';
  const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (id.startsWith('package.')) {
    if (!data.package || !Object.hasOwn(data.package, 'termEndsOn')) return undefined;
    if (data.package.termEndsOn === null) return en ? 'The shop has no package.' : 'ร้านยังไม่มีแพ็กเกจค่ะ';
    const end = helpDate(data.package.termEndsOn, language);
    if (!end) return undefined;
    if (id !== 'package.quota') return en ? `The shop’s package end date is ${end}.` : `วันสิ้นสุดแพ็กเกจของร้านคือ ${end} ค่ะ`;
    const receipts = data.receipts;
    if (!receipts) return undefined;
    const reset = helpDate(receipts.resetsOn, language);
    if (!Object.hasOwn(receipts, 'resetsOn') || (receipts.resetsOn !== null && !reset)) return undefined;
    const resetText = reset ? en ? ` and the next reset is ${reset}` : ` เริ่มนับใหม่ ${reset} `
      : en ? ', with no reset date in the current data' : ' โดยยังไม่มีวันเริ่มนับใหม่ในข้อมูล';
    if (receipts.limit === null && receipts.remaining === null) return en ? `Receipt reads are unlimited this round${resetText}.` : `รอบนี้อ่านใบเสร็จได้ไม่จำกัดจำนวน${resetText}ค่ะ`;
    if (count(receipts.limit) && count(receipts.remaining)) return en ? `${receipts.remaining} receipt reads remain this round${resetText}.` : `รอบนี้เหลือใบเสร็จ ${receipts.remaining} ใบ${resetText}ค่ะ`;
    return undefined;
  }
  if (id === 'claim.approve' && data.accessScope === 'approver' && count(data.total)) {
    if (!data.total) return en ? 'No claims are waiting for your approval.' : 'ไม่มีใบเบิกรอคุณอนุมัติค่ะ';
    return en ? `${data.total} claims are waiting for your approval.` : `มีใบเบิกรอคุณอนุมัติ ${data.total} ใบค่ะ`;
  }
  if (id === 'notifications.read' && count(data.count) && typeof data.hasMore === 'boolean') {
    if (!data.count && !data.hasMore) return en ? 'You have no open notifications.' : 'ไม่มีการแจ้งเตือนที่ยังเปิดอยู่ค่ะ';
    return en ? `You have ${data.hasMore ? 'at least ' : ''}${data.count} open notifications.`
      : `มีการแจ้งเตือนที่ยังเปิดอยู่${data.hasMore ? 'อย่างน้อย ' : ' '}${data.count} รายการค่ะ`;
  }
  if (id === 'pnd53.prepare' && data.periodKey === civilPeriodKey(todayCivilDate())) {
    const due = helpDate(data.dueDate, language);
    if (!due || !Object.hasOwn(data, 'remittance')) return undefined;
    const status = data.remittance?.status;
    const states: Record<string, [string, string]> = {
      OPEN: ['ยังไม่ได้ยื่น', 'not yet filed'], NEEDS_REVIEW: ['ยังไม่ได้ยื่น', 'not yet filed'], READY_FOR_REVIEW: ['ยังไม่ได้ยื่น', 'not yet filed'],
      REVIEWED: ['ยังไม่ได้ยื่น', 'not yet filed'], AMENDED: ['ยังไม่ได้ยื่น', 'not yet filed'],
      EXPORTED: ['ดาวน์โหลดแบบแล้ว', 'form downloaded'], FILED: ['ยื่นแล้ว', 'filed'], PAID: ['ยื่นแล้ว', 'filed'], CLOSED: ['ยื่นแล้ว', 'filed'],
    };
    const state = data.remittance === null ? en ? 'no monthly record in the system' : 'ยังไม่มีรายการเดือนนี้ในระบบ' : states[status]?.[en ? 1 : 0];
    if (!state) return undefined;
    const month = new Intl.DateTimeFormat(en ? 'en-GB' : 'th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${data.periodKey}-01T00:00:00Z`));
    return en ? `PND53 for ${month}: ${state}, due ${due}.` : `ภ.ง.ด.53 เดือน${month} ${state} กำหนดยื่น ${due} ค่ะ`;
  }
  return undefined;
}

/** General guidance stays available when a permission-checked shop read cannot supply its facts. */
export async function productHelpWithData(req: LineAiTurnRequest, help: NonNullable<ReturnType<typeof productHelpAction>>, ctx: ErpToolContext,
  invoke: (meta: ToolMeta, context: ErpToolContext, args: Record<string, unknown>) => Promise<ToolResult>) {
  if (!help.generalHelp) {
    const due = await pnd53DueHelp(req, help, ctx, invoke);
    return { help: due.help, results: due.result ? [due.result] : [] };
  }
  const language = req.language ?? lineReplyLanguage(req.messageText, req.responsePreferences?.language);
  const featureKeys = req.entitledFeatureKeys ?? req.userContext.entitledFeatureKeys;
  const entitled = featureKeys == null ? null : new Set(featureKeys);
  const reads: Record<string, { tool: string; permission: string; feature?: string; args: Record<string, unknown> }> = {
    'package.quota': { tool: 'billing.get_package_usage', permission: 'company.plan.manage', args: {} },
    'package.renew': { tool: 'billing.get_package_usage', permission: 'company.plan.manage', args: {} },
    'package.expiry': { tool: 'billing.get_package_usage', permission: 'company.plan.manage', args: {} },
    'claim.approve': { tool: 'reimbursement.list_pending_approvals', permission: 'reimbursement.approve', feature: 'reimbursement', args: { approver: 'me' } },
    'notifications.read': { tool: 'notifications.list_open_alerts', permission: 'notification.read', args: {} },
    'pnd53.prepare': { tool: 'wht.get_month_summary', permission: 'wht.pnd53.read', feature: 'wht_pnd53', args: { periodKey: civilPeriodKey(todayCivilDate()) } },
    // voucher.list_recent has no assigned-approver filter, so its company list cannot answer this queue.
  };
  const results: ToolResult[] = [];
  const cards = [];
  for (const [index, card] of help.presentation.cards.entries()) {
    const id = req.selectedKnowledgeCardIds?.[index] ?? '';
    const read = reads[id];
    let text = card.text;
    const meta = read && LINE_TOOL_REGISTRY.find(tool => tool.name === read.tool);
    if (meta && ctx.permissions.includes(read.permission) && hasToolPermissions(meta, ctx.permissions) && hasToolFeature(meta, entitled) && (!read.feature || entitled === null || entitled.has(read.feature))) {
      let result = results.find(result => result.toolName === meta.name);
      if (!result) {
        result = await invoke(meta, { ...ctx, groundingText: req.messageText, locale: language === 'en' ? 'en-GB' : 'th-TH' }, read.args)
          .catch((): ToolResult => ({ toolName: meta.name, status: 'unavailable', asOf: new Date().toISOString(), sourceRefs: [] }));
        results.push(result);
      }
      const sentence = result.status === 'ok' ? helpDataSentence(id, result.data, language) : undefined;
      if (sentence) text = id === 'package.renew' || id === 'package.expiry' ? `${sentence}\n${card.text}` : sentence;
    }
    cards.push({ ...card, text });
  }
  const changed = cards.some((card, index) => card.text !== help.presentation.cards[index]?.text);
  return { help: { ...help, replyText: changed ? cards.map(card => card.text).join('\n\n') : help.replyText, presentation: { ...help.presentation, cards } }, results };
}
