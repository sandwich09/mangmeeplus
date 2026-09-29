// Pure helpers for ส่วนลดจากงาน in the sales console (sales-event-discounts spec §3.1, §3.2, §6.2, §8).
// The API speaks satang, 0.01-credit units, UTC instants and state keys; the หัวหน้าทีม and เซลล์ read
// whole baht, Thai time and Thai words. Every conversion lives here so a unit test can hold it.
import {
  billingOfferLabel,
  billingPlanLabel,
  SALES_DEAL_BASE_TIERS,
  SALES_EVENT_CHAT_CREDIT_UNIT_SCALE,
  SALES_EVENT_NAME_MAX,
  SALES_EVENT_REASON_ACTIONS,
  SALES_EVENT_TICKET_VALID_DAYS,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesEventBatchAction,
  type SalesEventBatchInput,
  type SalesEventBatchState,
  type SalesEventBatchView,
  type SalesEventScope,
  type SalesEventTicketView,
} from '@watchdog-bms/contracts';
import { apiErrorCode } from '@/common/api/api-error-message';
import type { MangmeeTone } from '@/common/components/mangmee';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SALES_EVENT_INTERVALS: readonly SalesDealCadence[] = ['month', 'year'];
export const SALES_EVENT_INTERVAL_LABELS: Record<SalesDealCadence, string> = { month: 'รายเดือน', year: 'รายปี' };

// ── time: `datetime-local` is Thai time; the API stores the instant (spec §3.1) ──

