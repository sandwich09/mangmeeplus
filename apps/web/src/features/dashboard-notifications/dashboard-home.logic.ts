/** The manual force-generate endpoint is gated by this key on the API; everyone else refreshes via the plain GET. */
export const SNAPSHOT_GENERATE_PERMISSION = 'dashboard.snapshot.generate';

export function canForceGenerateSnapshot(permissions: readonly string[]): boolean {
  return permissions.includes(SNAPSHOT_GENERATE_PERMISSION);
}

/**
 * What this person may start from the home page, the commonest last: the last one is drawn as the main button
 * (thai-ux-standard §2.4). An employee's home page used to hold five controls that changed nothing and neither of these.
 */
export function homeStartLinks(companyId: string, permissions: readonly string[]): { key: string; label: string; href: string }[] {
  const base = `/companies/${companyId}`;
  return [
    ...(permissions.includes('reimbursement.create') ? [{ key: 'claim', label: 'สร้างใบเบิก', href: `${base}/reimbursements/new` }] : []),
    ...(permissions.includes('expense.receipt.upload') ? [{ key: 'upload', label: 'อัปโหลดใบเสร็จ', href: `${base}/expenses/upload` }] : []),
  ];
}

/** The home page's own short names for the expense numbers; the API's labels carry "(ทุกช่วงเวลา)" and "ที่ยืนยันแล้ว". */
const HOME_METRIC_LABELS: Record<string, string> = {
  expense_pending_review: 'รอตรวจ',
  expense_unpaid_outstanding: 'ค้างจ่าย',
  expense_total_in_period: 'ยืนยันแล้ว',
};
const HOME_METRIC_ORDER = Object.keys(HOME_METRIC_LABELS);
/** The one number the period choice changes; the others are "as of now". */
const PERIOD_SCOPED_METRIC_KEYS = new Set(['expense_total_in_period']);

/** What waits comes first; a metric the home page does not know keeps the API's label and place after the known ones. */
export function homeMetrics<T extends { key: string; label: string }>(metrics: readonly T[]): (T & { homeLabel: string; periodScoped: boolean })[] {
  const rank = (key: string) => { const index = HOME_METRIC_ORDER.indexOf(key); return index === -1 ? HOME_METRIC_ORDER.length : index; };
  return metrics
    .map((metric, index) => ({ metric, index }))
    .sort((a, b) => rank(a.metric.key) - rank(b.metric.key) || a.index - b.index)
    .map(({ metric }) => ({ ...metric, homeLabel: HOME_METRIC_LABELS[metric.key] ?? metric.label, periodScoped: PERIOD_SCOPED_METRIC_KEYS.has(metric.key) }));
}
