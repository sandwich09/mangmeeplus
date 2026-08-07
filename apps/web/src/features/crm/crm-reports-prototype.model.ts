import type { CrmConversationStatus, CrmReportsTopCustomer } from '@watchdog-bms/contracts';

export type ConversationStatusKey =
  | 'new'
  | 'open'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'followup'
  | 'resolved';

export const CONV_STATUS_ORDER: ConversationStatusKey[] = [
  'new',
  'open',
  'waiting_customer',
  'waiting_internal',
  'followup',
  'resolved',
];

export const CONV_STATUS_META: Record<ConversationStatusKey, { label: string; c: string; bg: string }> = {
  new: { label: 'ใหม่', c: '#DC2626', bg: '#FEE2E2' },
  open: { label: 'กำลังคุย', c: '#2563EB', bg: '#DBEAFE' },
  waiting_customer: { label: 'รอลูกค้า', c: '#7C3AED', bg: '#EDE9FE' },
  waiting_internal: { label: 'รอทีมภายใน', c: '#D97706', bg: '#FEF3C7' },
  followup: { label: 'ติดตาม', c: '#EA580C', bg: '#FFEDD5' },
  resolved: { label: 'ปิดแล้ว', c: '#059669', bg: '#D1FAE5' },
};

export const CONTRACT_STATUS_KEY: Partial<Record<CrmConversationStatus, ConversationStatusKey>> = {
  NEW: 'new',
  OPEN: 'open',
  WAITING_CUSTOMER: 'waiting_customer',
  WAITING_INTERNAL: 'waiting_internal',
  FOLLOW_UP: 'followup',
  RESOLVED: 'resolved',
};

export function contractStatusKey(status: CrmConversationStatus): ConversationStatusKey | null {
  return CONTRACT_STATUS_KEY[status] ?? null;
}

export const UNASSIGNED_LABEL = 'ยังไม่ assign';

/** Prototype colors staff-performance rows by row index, not by name hash. */
export const REPORT_STAFF_COLORS = ['#12B76A', '#2E90FA', '#F79009', '#7A5AF8', '#EC4899', '#06AED4'];

export const TIER_META: Record<CrmReportsTopCustomer['tier'], { label: string; c: string; bg: string }> = {
  vip: { label: 'VIP', c: '#B54708', bg: '#FEF3C7' },
  active: { label: 'ลูกค้าประจำ', c: '#027A48', bg: '#D1FAE5' },
  lead: { label: 'ลูกค้าใหม่', c: '#1D4ED8', bg: '#DBEAFE' },
};

export function formatLifetimeValueAmount(raw: string): string {
  const normalized = raw.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized;

  const [, sign, intRaw, fracRaw] = match;
  const intPart = (intRaw ?? '0').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracPart = (fracRaw ?? '').replace(/0+$/, '');
  return `${sign}${intPart || '0'}${fracPart ? `.${fracPart}` : ''}`;
}
