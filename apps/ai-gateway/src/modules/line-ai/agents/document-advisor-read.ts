import type { SpecialistOutput, ToolResult } from '@watchdog-bms/contracts';

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