/** 'YYYY-MM-DDTHH:mm' in Bangkok time, for a `datetime-local` box. */
export function bangkokInputValue(value: string | Date): string {
  const at = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return new Date(at + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

/** The instant a Thai-time box names — `${value}+07:00`, like BillingReceiptAdjustmentsPage. */
export function isoFromBangkokInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value.trim())) return null;
  const at = new Date(`${value.trim()}+07:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

// ── words ──

export const SALES_EVENT_BATCH_STATE_META: Record<SalesEventBatchState, { label: string; tone: MangmeeTone }> = {
  OPEN: { label: 'เปิดแจก', tone: 'brand' },
  PAUSED: { label: 'พักแจก', tone: 'amber' },
  SUSPENDED: { label: 'ระงับการใช้', tone: 'danger' },
};

/** The stored state, unless the clock says an OPEN batch is not taking scans (spec §6.2: time, not state). */
export function batchStatusMeta(
  batch: Pick<SalesEventBatchView, 'state' | 'claimStartsAt' | 'claimEndsAt'>, now: Date,
): { label: string; tone: MangmeeTone } {
  if (batch.state === 'OPEN' && now.getTime() < Date.parse(batch.claimStartsAt)) return { label: 'ยังไม่ถึงเวลาเปิดรับ', tone: 'slate' };
  if (batch.state === 'OPEN' && now.getTime() >= Date.parse(batch.claimEndsAt)) return { label: 'ปิดรับแล้ว', tone: 'slate' };
  return SALES_EVENT_BATCH_STATE_META[batch.state] ?? { label: 'ต้องตรวจสอบ', tone: 'slate' };
}

export const SALES_EVENT_ACTION_COPY: Record<SalesEventBatchAction, { label: string; title: string; hint: string }> = {
  PAUSE: { label: 'พักแจก', title: 'พักแจกชุดนี้', hint: 'เซลล์จะแสดง QR ไม่ได้จนกว่าจะเปิดแจกต่อ ส่วนลดที่แจกไปแล้วยังใช้ได้ตามปกติ' },
  RESUME: { label: 'เปิดแจกต่อ', title: 'เปิดแจกชุดนี้ต่อ', hint: 'เซลล์ผู้แจกแสดง QR ได้อีกครั้งภายในช่วงเปิดรับ' },
  SUSPEND: {
    label: 'ระงับการใช้', title: 'ระงับการใช้ชุดนี้',
    hint: 'หยุดแจก และส่วนลดที่แจกไปแล้วแต่ยังไม่ได้ใช้จะใช้ไม่ได้จนกว่าจะยกเลิกการระงับ รายการที่กำลังชำระหรือใช้แล้วไม่เปลี่ยน',
  },
  LIFT: {
    label: 'ยกเลิกการระงับ', title: 'ยกเลิกการระงับชุดนี้',
    hint: 'ส่วนลดที่แจกไปแล้วกลับมาใช้ได้ ชุดนี้จะอยู่ในสถานะพักแจก กด "เปิดแจกต่อ" เมื่อพร้อมแจกอีกครั้ง',
  },
};

/** Spec §6.2 — the only commands each state offers. */
export function batchActions(state: SalesEventBatchState): SalesEventBatchAction[] {
  if (state === 'OPEN') return ['PAUSE', 'SUSPEND'];
  if (state === 'PAUSED') return ['RESUME', 'SUSPEND'];
  return ['LIFT'];
}

export function actionNeedsReason(action: SalesEventBatchAction): boolean {
  return SALES_EVENT_REASON_ACTIONS.includes(action);
}

export function ticketStatusMeta(ticket: Pick<SalesEventTicketView, 'state' | 'redeemedAs'>): { label: string; tone: MangmeeTone } {
  switch (ticket.state) {
    case 'AVAILABLE': return { label: 'ยังไม่ได้ใช้', tone: 'brand' };
    case 'IN_PAYMENT': return { label: 'กำลังชำระ', tone: 'amber' };
    case 'USED': return ticket.redeemedAs === 'CREDIT' ? { label: 'ใช้เป็นเครดิตแล้ว', tone: 'teal' } : { label: 'ใช้เป็นส่วนลดแล้ว', tone: 'teal' };
    case 'EXPIRED': return { label: 'หมดอายุ', tone: 'slate' };
    case 'REVOKED': return { label: 'เพิกถอนแล้ว', tone: 'danger' };
    default: return { label: 'ต้องตรวจสอบ', tone: 'slate' };
  }
}

const wholeBaht = (satang: number) => (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const count = (value: number) => value.toLocaleString('th-TH');

/** What the batch gives, in the LIFF page's own words (spec §3.3); only the parts above zero. */
export function batchRewardLines(
  batch: Pick<SalesEventBatchView, 'discountSatang' | 'rewardChatCreditUnits' | 'rewardReceiptImageUnits'>,
): string[] {
  const lines: string[] = [];
  if (batch.discountSatang > 0) lines.push(`ลด ${wholeBaht(batch.discountSatang)} บาท ตอนจ่ายค่าแพ็กเกจ เลือกใช้หรือไม่ใช้ได้ตอนจ่าย · งานเดียวกันใช้ได้ร้านละครั้ง`);
  const credit = [
    batch.rewardChatCreditUnits > 0 ? `เครดิต AI ${count(batch.rewardChatCreditUnits / SALES_EVENT_CHAT_CREDIT_UNIT_SCALE)} เครดิต` : null,
    batch.rewardReceiptImageUnits > 0 ? `จำนวนอ่านรูปใบเสร็จ ${count(batch.rewardReceiptImageUnits)} รูป` : null,
  ].filter((part): part is string => Boolean(part));
  if (credit.length > 0) lines.push(`ร้านที่มีแพ็กเกจอยู่แล้ว: รับ${credit.join(' และ')}`);
  return lines;
}

export function batchScopeText(scope: SalesEventScope): string {
  if (scope.tiers.length === 0 || scope.intervals.length === 0) return 'ไม่มีแพ็กเกจที่ลดได้';
  const tiers = scope.tiers.length === SALES_DEAL_BASE_TIERS.length ? 'ทุกแพ็กเกจ' : scope.tiers.map((tier) => billingPlanLabel(tier)).join(', ');
  return `${tiers} · ${scope.intervals.map((interval) => SALES_EVENT_INTERVAL_LABELS[interval]).join('และ')}`;
}

/** Tickets handed out now can be used until the claim end plus 30 days (SD-Q1). */
export function ticketUsableUntil(claimEndsAt: string): Date {
  return new Date(Date.parse(claimEndsAt) + SALES_EVENT_TICKET_VALID_DAYS * DAY_MS);
}

// ── the QR (owner 2026-09-29, SD-O11: printable, valid until the batch closes) ──

/** The batch's claim end is the QR's: extending the batch extends every QR already printed. */
export function qrValidUntilText(claimEndsAt: string): string {
  return `QR นี้ใช้ได้ถึง ${formatThaiDateTime(claimEndsAt)}`;
}

export const SALES_EVENT_QR_PRINT_HINT = 'พิมพ์หรือเปิดบนจอให้ลูกค้าสแกนได้ · หยุดใช้ได้ทันทีด้วยพักแจก/ระงับ หรือเอาเซลล์ออกจากชุด';

/**
 * "บันทึกรูป QR" saves a PNG: phones keep it in Photos and share it in LINE, which an SVG does not do.
 * The SVG is the fallback only when the browser cannot draw it onto a canvas. 1024 px with a white
 * quiet zone on top of the QR's own margin prints sharply at poster size and scans off any screen.
 */
export const SALES_EVENT_QR_PNG_SIZE = 1024;
export const SALES_EVENT_QR_PNG_QUIET_ZONE = 32;

/** "บันทึกรูป QR": a file name people recognise, without the characters a file system refuses. */
export function qrDownloadFileName(batch: Pick<SalesEventBatchView, 'eventName' | 'batchName'>, extension: 'png' | 'svg'): string {
  const name = `QR ${batch.eventName} ${batch.batchName}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${name.slice(0, 100).trim()}.${extension}`;
}

// ── the batch form ──

export type SalesEventBatchFormValues = {
  eventName: string; batchName: string;
  /** Whole baht; '0' = no first-bill discount. */
  discountBaht: string;
  issueCap: string;
  /** `datetime-local` values in Thai time. */
  claimStartsAt: string; claimEndsAt: string;
  tiers: SalesDealBaseTier[]; intervals: SalesDealCadence[];
  agentUserIds: string[];
  // The credit for shops that already pay has no input yet (SD-F adds it); an edit carries the
  // stored values through untouched so saving never zeroes them.
  rewardChatCreditUnits: number; rewardReceiptImageUnits: number;
};
export type SalesEventBatchFormErrors = Partial<Record<keyof SalesEventBatchFormValues, string>>;

/** Opens now (to the minute) for one day, every package and cycle ticked (spec §3.1 default). */
export function emptyEventBatchForm(now: Date): SalesEventBatchFormValues {
  const start = bangkokInputValue(now);
  return {
    eventName: '', batchName: '', discountBaht: '', issueCap: '',
    claimStartsAt: start, claimEndsAt: bangkokInputValue(new Date(now.getTime() + DAY_MS)),
    tiers: [...SALES_DEAL_BASE_TIERS], intervals: [...SALES_EVENT_INTERVALS], agentUserIds: [],
    rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
  };
}

export function eventBatchFormFromView(batch: SalesEventBatchView): SalesEventBatchFormValues {
  return {
    eventName: batch.eventName, batchName: batch.batchName,
    discountBaht: String(batch.discountSatang / 100), issueCap: String(batch.issueCap),
    claimStartsAt: bangkokInputValue(batch.claimStartsAt), claimEndsAt: bangkokInputValue(batch.claimEndsAt),
    tiers: [...batch.scope.tiers], intervals: [...batch.scope.intervals],
    agentUserIds: batch.agents.filter((agent) => agent.active).map((agent) => agent.userId),
    rewardChatCreditUnits: batch.rewardChatCreditUnits, rewardReceiptImageUnits: batch.rewardReceiptImageUnits,
  };
}

const WHOLE = /^\d{1,9}$/;
const wholeNumber = (raw: string) => {
  const text = raw.trim().replace(/,/g, '');
  return WHOLE.test(text) ? Number(text) : null;
};

/** Mirrors `validateSalesEventBatch` so the lead is stopped at the box, not by a round trip. */
export function validateEventBatchForm(
  values: SalesEventBatchFormValues,
  options: { now: Date; issuedCount?: number; storedClaimEndsAt?: string },
): SalesEventBatchFormErrors {
  const errors: SalesEventBatchFormErrors = {};
  for (const [field, label] of [['eventName', 'ชื่องาน'], ['batchName', 'ชื่อชุด']] as const) {
    const text = values[field].trim();
    if (!text || text.length > SALES_EVENT_NAME_MAX) errors[field] = `กรอก${label} 1–${SALES_EVENT_NAME_MAX} ตัวอักษร`;
  }
  const discount = wholeNumber(values.discountBaht);
  if (discount === null) errors.discountBaht = 'กรอกส่วนลดเป็นจำนวนเต็มบาท เช่น 100';
  else if (discount === 0 && values.rewardChatCreditUnits === 0 && values.rewardReceiptImageUnits === 0) {
    errors.discountBaht = 'ใส่ส่วนลดมากกว่า 0 บาท';
  }
  const cap = wholeNumber(values.issueCap);
  if (cap === null || cap < 1) errors.issueCap = 'กรอกจำนวนแจกสูงสุดเป็นจำนวนเต็มตั้งแต่ 1';
  else if (options.issuedCount !== undefined && cap < options.issuedCount) {
    errors.issueCap = `แจกไปแล้ว ${count(options.issuedCount)} รายการ จำนวนแจกสูงสุดต้องไม่น้อยกว่านี้`;
  }
  const start = isoFromBangkokInput(values.claimStartsAt);
  const end = isoFromBangkokInput(values.claimEndsAt);
  if (!start) errors.claimStartsAt = 'เลือกวันและเวลาเปิดรับ';
  if (!end) errors.claimEndsAt = 'เลือกวันและเวลาปิดรับ';
  else if (start && Date.parse(end) <= Date.parse(start)) errors.claimEndsAt = 'เวลาปิดรับต้องหลังเวลาเปิดรับ';
  else if (end !== options.storedClaimEndsAt && Date.parse(end) <= options.now.getTime()) errors.claimEndsAt = 'เวลาปิดรับต้องยังไม่ผ่านไป';
  if ((discount ?? 0) > 0 && (values.tiers.length === 0 || values.intervals.length === 0)) {
    errors.tiers = 'เลือกแพ็กเกจและรอบที่ลดได้อย่างน้อยอย่างละหนึ่ง';
  }
  if (values.agentUserIds.length === 0) errors.agentUserIds = 'เลือกเซลล์ผู้แจกอย่างน้อยหนึ่งคน';
  return errors;
}

const FIELD_ORDER: (keyof SalesEventBatchFormValues)[] = [
  'eventName', 'batchName', 'discountBaht', 'issueCap', 'claimStartsAt', 'claimEndsAt', 'tiers', 'agentUserIds',
];

export function firstEventBatchErrorField(errors: SalesEventBatchFormErrors): keyof SalesEventBatchFormValues | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Only call after `validateEventBatchForm` came back empty. */
export function eventBatchInputFromForm(values: SalesEventBatchFormValues): SalesEventBatchInput {
  return {
    eventName: values.eventName.trim(), batchName: values.batchName.trim(),
    discountSatang: (wholeNumber(values.discountBaht) ?? 0) * 100,
    rewardChatCreditUnits: values.rewardChatCreditUnits, rewardReceiptImageUnits: values.rewardReceiptImageUnits,
    issueCap: wholeNumber(values.issueCap) ?? 0,
    claimStartsAt: isoFromBangkokInput(values.claimStartsAt) ?? '',
    claimEndsAt: isoFromBangkokInput(values.claimEndsAt) ?? '',
    scope: {
      tiers: SALES_DEAL_BASE_TIERS.filter((tier) => values.tiers.includes(tier)),
      intervals: SALES_EVENT_INTERVALS.filter((interval) => values.intervals.includes(interval)),
    },
    agentUserIds: [...values.agentUserIds],
  };
}

export function toggleValue<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? (list.includes(value) ? [...list] : [...list, value]) : list.filter((item) => item !== value);
}

/**
 * SALES_EVENT_DISCOUNT_TOO_HIGH names the package it tripped on (spec §3.1), so the lead knows which
 * box to untick. Null for every other error, which the shared Thai map answers.
 */
export function discountTooHighMessage(cause: unknown): string | null {
  if (apiErrorCode(cause) !== 'SALES_EVENT_DISCOUNT_TOO_HIGH') return null;
  const details = (cause as { details?: { offerKey?: unknown; interval?: unknown } } | null)?.details;
  const tier = details?.offerKey, interval = details?.interval;
  if (!SALES_DEAL_BASE_TIERS.includes(tier as SalesDealBaseTier) || (interval !== 'month' && interval !== 'year')) return null;
  return `ส่วนลดสูงเกินราคาของ ${billingOfferLabel(`${tier as string}:${interval}`)} ลดจำนวนส่วนลด หรือเอาแพ็กเกจนั้นออกจากแพ็กเกจที่ลดได้`;
}
