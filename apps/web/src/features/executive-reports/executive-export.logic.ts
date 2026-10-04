import { EXECUTIVE_WORDS as W, executivePeriodLabel, type ExecutiveContext, type ExecutiveExportBody } from '@watchdog-bms/contracts';
import { apiErrorCode } from '../../common/api/api-error-message';
import { formatThaiDate, formatThaiMonth } from '../../common/i18n/thai-date';
import { reportQuery, reasonText, retryDelaySeconds, type ReportSection } from './executive-reports.logic';

export const canExport = (context: ExecutiveContext | null) => !!context?.capabilities.readReport.allowed && !!context.capabilities.export.allowed;
export const canExportContacts = (section: ReportSection, context: ExecutiveContext | null) => canExport(context) && ['companies', 'detail'].includes(section) && !!context?.capabilities.seeContacts.allowed;
export function exportBody(section: ReportSection, params: URLSearchParams, context: ExecutiveContext, buildId: string, search = '', targetCompanyId?: string, includeContacts = false): ExecutiveExportBody {
  const { from, to, page: _page, pageSize: _pageSize, section: _section, view, metric, dimension, sideA, sideB, sortBy, sortDir, ...filters } = reportQuery(section, params, context, search);
  return { buildId, reportKey: section, from: String(from), to: String(to), filters, format: 'xlsx', includeContacts: includeContacts && canExportContacts(section, context),
    ...(view ? { subview: section === 'customers' && view === 'sales' && params.get('seller') === 'credited' ? 'creditedSales' : String(view) } : {}),
    ...(metric || sortBy ? { sortBy: String(metric ?? sortBy) as ExecutiveExportBody['sortBy'], sortDir: (metric ? 'desc' : sortDir) as 'asc' | 'desc' } : {}),
    ...(section === 'revenue' && view === 'top' ? { sortBy: 'netReceipts', sortDir: 'desc' } : {}),
    ...(section === 'compare' ? { comparison: { dimension: String(dimension), sideA: String(sideA), sideB: String(sideB) } } : {}),
    ...(section === 'detail' ? { targetCompanyId } : {}) };
}
export function exportFileName(section: ReportSection, from: string, now = new Date(), to = from): string {
  const time = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).replace(':', '');
  return `รายงานผู้บริหารมั่งมี-${W[section]}-${executivePeriodLabel(from, to).replaceAll(' ', '')}-ส่งออก-${formatThaiDate(now).replaceAll(' ', '')}-${time}.xlsx`;
}
export type ExportState = { kind: 'preparing' | 'done' | 'error' | 'expired' | 'denied'; text: string; retryAfterSeconds?: number };
/** A request may hand a file to the browser only while its original context still exists. */
export function createExportAction(deps: { request: (body: ExecutiveExportBody, signal: AbortSignal) => Promise<Blob>; download: (blob: Blob, fileName: string) => void; reload: () => void; state: (state: ExportState) => void }) {
  let running = false;
  return { async run(body: ExecutiveExportBody, fileName: string, signal: AbortSignal): Promise<void> {
    if (running || signal.aborted) return;
    running = true; deps.state({ kind: 'preparing', text: W.export.preparing });
    let downloading = false;
    try {
      const blob = await deps.request(body, signal);
      if (signal.aborted) return;
      downloading = true; deps.download(blob, fileName); deps.state({ kind: 'done', text: W.export.done });
    } catch (error) {
      if (signal.aborted) return;
      const code = apiErrorCode(error), expired = code === 'EXECUTIVE_SNAPSHOT_EXPIRED';
      const denied = (error as { status?: number })?.status === 403 || code === 'EXECUTIVE_ACCESS_DENIED';
      deps.state({ kind: expired ? 'expired' : denied ? 'denied' : 'error', text: downloading ? W.export.downloadFailed : expired ? W.export.expired : denied ? W.export.denied : (error as { status?: number })?.status === 429 || code === 'RATE_LIMITED' ? W.export.failed : code ? reasonText(code) : W.export.failed,
        retryAfterSeconds: retryDelaySeconds(error) });
      if (expired) deps.reload();
    } finally { running = false; }
  } };
}
