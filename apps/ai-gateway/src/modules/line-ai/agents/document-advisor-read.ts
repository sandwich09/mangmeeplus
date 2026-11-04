import { LINE_TOOL_REGISTRY, lineReplyLanguage, type LineAiTurnRequest, type SpecialistOutput, type ToolMeta, type ToolResult } from '@watchdog-bms/contracts';
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
