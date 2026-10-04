import { EXECUTIVE_WORDS as W, executiveThaiLabel as thaiLabel } from '@watchdog-bms/contracts';
export { W, thaiLabel };

export const EXECUTIVE_MENU = (['overview', 'usage', 'revenue', 'customers', 'compare', 'companies'] as const).map(key => ({ key, label: W[key], group: W.report, href: key === 'overview' ? '/system/executive' : `/system/executive/${key}` }));
export const REPORT_VIEWS = { usage: [{ value: 'adoption', label: W.adoption }, { value: 'paid', label: W.shortPaidUsage }, { value: 'ranking', label: W.ranking }], revenue: [{ value: 'summary', label: W.purchase }, { value: 'trend', label: W.shortTrend }, { value: 'unmatched', label: W.unmatched }, { value: 'top', label: W.top }], customers: [{ value: 'industry', label: W.industry }, { value: 'discovery', label: W.discovery }, { value: 'sales', label: W.sales }] };
export const DETAIL_TABS = [{ value: 'company', label: W.companyTab }, { value: 'usage', label: W.usageTab }, { value: 'history', label: W.history }];
export const RANK_LABELS = { expenseReceiptCount: { label: W.receiptCount, unit: W.unitReceipt }, activeDays: { label: W.days, unit: W.unitDay }, aiRequests: { label: W.ai, unit: W.unitRequest } };
