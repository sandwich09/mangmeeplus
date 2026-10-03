// Pure A8 daily-brief assembly. No I/O — unit-tested. Thailand has no DST, so the
// business day is a fixed UTC+7 window.

import type { CrmDailyBriefSeverity, CrmDailyBriefWidget } from '@watchdog-bms/contracts';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Start (inclusive) and end (exclusive) of the Bangkok day containing `now`, as UTC instants. */
export function bangkokDayBounds(now: Date): { dayStart: Date; dayEnd: Date } {
  const localMs = now.getTime() + BANGKOK_OFFSET_MS;
  const dayStartLocal = Math.floor(localMs / 86_400_000) * 86_400_000;
  const dayStart = new Date(dayStartLocal - BANGKOK_OFFSET_MS);
  return { dayStart, dayEnd: new Date(dayStart.getTime() + 86_400_000) };
}

export type DailyBriefPeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'last_month' | 'custom';

/**
 * Start (inclusive) / end (exclusive) of a dashboard period, as UTC instants, using
 * the fixed Bangkok (UTC+7, no DST) offset so buckets never drift with server TZ.
 * `today` is the Bangkok calendar day; `week` is the last 7 Bangkok days ending today
 * (matches the "7 วันล่าสุด" tab); `month`/`quarter` are the current Bangkok month/quarter;
 * `last_month` is the previous Bangkok calendar month.
 */
export function bangkokPeriodBounds(kind: DailyBriefPeriodKind, now: Date): { dayStart: Date; dayEnd: Date } {
  const { dayStart, dayEnd } = bangkokDayBounds(now);
  if (kind === 'week') return { dayStart: new Date(dayStart.getTime() - 6 * 86_400_000), dayEnd };
  if (kind === 'month' || kind === 'quarter' || kind === 'last_month') {
    const local = new Date(now.getTime() + BANGKOK_OFFSET_MS);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    const startMonth = kind === 'quarter' ? Math.floor(m / 3) * 3 : kind === 'last_month' ? m - 1 : m;
    const endMonth = kind === 'quarter' ? startMonth + 3 : kind === 'last_month' ? m : m + 1;
    return {
      dayStart: new Date(Date.UTC(y, startMonth, 1) - BANGKOK_OFFSET_MS),
      dayEnd: new Date(Date.UTC(y, endMonth, 1) - BANGKOK_OFFSET_MS),
    };
  }
  return { dayStart, dayEnd };
}

export type DailyBriefSeverity = CrmDailyBriefSeverity;
export type DailyBriefWidget = CrmDailyBriefWidget;

export interface DailyBriefMoneyCount {
  count: number;
  amount: string;
}

export interface DailyBriefCounts {
  unanswered: number;
  slaBreaches: number;
  newCustomersToday: number;
  appointmentsToday: number;
  paymentProofs: number;
  openDeals?: DailyBriefMoneyCount;
  quotationsAwaitingAcceptance?: DailyBriefMoneyCount;
  overduePayments?: DailyBriefMoneyCount;
  unresolvedComplaints?: number;
  averageFirstResponse?: { minutes: number | null; count: number };
}

/**
 * Assemble the owner/manager daily-brief widgets with deep links to the filtered
 * queues. Severity escalates to 'action' when a queue actually needs attention (>0)
 * so the UI can color it; SLA breaches are 'critical' when present.
 *
 * `periodLabel` is the Thai suffix for the date-scoped widgets (new customers,
 * appointments, average first response), so the cards reflect the dashboard's
 * selected period (วันนี้ / 7 วัน / เดือนนี้ / ไตรมาสนี้). Open-queue widgets
 * (unanswered / SLA / payment proofs) are current-state and carry no suffix.
 */
export function buildDailyBriefWidgets(
  companyId: string,
  c: DailyBriefCounts,
  periodLabel = 'วันนี้',
  periodKind: DailyBriefPeriodKind = 'today',
): DailyBriefWidget[] {
  const inbox = `/companies/${companyId}/inbox`;
  const widgets: DailyBriefWidget[] = [
    { key: 'unanswered', label: 'ยังไม่ได้ตอบ', value: c.unanswered, href: `${inbox}?unanswered=true`, severity: c.unanswered > 0 ? 'action' : 'info' },
    { key: 'sla_breaches', label: 'รอตอบเกินกำหนด', value: c.slaBreaches, href: `${inbox}?overdue=true`, severity: c.slaBreaches > 0 ? 'critical' : 'info' },
    { key: 'new_customers_today', label: `ลูกค้าใหม่${periodLabel}`, value: c.newCustomersToday, href: `/companies/${companyId}/crm`, severity: 'info' },
    { key: 'appointments_today', label: `นัดหมาย${periodLabel}`, value: c.appointmentsToday, href: `/companies/${companyId}/bookings`, severity: c.appointmentsToday > 0 ? 'action' : 'info' },
    { key: 'payment_proofs', label: 'หลักฐานโอนรอตรวจ', value: c.paymentProofs, href: `/companies/${companyId}/crm/payment-proofs`, severity: c.paymentProofs > 0 ? 'action' : 'info' },
  ];

  if (c.openDeals) widgets.push({
    key: 'open_deals', label: 'มูลค่าดีลเปิด', value: Number(c.openDeals.amount), count: c.openDeals.count,
    amount: c.openDeals.amount, currency: 'THB', href: `/companies/${companyId}/crm?tab=pipeline`,
    severity: c.openDeals.count > 0 ? 'action' : 'info',
  });
  if (c.quotationsAwaitingAcceptance) widgets.push({
    key: 'quotations_awaiting_acceptance', label: 'ใบเสนอรอลูกค้าตอบรับ', value: Number(c.quotationsAwaitingAcceptance.amount),
    count: c.quotationsAwaitingAcceptance.count, amount: c.quotationsAwaitingAcceptance.amount, currency: 'THB',
    href: `/companies/${companyId}/sales-documents?documentType=QUOTATION`,
    severity: c.quotationsAwaitingAcceptance.count > 0 ? 'action' : 'info',
  });
  if (c.overduePayments) widgets.push({
    key: 'overdue_payments', label: 'ยอดค้างชำระเกินกำหนด', value: Number(c.overduePayments.amount),
    count: c.overduePayments.count, amount: c.overduePayments.amount, currency: 'THB',
    href: `/companies/${companyId}/sales-documents`,
    severity: c.overduePayments.count > 0 ? 'critical' : 'info',
  });
  if (c.unresolvedComplaints !== undefined) widgets.push({
    key: 'unresolved_complaints', label: 'ข้อร้องเรียนยังไม่จบ', value: c.unresolvedComplaints, count: c.unresolvedComplaints,
    // No ?tag param: the count matches complaint AND escalation tags case-insensitively,
    // while the inbox tag filter is an exact match — a tag link would hide counted rows.
    href: inbox, severity: c.unresolvedComplaints > 0 ? 'action' : 'info',
  });
  if (c.averageFirstResponse) widgets.push({
    key: 'average_first_response_today', label: `ตอบครั้งแรกเฉลี่ย${periodLabel}`, value: c.averageFirstResponse.minutes,
    count: c.averageFirstResponse.count, unit: 'minutes', href: `/companies/${companyId}/crm-reports?period=${periodKind}`, severity: 'info',
  });

  return widgets;
}
