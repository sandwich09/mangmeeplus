import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LINE_AI_EXPENSE_CRITERION_REPLIES, LINE_TOOL_REGISTRY, civilPeriodRange, isCivilPeriodKey, hasToolFeature, hasToolPermissions, type ToolResult, type LineAiConversationContext, type LineAiReadMemory, type LineAiReadMemoryShownItem, type LineAiTurnRequest, type LineAiTurnResponse } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { PermissionResolverService } from '../../access-control/application/permission-resolver.service';
import { loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { ERP_READ_TOOL_REGISTRY, type ErpReadToolPort, type ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { lineDeliveryRecipientHash, parseLineReadDeliveryAuthorization, resolvedLineDeliveryAccessFingerprint } from './line-delivery-access';

export const LINE_READ_EVIDENCE_MAX = 64;
export const LINE_READ_EVIDENCE_MAX_INPUT_BYTES = 8192;
export const LINE_READ_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1000;
const READ_CATEGORIES = new Set(['read_summary', 'read_detail', 'report', 'suggestion']);
const EXPENSE_STATUS_BASIS = 'exclude_rejected_voided_v1';

type ExpenseSummaryEvidence = { fromDate: string; toDate: string; branchId: string | null; defaultedToCurrentMonth: boolean; statusBasis: typeof EXPENSE_STATUS_BASIS; truncated: boolean };

function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function expenseSummaryEvidence(result: ToolResult): ExpenseSummaryEvidence | undefined {
  if (result.toolName !== 'expense.list_recent' || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return undefined;
  const data = result.data as Record<string, unknown>;
  const summary = data['summary'];
  if (!Number.isFinite(Date.parse(result.asOf)) || typeof data['total'] !== 'number' || !Number.isSafeInteger(data['total']) || data['total'] < 0
    || !summary || typeof summary !== 'object' || Array.isArray(summary)) return undefined;
  const totals = summary as Record<string, unknown>;
  const exactAmount = typeof totals['totalAmount'] === 'string' && /^-?\d+(?:\.\d+)?$/.test(totals['totalAmount']);
  const legacyAmount = typeof totals['totalAmount'] === 'number' && Number.isFinite(totals['totalAmount']);
  if ((!exactAmount && !legacyAmount)
    || totals['countedItems'] !== data['total'] || typeof totals['cancelledCount'] !== 'number'
    || !Number.isSafeInteger(totals['cancelledCount']) || totals['cancelledCount'] < 0
    || (data['truncated'] !== undefined && typeof data['truncated'] !== 'boolean')) return undefined;
  // A narrower category/payment/status query cannot become a remembered whole-period summary.
  if (result.queryApplied && (result.queryApplied.statusBasis !== 'exclude_rejected_voided'
    || Object.keys(result.queryApplied.filters ?? {}).length > 0)
    || result.completeness && result.completeness.aggregate !== 'complete') return undefined;
  const period = data['period'];
  if (!period || typeof period !== 'object' || Array.isArray(period)) return undefined;
 const range = period as Record<string, unknown>;
 if (!isCivilDate(range['fromDate']) || !isCivilDate(range['toDate']) || range['fromDate'] > range['toDate']) return undefined;
  if (typeof range['defaultedToCurrentMonth'] !== 'boolean') return undefined;
  const branchId = data['branchId'];
  if (!(branchId === undefined || (typeof branchId === 'string' && branchId.length > 0 && branchId.length <= 200))) return undefined;
 return { fromDate: range['fromDate'], toDate: range['toDate'], branchId: typeof branchId === 'string' ? branchId : null,
    defaultedToCurrentMonth: range['defaultedToCurrentMonth'], statusBasis: EXPENSE_STATUS_BASIS, truncated: data['truncated'] === true };
}

// ---- read memory (spec §4 R-M1) ----
// Every tool a follow-up question can reasonably refer back to ("รายการแรก", "อันที่ 2 จ่ายหรือยัง",
// "แยกตามสาขาด้วย"). NOT expense.explain_record or the draft_update tools: those already have their
// own chat-scoped record-continuity rule (chatKeyHash on the capture itself), and a draft preview is
// never something a later turn should silently re-target.
const READ_MEMORY_TOOLS = new Set([
  'counterparty.search', 'counterparty.get_detail',
  'voucher.list_recent', 'voucher.get_detail',
  'expense.list_recent', 'expense.get_breakdown', 'expense.get_detail', 'expense.get_daily_closing',
  'reimbursement.list_pending_approvals', 'reimbursement.get_summary', 'reimbursement.get_detail',
  'expense.list_substitute_receipts_to_sign',
  'reimbursement.get_approval_backlog',
]);

/** Hardcoded per tool, not derived from the data shape: a detail read is a "single_metric"-style
 *  answer (one record) even though it also produces exactly one `shownItems` entry for that record. */
const READ_MEMORY_ANSWER_SHAPE: Record<string, 'single_metric' | 'list'> = {
  'counterparty.search': 'list', 'counterparty.get_detail': 'single_metric',
  'expense.list_recent': 'list',
  'voucher.list_recent': 'list', 'voucher.get_detail': 'single_metric',
  'expense.get_breakdown': 'list',
  'expense.get_detail': 'single_metric',
  'expense.get_daily_closing': 'single_metric',
  'reimbursement.list_pending_approvals': 'list',
  'reimbursement.get_summary': 'single_metric',
  'reimbursement.get_detail': 'single_metric',
  'expense.list_substitute_receipts_to_sign': 'list',
  'reimbursement.get_approval_backlog': 'list',
};

const READ_MEMORY_MAX_SHOWN_ITEMS = 10;
/** Matches the gateway's own R-A2 cap (prepared-simple-read-formatter.ts) so "the first group" means
 *  the same thing in memory as in the reply that was actually shown. */
const READ_MEMORY_MAX_BREAKDOWN_GROUPS = 8;

function readMemoryAmountNumber(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN;
}

function readMemoryLabel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/** Numbered records in display order (expense.list_recent, reimbursement.list_pending_approvals) —
 *  the tool's own array order, never re-sorted; R-A3's formatter reads the same order. */
function readMemoryRecordItems(items: unknown, idKey: string, labelKey: string, labelFallback: string, dateKey: string): LineAiReadMemoryShownItem[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, READ_MEMORY_MAX_SHOWN_ITEMS).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const id = item[idKey];
    if (typeof id !== 'string' || !id) return [];
    const date = item[dateKey];
    return [{ ordinal: index + 1, id, label: readMemoryLabel(item[labelKey], labelFallback),
      ...(typeof date === 'string' ? { date: date.slice(0, 10) } : {}) }];
  });
}

/** Breakdown groups (expense.get_breakdown): sorted by amount descending, top 8 kept individually —
 *  the SAME order and cap `formatExpenseBreakdownList` (gateway) renders, so an ordinal here means the
 *  same group there. A group whose id is null (the "ไม่ระบุ.../ส่วนกลาง" catch-all bucket) keeps its
 *  true display ordinal but is dropped from the array: there is nothing to look a null id back up by. */
function readMemoryBreakdownGroups(data: Record<string, unknown>, axis: 'category' | 'branch' | 'vendor'): LineAiReadMemoryShownItem[] {
  const axisField = { category: ['byCategory', 'categoryId', 'category'], branch: ['byBranch', 'branchId', 'branch'], vendor: ['byVendor', 'vendorId', 'vendor'] }[axis];
  const [dataKey, idKey, nameKey] = axisField;
  const rows = data[dataKey!];
  if (!Array.isArray(rows)) return [];
  const sorted = [...rows].sort((a, b) => readMemoryAmountNumber((b as Record<string, unknown>)?.['totalAmount']) - readMemoryAmountNumber((a as Record<string, unknown>)?.['totalAmount']));
  return sorted.slice(0, READ_MEMORY_MAX_BREAKDOWN_GROUPS).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const id = row[idKey!];
    if (typeof id !== 'string' || !id) return [];
    return [{ ordinal: index + 1, id, label: readMemoryLabel(row[nameKey!], 'ไม่ระบุ'), kind: axis }];
  });
}

/**
 * Spec §4 R-M1: what this ONE successful read tool call actually applied and showed, from the
 * TOOL RESULT (`queryApplied`/resolved `data`) — never the raw `input` argument, so a follow-up can
 * never inherit a filter that was ambiguous, unresolved, or otherwise never really took effect.
 * R-M6: no amount ever reaches this object. Returns undefined for any tool outside the memory set,
 * or a shape too malformed to trust — a missing memory entry is always safe; an invented one is not.
 */
// Exported (unlike its single-tool sibling expenseSummaryEvidence): this dispatches across 7 tool
// result shapes, so a direct unit test per shape is worth more than only the record()/pg round-trip.
export function readMemoryEvidence(result: ToolResult): LineAiReadMemory | undefined {
  if (!READ_MEMORY_TOOLS.has(result.toolName) || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)
    || !Number.isFinite(Date.parse(result.asOf))) return undefined;
  const data = result.data as Record<string, unknown>;
  const applied = result.queryApplied;
  const appliedFilters = applied?.filters ?? {};
  const stringFilter = (key: string): string | undefined => typeof appliedFilters[key] === 'string' ? appliedFilters[key] as string : undefined;
  const period = applied?.period && isCivilDate(applied.period.startDate) && isCivilDate(applied.period.endDate)
    ? { fromDate: applied.period.startDate, toDate: applied.period.endDate } : undefined;
  const documentStatus = typeof applied?.statusBasis === 'string' && applied.statusBasis !== 'exclude_rejected_voided' ? applied.statusBasis : undefined;
  const branchId = typeof applied?.branch?.branchId === 'string' ? applied.branch.branchId : undefined;
  const groupByRaw = stringFilter('groupBy');
  const groupBy = groupByRaw === 'category' || groupByRaw === 'branch' || groupByRaw === 'vendor' ? groupByRaw : undefined;

  let shownItems: LineAiReadMemoryShownItem[] | undefined;
  if (result.toolName === 'counterparty.search') {
    shownItems = readMemoryRecordItems(data['items'], 'id', 'displayName', 'คู่ค้า', 'createdAt');
  } else if (result.toolName === 'counterparty.get_detail') {
    if (typeof data['id'] === 'string') shownItems = [{ ordinal: 1, id: data['id'], label: readMemoryLabel(data['displayName'], 'คู่ค้า') }];
  } else if (result.toolName === 'voucher.list_recent') {
    shownItems = readMemoryRecordItems(data['items'], 'id', 'payeeName', 'ไม่ระบุผู้รับเงิน', 'paidDate');
  } else if (result.toolName === 'voucher.get_detail') {
    if (typeof data['id'] === 'string') shownItems = [{ ordinal: 1, id: data['id'], label: readMemoryLabel(data['payeeName'], 'ไม่ระบุผู้รับเงิน') }];
  } else if (result.toolName === 'expense.list_recent') {
    shownItems = readMemoryRecordItems(data['items'], 'id', 'vendorNameSnapshot', 'ไม่ระบุร้าน', 'expenseDate');
  } else if (result.toolName === 'reimbursement.list_pending_approvals') {
    shownItems = readMemoryRecordItems(data['items'], 'id', 'requesterDisplayName', 'ไม่ระบุผู้ขอ', 'submittedAt');
  } else if (result.toolName === 'expense.get_breakdown') {
    shownItems = readMemoryBreakdownGroups(data, groupBy ?? 'category');
  } else if (result.toolName === 'expense.get_detail' || result.toolName === 'reimbursement.get_detail') {
    const id = data['id'];
    if (typeof id === 'string' && id) {
      const dateKey = result.toolName === 'expense.get_detail' ? 'expenseDate' : 'incurredDate';
      const labelKey = result.toolName === 'expense.get_detail' ? 'vendorName' : 'requesterDisplayName';
      const date = data[dateKey];
      shownItems = [{ ordinal: 1, id, label: readMemoryLabel(data[labelKey], 'ไม่ระบุ'),
        ...(typeof date === 'string' ? { date: date.slice(0, 10) } : {}) }];
    }
  } else if (result.toolName === 'expense.list_substitute_receipts_to_sign') {
    // Advisor S1: the caller's own queue has no period or filter a follow-up could inherit, and its items
    // carry no record id to resolve — the entry only says which list "ใบนั้น" / "ใบไหน" points back to.
    return { tool: result.toolName, answerShape: READ_MEMORY_ANSWER_SHAPE[result.toolName]!, asOf: result.asOf };
  } else if (result.toolName === 'reimbursement.get_approval_backlog') {
    // The claims it listed, so "ใบแรก" can open one; no filter or status basis worth carrying into a later read.
    const items = readMemoryRecordItems(data['items'], 'id', 'documentNumber', 'ใบเบิก', 'submittedOn');
    return { tool: result.toolName, answerShape: 'list', asOf: result.asOf, ...(items.length > 0 ? { shownItems: items } : {}) };
  } else if (result.toolName === 'expense.get_daily_closing') {
    const date = data['date'];
    return {
      tool: result.toolName, answerShape: READ_MEMORY_ANSWER_SHAPE[result.toolName]!, asOf: result.asOf,
      ...(typeof date === 'string' && isCivilDate(date) ? { period: { fromDate: date, toDate: date } } : {}),
    };
  }

  return {
    tool: result.toolName,
    answerShape: READ_MEMORY_ANSWER_SHAPE[result.toolName]!,
    asOf: result.asOf,
    ...(period ? { period } : {}),
    ...(documentStatus ? { documentStatus } : {}),
    ...(stringFilter('paymentStatus') ? { paymentStatus: stringFilter('paymentStatus') } : {}),
    ...(stringFilter('categoryId') ? { categoryId: stringFilter('categoryId') } : {}),
    ...(stringFilter('categoryName') ? { categoryName: stringFilter('categoryName') } : {}),
    ...(stringFilter('vendorId') ? { vendorId: stringFilter('vendorId') } : {}),
    ...(stringFilter('vendorName') ? { vendorName: stringFilter('vendorName') } : {}),
    ...(branchId ? { branchId } : {}),
    ...(stringFilter('branchName') ? { branchName: stringFilter('branchName') } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(shownItems && shownItems.length > 0 ? { shownItems } : {}),
  };
}

export function expenseBranchScopeRequested(text: string): boolean {
  const withoutAllBranches = text.replace(/ทุก\s*สาขา|\ball\s+branches\b/giu, '');
  if (/(?:สาขา|\bbranch\b)/iu.test(withoutAllBranches)) return true;
  // A document/payment status word (optionally after ที่/รายการที่/อันที่) is a filter, not a branch name.
  return /เฉพาะ(?!\s*(?:เดือน|ช่วง|งวด|หมวด|รายการ|(?:รายการที่|อันที่|ที่)?\s*(?:ยืนยัน|อนุมัติ|ยังไม่จ่าย|ค้างจ่าย|จ่าย|ร่าง|รอ|ปฏิเสธ|ยกเลิก)|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.))[\u0E00-\u0E7F]{3,}/iu.test(text);
}

function allExpenseBranchesRequested(text: string): boolean {
  return /(?:ทุก\s*สาขา|\ball\s+branches\b)/iu.test(text);
}

function messageIdentifiesBranch(branchId: string, text: string): boolean {
  const normalized = branchId.normalize('NFC').trim().toLocaleLowerCase();
  const message = text.normalize('NFC').toLocaleLowerCase();
  if (/^[a-z0-9][a-z0-9_-]*$/iu.test(normalized)) {
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'iu').test(message);
  }
  const branch = message.match(/(?:สาขา|\bbranch\b)\s*[:：]?\s*([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.'’_-]{0,79})/iu)
    ?? message.match(/(?:ดู\s*เฉพาะ|เอา\s*เฉพาะ|เฉพาะ)\s*([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.'’_-]{0,79})/iu);
  if (!branch?.[1]) return false;
  const phrase = branch[1].split(/\s+(?:เดือน|ช่วง|งวด|และ|กับ|สำหรับ|เฉพาะ)(?=\s|$)/iu)[0]!.trim().replace(/[.,!?。]+$/u, '');
  return phrase === normalized;
}

function anchoredPriorMonth(request: LineAiTurnRequest): { fromDate: string; toDate: string } | null | undefined {
  if (!/(?:เดือนก่อนหน้า|เดือนก่อนหน้านั้น|previous month|month before)/iu.test(request.messageText)) return undefined;
  const ranges = request.conversationContext?.deliveredExpenseSummary?.ranges ?? [];
  const unique = [...new Map(ranges.map(range => [`${range.fromDate}:${range.toDate}:${range.branchId ?? ''}`, range])).values()];
  if (unique.length !== 1) return null;
  const prior = unique[0]!;
  if (!/^\d{4}-\d{2}-01$/.test(prior.fromDate) || !isCivilDate(prior.fromDate)) return null;
  const year = Number(prior.fromDate.slice(0, 4)), month = Number(prior.fromDate.slice(5, 7));
  if (prior.toDate !== new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)) return null;
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  return { fromDate: previousMonth.toISOString().slice(0, 10),
    toDate: new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
}

export function thaiMonthMentions(text: string): number[] | undefined {
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const distanceAtMostOne = (left: string, right: string): boolean => {
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (left.length > right.length) i++;
      else if (right.length > left.length) j++;
      else { i++; j++; }
    }
    return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
  };
  // Thai words are commonly concatenated without spaces ("กรกฏาคมและสิงหาคม"). Scan bounded
  // substrings in each Thai run so a misspelled month cannot disappear behind the conjunction.
  const runs = text.match(/[\u0E00-\u0E7F]+/gu) ?? [];
  const hits: Array<{ start: number; end: number; month: number }> = [];
  for (const run of runs) {
    const chars = Array.from(run);
    if (chars.length > 8000) return undefined;
    for (let start = 0; start < chars.length; start++) {
      for (let month = 0; month < months.length; month++) {
        const width = Array.from(months[month]!).length;
        for (const size of [width - 1, width, width + 1]) {
          if (size < 5 || start + size > chars.length) continue;
          if (distanceAtMostOne(chars.slice(start, start + size).join(''), months[month]!)) {
            hits.push({ start, end: start + size, month: month + 1 });
          }
        }
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const mentions: number[] = [];
  let consumedUntil = -1;
  for (const hit of hits) {
    if (hit.start < consumedUntil) continue;
    mentions.push(hit.month);
    consumedUntil = hit.end;
  }
  return mentions;
}

function rangeMonths(fromDate: string, toDate: string): number[] | undefined {
  const fromYear = Number(fromDate.slice(0, 4)), fromMonth = Number(fromDate.slice(5, 7));
  const toYear = Number(toDate.slice(0, 4)), toMonth = Number(toDate.slice(5, 7));
  const count = (toYear - fromYear) * 12 + toMonth - fromMonth + 1;
  if (count < 1 || count > 24) return undefined;
  return Array.from({ length: count }, (_, index) => ((fromMonth - 1 + index) % 12) + 1);
}

const EXPENSE_CONTEXT_TEXT = /(?:ค่าใช้จ่าย|รายจ่าย|\bexpenses?\b|\bspend\b)/iu;
const OTHER_BUSINESS_CONTEXT_TEXT = /(?:ภาษี|\bvat\b|ภ\.?พ\.?\s*\d*|ยอดขาย|การขาย|ขาย|\bsales?\b|สต็อก|สินค้า|\bstock\b|รายได้|\bincome\b|ลูกค้า|\bcrm\b|จัดซื้อ|\bprocurement\b)/iu;

export function isExpenseCriterionOnlyText(text: string, hasPriorExpenseContext = false): boolean {
  return (EXPENSE_CONTEXT_TEXT.test(text) || hasPriorExpenseContext)
    && /(?:ไม่รวม|ยกเว้น|ตัด.{0,20}(?:ออก|ทิ้ง)|exclude)/iu.test(text)
    && /(?:ปฏิเสธ|ยกเลิก|rejected|voided|cancelled)/iu.test(text)
    && /(?:ใช่|หรือเปล่า|หรือไม่|เอาแบบ|ถูกไหม|ใช่ไหม|ไหม|หรือยัง|exclude)/iu.test(text)
    && !OTHER_BUSINESS_CONTEXT_TEXT.test(text)
    && !/(?:เท่าไหร่|เท่าไร|กี่\s*บาท|เปรียบเทียบ|compare|breakdown|เฉพาะ|สาขา|branch|ทั้งหมด|ทุกแห่ง|แยกตาม|เปลี่ยน|ขอรายการ|ดูรายการ|แสดงรายการ|อะไรบ้าง|ไหนบ้าง|รายการ.*(?:อะไร|ไหน)|status\s*(?:filter|only)|filter\s*(?:by\s*)?status|เดือน|งวด|ช่วง|วันที่|เมื่อวาน|วันนี้|สัปดาห์|ปี\s*\d{2,4}|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|month|year|week|date|\b\d{4}[-/]\d{1,2}\b)/iu.test(text);
}

export function parseExpenseCriterionAccessAuthorization(value: unknown): {
  userId: string; companyId: string; fingerprint: string; webhookEventId: string; recipientHash: string; channelId: string; chatKeyHash: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(root, 'read')) return null;
  const access = root['access'];
  if (root['v'] !== 1 || typeof root['producerId'] !== 'string' || !root['producerId']
    || !access || typeof access !== 'object' || Array.isArray(access)) return null;
  const proof = access as Record<string, unknown>;
  if (proof['kind'] !== 'expense_criterion_confirmation'
    || ['userId', 'companyId', 'webhookEventId'].some(key => typeof proof[key] !== 'string' || !proof[key])
    || typeof proof['membershipId'] !== 'string' || !proof['membershipId']
    || typeof proof['fingerprint'] !== 'string' || !proof['fingerprint'] || proof['fingerprint'].length > 32768
    || typeof proof['channelId'] !== 'string' || proof['channelId'].length > 200
    || typeof proof['chatKeyHash'] !== 'string' || !/^[a-f0-9]{16,64}$/.test(proof['chatKeyHash'])
    || typeof proof['recipientHash'] !== 'string' || !/^[a-f0-9]{64}$/.test(proof['recipientHash'])) return null;
  return proof as { userId: string; companyId: string; fingerprint: string; webhookEventId: string; recipientHash: string; channelId: string; chatKeyHash: string };
}

export const isLineEvidenceRead = (toolName: string) => toolName !== 'public.lookup' && !toolName.startsWith('reimbursement.draft.') && READ_CATEGORIES.has(LINE_TOOL_REGISTRY.find(tool => tool.name === toolName)?.category ?? '');

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** `expense.get_daily_closing`'s `data.observability.queryDurationMs` is real per-call DB timing
 *  (`Date.now() - startedAt` around its own `$transaction`), not a business fact — re-executing the
 *  SAME query for `verify()` always measures a different duration even when nothing changed, so an
 *  unchanged daily-closing read could never pass re-verification. Strip only that one field, like
 *  `sourceRefs[].asOf` below: every other observability field (queryCount, truncated) stays, since
 *  those DO change when the underlying rows actually do. */
function withoutVolatileObservability(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const observability = record['observability'];
  if (!observability || typeof observability !== 'object' || Array.isArray(observability)
    || !('queryDurationMs' in observability)) return data;
  const { queryDurationMs: _duration, ...restObservability } = observability as Record<string, unknown>;
  return { ...record, observability: restObservability };
}

/** Ignore only read-observation timestamps; preserve business values, references and result order. */
export function lineReadResultHash(result: ToolResult): string {
  const material = { toolName: result.toolName, status: result.status, data: withoutVolatileObservability(result.data),
    sourceRefs: result.sourceRefs.map(({ asOf: _observation, ...source }) => source) };
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(material))))).digest('hex');
}

@Injectable()
export class LineReadEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolverService,
    @Inject(ERP_READ_TOOL_REGISTRY) private readonly tools: ReadonlyMap<string, ErpReadToolPort>,
  ) {}

  async record(ctx: ErpToolContext, input: Record<string, unknown>, result: ToolResult): Promise<string> {
    const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === result.toolName);
    if (!meta || !READ_CATEGORIES.has(meta.category) || result.status !== 'ok'
      || !ctx.requestId || !ctx.membershipId) throw new Error('LINE_READ_EVIDENCE_UNSUPPORTED');
    // Grounding text belongs to draft preview and is deliberately never persisted here.
    const expenseSummary = expenseSummaryEvidence(result);
    const readMemory = readMemoryEvidence(result);
    const calculation = result.toolName === 'wht.calculate_withholding' && result.data && typeof result.data === 'object'
      ? result.data as Record<string, unknown> : undefined;
    // Replay only the accepted catalog name and amount, never the original chat text.
    const whtGrounding = calculation ? [calculation['incomeCategoryName'], calculation['baseAmount']].filter(v => typeof v === 'string').join(' ') : undefined;
    const whtReadChoices = calculation ? parseWhtReadChoices(calculation['readChoices']) : undefined;
    // Due-date help resolves a spoken month before reading; recheck that month without chat text.
    const duePeriod = result.toolName === 'wht.get_month_summary' && input.dueDateOnly === true
      && result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>).periodKey : undefined;
    if (isCivilPeriodKey(duePeriod)) input = { ...input, periodKey: duePeriod };
    const snapshot = JSON.stringify({ input, locale: ctx.locale, ...(whtGrounding !== undefined ? { whtGrounding } : {}),
      ...(whtReadChoices?.length ? { whtReadChoices } : {}), ...(ctx.chatKeyHash ? { chatKeyHash: ctx.chatKeyHash } : {}),
      ...(expenseSummary ? { expenseSummary } : {}), ...(readMemory ? { readMemory } : {}) });
    if (Buffer.byteLength(snapshot, 'utf8') > LINE_READ_EVIDENCE_MAX_INPUT_BYTES) throw new Error('LINE_READ_EVIDENCE_INPUT_LIMIT');
    const resultHash = lineReadResultHash(result);
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-read-evidence:${ctx.companyId}:${ctx.userId}:${ctx.requestId}`}))`;
      const count = await tx.lineReadEvidence.count({ where: { companyId: ctx.companyId, userId: ctx.userId, requestId: ctx.requestId } });
      if (count >= LINE_READ_EVIDENCE_MAX) throw new Error('LINE_READ_EVIDENCE_LIMIT');
      const row = await tx.lineReadEvidence.create({ data: { companyId: ctx.companyId, userId: ctx.userId,
        membershipId: ctx.membershipId!, requestId: ctx.requestId!, toolName: result.toolName,
        inputJson: JSON.parse(snapshot) as Prisma.InputJsonValue, resultHash }, select: { id: true } });
      return row.id;
    });
  }

  async forRequest(companyId: string, userId: string, requestId: string): Promise<string[]> {
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId, userId, requestId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LINE_READ_EVIDENCE_MAX + 1, select: { id: true },
    });
    if (rows.length > LINE_READ_EVIDENCE_MAX) throw new Error('LINE_READ_EVIDENCE_LIMIT');
    return rows.map(row => row.id);
  }

  /** Buttons come from the API's own successful catalog result, bound to this member/chat/turn. */
  async whtReadChoicesForTurn(request: LineAiTurnRequest, response: LineAiTurnResponse) {
    if (response.refused || !request.userContext.chatKeyHash || !response.toolCalls?.some(c => c.name === 'wht.calculate_withholding' && c.status === 'ok')) return undefined;
    const rows = await this.prisma.client.lineReadEvidence.findMany({ where: {
      companyId: request.userContext.companyId!, userId: request.userContext.internalUserId!, requestId: request.requestId,
      membershipId: request.userContext.membershipId, toolName: 'wht.calculate_withholding',
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { inputJson: true } });
    const saved = rows[0]?.inputJson as { chatKeyHash?: string; whtReadChoices?: unknown } | undefined;
    return saved?.chatKeyHash === request.userContext.chatKeyHash ? parseWhtReadChoices(saved.whtReadChoices) : undefined;
  }

  /** Telemetry can require extra proof, but can never discard a read recorded by the API. */
  async forTurn(request: LineAiTurnRequest, response: LineAiTurnResponse): Promise<string[] | null> {
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId: request.userContext.companyId!, userId: request.userContext.internalUserId!, requestId: request.requestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LINE_READ_EVIDENCE_MAX + 1,
      select: { id: true, toolName: true },
    });
    if (rows.length > LINE_READ_EVIDENCE_MAX) return null;
    const reported = response.toolCalls?.length
      ? response.toolCalls.filter(call => call.status === 'ok').map(call => call.name)
      : response.refused ? [] : response.toolsInvoked;
    if (reported.filter(isLineEvidenceRead).some(name => !rows.some(row => row.toolName === name))) return null;
    // Draft preview has its own current-state confirmation boundary; it is never re-executed here.
    const privateReadRefs = response.sourceRefs.filter(ref => !(ref.module === 'public' && ref.entityType === 'public_source' && reported.includes('public.lookup'))
      && !(ref.module === 'reimbursements' && ref.entityType === 'reimbursement_draft_action' && ref.sourceType === 'ACTION'
        && reported.some(name => name.startsWith('reimbursement.draft.')))
      && !(ref.module === 'knowledge' && ref.entityType === 'approved_product_help' && request.approvedKnowledge === true
        && request.selectedKnowledgeCardIds?.length));
    if (privateReadRefs.length && !rows.length && !reported.some(name => LINE_TOOL_REGISTRY.find(tool => tool.name === name)?.category === 'draft_update')) return null;
    return rows.map(row => row.id);
  }

  /** Only an API-bound, deterministic expense presentation with complete matching API reads can
   *  authorize a future criterion confirmation. The reply text, Gateway telemetry and old amounts
   *  are never persisted as evidence. */
  async deliveredExpenseSummaryForTurn(request: LineAiTurnRequest, response: LineAiTurnResponse): Promise<LineAiConversationContext['deliveredExpenseSummary'] | undefined> {
    if (response.deterministicExpenseSummary !== true || response.refused || !request.userContext.chatKeyHash
      || !Array.isArray(response.toolCalls) || response.toolCalls.length === 0 || response.toolCalls.length > 24
      || response.toolCalls.some(call => call.name !== 'expense.list_recent' || call.status !== 'ok')) return undefined;
    const mentions = thaiMonthMentions(request.messageText);
    if (!mentions) return undefined;
    const anchored = anchoredPriorMonth(request);
    if (anchored === null) return undefined;
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId: request.userContext.companyId, userId: request.userContext.internalUserId, requestId: request.requestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LINE_READ_EVIDENCE_MAX + 1,
      select: { toolName: true, membershipId: true, inputJson: true },
    });
    if (rows.length !== response.toolCalls.length || rows.length > LINE_READ_EVIDENCE_MAX
      || rows.some(row => row.toolName !== 'expense.list_recent' || row.membershipId !== request.userContext.membershipId)) return undefined;
    const ranges: NonNullable<LineAiConversationContext['deliveredExpenseSummary']>['ranges'] = [];
    const months = new Set<number>();
    for (const row of rows) {
      const saved = row.inputJson as { input?: unknown; chatKeyHash?: unknown; expenseSummary?: unknown } | null;
      const descriptor = saved?.expenseSummary as ExpenseSummaryEvidence | undefined;
      if (!saved || saved.chatKeyHash !== request.userContext.chatKeyHash || !descriptor
        || descriptor.statusBasis !== EXPENSE_STATUS_BASIS || descriptor.truncated
        || !isCivilDate(descriptor.fromDate) || !isCivilDate(descriptor.toDate) || descriptor.fromDate > descriptor.toDate
        || !(descriptor.branchId === null || (typeof descriptor.branchId === 'string' && descriptor.branchId.length > 0 && descriptor.branchId.length <= 200))) return undefined;
      const input = saved.input as Record<string, unknown> | undefined;
      if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
      // Preserve all supported period representations; never reinterpret a malformed one as default.
      const hasFrom = input['fromDate'] !== undefined, hasTo = input['toDate'] !== undefined, hasPeriod = input['periodKey'] !== undefined;
      if (hasPeriod) {
        if (hasFrom || hasTo || !isCivilPeriodKey(input['periodKey'])) return undefined;
        const period = civilPeriodRange(input['periodKey']);
        if (period.startDate !== descriptor.fromDate || period.endDate !== descriptor.toDate) return undefined;
      } else if (hasFrom !== hasTo || (hasFrom && (input['fromDate'] !== descriptor.fromDate || input['toDate'] !== descriptor.toDate))) return undefined;
      if (descriptor.defaultedToCurrentMonth !== (!hasPeriod && !hasFrom && !hasTo)) return undefined;
      const coveredMonths = rangeMonths(descriptor.fromDate, descriptor.toDate);
      if (!coveredMonths) return undefined;
      coveredMonths.forEach(month => months.add(month));
      ranges.push({ fromDate: descriptor.fromDate, toDate: descriptor.toDate, branchId: descriptor.branchId });
    }
    const inheritedRanges = request.conversationContext?.deliveredExpenseSummary?.ranges ?? [];
    const branchRequested = expenseBranchScopeRequested(request.messageText);
    const allBranchesRequested = allExpenseBranchesRequested(request.messageText);
    const branchFollowupWithoutReference = branchRequested && inheritedRanges.length === 0
      && /(?:ดู\s*เฉพาะ|เอา\s*เฉพาะ|อันนี้)/iu.test(request.messageText)
      && (request.valueCandidates?.periods?.length ?? 0) === 0 && (request.valueCandidates?.dates?.length ?? 0) === 0
      && anchored === undefined;
    if (branchFollowupWithoutReference) return undefined;
    if (branchRequested && rows.some(row => {
      const saved = row.inputJson as { input?: Record<string, unknown>; expenseSummary?: ExpenseSummaryEvidence } | null;
      const input = saved?.input;
      const descriptor = saved?.expenseSummary;
      return typeof input?.['branchId'] !== 'string' || !descriptor || descriptor.branchId === null
        || !messageIdentifiesBranch(input['branchId'], request.messageText);
    })) return undefined;
    if (allBranchesRequested && rows.some(row => {
      const saved = row.inputJson as { input?: Record<string, unknown>; expenseSummary?: ExpenseSummaryEvidence } | null;
      return saved?.input?.['branchId'] !== undefined || saved?.expenseSummary?.branchId !== null;
    })) return undefined;
    if (!allBranchesRequested && !branchRequested && inheritedRanges.some(range => range.branchId !== null) && rows.some(row => {
      const saved = row.inputJson as { input?: Record<string, unknown>; expenseSummary?: ExpenseSummaryEvidence } | null;
      const branchId = saved?.expenseSummary?.branchId;
      return branchId === null || typeof saved?.input?.['branchId'] !== 'string' || saved.input['branchId'] !== branchId
        || !inheritedRanges.some(prior => prior.branchId === branchId);
    })) return undefined;
    if (!allBranchesRequested && !branchRequested && inheritedRanges.every(range => range.branchId === null) && rows.some(row => {
      const saved = row.inputJson as { input?: Record<string, unknown> } | null;
      return saved?.input?.['branchId'] !== undefined;
    })) return undefined;
    const requestedPeriods = anchored ? [anchored] : request.valueCandidates?.periods ?? [];
    const latestRefresh = mentions.length === 0 && requestedPeriods.length === 0 && /(?:ล่าสุด|ปัจจุบัน|ตอนนี้|current|latest|recent)/iu.test(request.messageText);
    const expectedRanges = requestedPeriods.length > 0
      ? requestedPeriods.map(period => ({ fromDate: period.fromDate, toDate: period.toDate }))
      : latestRefresh && rows.every(row => {
        const saved = row.inputJson as { expenseSummary?: ExpenseSummaryEvidence } | null;
        return saved?.expenseSummary?.defaultedToCurrentMonth === true;
      }) ? ranges.map(range => ({ fromDate: range.fromDate, toDate: range.toDate }))
      : inheritedRanges.length > 0 && ranges.length === inheritedRanges.length
        ? inheritedRanges.map(range => ({ fromDate: range.fromDate, toDate: range.toDate }))
        : mentions.length === 0 && rows.every(row => {
          const saved = row.inputJson as { expenseSummary?: ExpenseSummaryEvidence } | null;
          return saved?.expenseSummary?.defaultedToCurrentMonth === true;
        }) ? ranges.map(range => ({ fromDate: range.fromDate, toDate: range.toDate }))
        : [];
    if (expectedRanges.length === 0 || expectedRanges.length !== ranges.length
      || expectedRanges.some(expected => !ranges.some(range => range.fromDate === expected.fromDate && range.toDate === expected.toDate))) return undefined;
    if (new Set(expectedRanges.map(range => `${range.fromDate}:${range.toDate}`)).size !== expectedRanges.length
      || new Set(ranges.map(range => `${range.fromDate}:${range.toDate}`)).size !== ranges.length) return undefined;
   if (mentions.some(month => !months.has(month))) return undefined;
    if (mentions.length > 0 && requestedPeriods.length === 0) return undefined;
    const continuationOfPrior = inheritedRanges.length > 0
      && expectedRanges.every(expected => inheritedRanges.some(prior => prior.fromDate === expected.fromDate && prior.toDate === expected.toDate))
      && (requestedPeriods.length === 0 || /เฉพาะ|only|just/iu.test(request.messageText));
    return { version: 1, deliveredAt: new Date().toISOString(), statusBasis: 'exclude_rejected_voided', ranges,
      ...(continuationOfPrior ? { continuationOfPrior: true as const } : {}) };
  }

  /**
   * Spec §4 R-M1/R-M2/R-M7: this turn's own read-memory entries (oldest read first), for the caller
   * to persist once delivery is confirmed so a FUTURE turn's `loadConversationContext` can offer them
   * as `recentReads`. Group/room chats have no `chatKeyHash` (R-M7) and get undefined, same as
   * `deliveredExpenseSummaryForTurn`. A row whose tool the gateway did not report as a successful call
   * makes the whole result untrustworthy (undefined) rather than silently dropping just that one —
   * the same conservative failure mode `forTurn` uses for its own evidence/telemetry cross-check.
   */
  async recentReadsForTurn(request: LineAiTurnRequest, response: LineAiTurnResponse): Promise<LineAiReadMemory[] | undefined> {
    if (response.refused || !request.userContext.chatKeyHash || !Array.isArray(response.toolCalls)) return undefined;
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId: request.userContext.companyId!, userId: request.userContext.internalUserId!, requestId: request.requestId,
        toolName: { in: [...READ_MEMORY_TOOLS] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LINE_READ_EVIDENCE_MAX + 1,
      select: { toolName: true, membershipId: true, inputJson: true },
    });
    if (rows.length > LINE_READ_EVIDENCE_MAX) return undefined;
    if (rows.length === 0) return [];
    const okToolNames = new Set(response.toolCalls.filter(call => call.status === 'ok').map(call => call.name));
    const entries: LineAiReadMemory[] = [];
    for (const row of rows) {
      if (!okToolNames.has(row.toolName) || row.membershipId !== request.userContext.membershipId) return undefined;
      const saved = row.inputJson as { chatKeyHash?: unknown; readMemory?: unknown } | null;
      if (!saved || saved.chatKeyHash !== request.userContext.chatKeyHash) return undefined;
      const memory = saved.readMemory as LineAiReadMemory | undefined;
      if (!memory || memory.tool !== row.toolName) return undefined;
      entries.push(memory);
    }
    return entries;
  }

  async isReadFreeExpenseCriterionConfirmation(request: LineAiTurnRequest, response: LineAiTurnResponse): Promise<boolean> {
    if (response.deterministicExpenseCriterionConfirmation !== true || response.refused
      || response.toolsInvoked.length !== 0 || (response.toolCalls?.length ?? 0) !== 0
      || response.sourceRefs.length !== 0 || response.sourceLabels.length !== 0 || response.webLinks.length !== 0
      || response.presentation !== undefined
      || !(Object.values(LINE_AI_EXPENSE_CRITERION_REPLIES) as readonly string[]).includes(response.replyText)
      || !isExpenseCriterionOnlyText(request.messageText,
        request.conversationContext?.deliveredExpenseSummary?.statusBasis === 'exclude_rejected_voided'
        && request.conversationContext.deliveredExpenseSummary.ranges.length > 0)
      || (request.attachments?.length ?? 0) > 0
      || (request.valueCandidates?.dates?.length ?? 0) > 0
      || (request.valueCandidates?.periods?.length ?? 0) > 0
      ) return false;
    const expenseTool = LINE_TOOL_REGISTRY.find(tool => tool.name === 'expense.list_recent');
    if (!expenseTool) return false;
    const access = await this.resolver.resolveAccess(request.userContext.internalUserId, request.userContext.companyId);
    if (access.companyId !== request.userContext.companyId || !access.permissions.includes('ai.tool.invoke')
      || !hasToolPermissions(expenseTool, access.permissions)) return false;
    const entitled = await loadEntitledFeatureKeys(this.prisma, request.userContext.companyId);
    if (!hasToolFeature(expenseTool, entitled)) return false;
    const saved = request.conversationContext?.deliveredExpenseSummary;
    if (response.replyText === LINE_AI_EXPENSE_CRITERION_REPLIES.deliveredTh
      || response.replyText === LINE_AI_EXPENSE_CRITERION_REPLIES.deliveredEn) {
      if (!saved || saved.statusBasis !== 'exclude_rejected_voided' || !Number.isFinite(Date.parse(saved.deliveredAt))
        || saved.ranges.length === 0 || saved.ranges.length > 24) return false;
    }
    const count = await this.prisma.client.lineReadEvidence.count({ where: {
      companyId: request.userContext.companyId, userId: request.userContext.internalUserId, requestId: request.requestId,
    } });
    return count === 0;
  }

  async verifyDelivery(value: unknown, recipient: { webhookEventId: string; lineUserId: string; chatId: string; channelId: string }): Promise<boolean> {
    const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const hasRead = !!root && Object.prototype.hasOwnProperty.call(root, 'read');
    const read = hasRead ? parseLineReadDeliveryAuthorization(value) : null;
    const accessProof = !hasRead ? parseExpenseCriterionAccessAuthorization(value) : null;
    const proof = hasRead ? read : accessProof;
    if (!proof || proof.webhookEventId !== recipient.webhookEventId || recipient.lineUserId !== recipient.chatId
      || proof.channelId !== recipient.channelId
      || proof.recipientHash !== lineDeliveryRecipientHash(recipient.lineUserId, recipient.chatId, recipient.channelId)) return false;
    if (read && !await this.verify(read.companyId, read.userId, read.requestId, read.ids)) return false;
    // Resolve again after potentially slow source reads; source access is not actor continuity.
    const where = { provider: 'LINE' as const, status: 'ACTIVE' as const, providerUserId: recipient.lineUserId };
    // An explicit canonical unlink must beat an older active alias, just as on the live webhook path.
    const scoped = recipient.channelId ? await this.prisma.client.externalIdentity.findFirst({ where: {
      provider: 'LINE', providerUserId: recipient.lineUserId, providerChannelId: recipient.channelId,
    }, include: { user: true } }) : null;
    if (scoped && scoped.status !== 'ACTIVE') return false;
    const identity = scoped ?? await this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    if (!identity || identity.userId !== proof.userId || identity.user.status !== 'ACTIVE' || identity.user.aiAssistantOptOutAt) return false;
    const access = await this.resolver.resolveAccess(proof.userId, proof.companyId);
    const entitled = await loadEntitledFeatureKeys(this.prisma, proof.companyId);
    const context = await this.prisma.client.lineCompanyContext.findUnique({ where: { lineUserId: recipient.lineUserId }, select: { companyId: true, aiPausedUntil: true } });
    return (!context?.companyId || context.companyId === proof.companyId)
      && (!context?.aiPausedUntil || context.aiPausedUntil.getTime() <= Date.now())
      && proof.fingerprint === resolvedLineDeliveryAccessFingerprint(proof.userId, proof.companyId, access, entitled);
  }

  /** Read implementations only. This never invokes a model, capture, preview, approval or mutation. */
  async verify(companyId: string, userId: string, requestId: string, ids: readonly string[], now = new Date()): Promise<boolean> {
    if (!ids.length || ids.length > LINE_READ_EVIDENCE_MAX || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return false;
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { status: true, aiAssistantOptOutAt: true } });
    if (!user || user.status !== 'ACTIVE' || user.aiAssistantOptOutAt) return false;
    const access = await this.resolver.resolveAccess(userId, companyId);
    if (access.companyId !== companyId || !access.permissions.includes('ai.tool.invoke')) return false;
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    const rows = await this.prisma.client.lineReadEvidence.findMany({ where: {
      id: { in: [...ids] }, companyId, userId, requestId, membershipId: access.membershipId,
      createdAt: { gte: new Date(now.getTime() - LINE_READ_EVIDENCE_MAX_AGE_MS), lte: new Date(now.getTime() + 30_000) },
    }, orderBy: { id: 'asc' } });
    if (rows.length !== ids.length) return false;
    for (const row of rows) {
      const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === row.toolName), tool = this.tools.get(row.toolName);
      if (!meta || !tool || !READ_CATEGORIES.has(meta.category) || !hasToolPermissions(meta, access.permissions) || !hasToolFeature(meta, entitled)) return false;
      const saved = row.inputJson as { input?: unknown; locale?: unknown; chatKeyHash?: unknown; whtGrounding?: unknown } | null;
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !saved.input
        || typeof saved.input !== 'object' || Array.isArray(saved.input) || typeof saved.locale !== 'string'
        || (saved.chatKeyHash !== undefined && typeof saved.chatKeyHash !== 'string')
        || Buffer.byteLength(JSON.stringify(saved), 'utf8') > LINE_READ_EVIDENCE_MAX_INPUT_BYTES) return false;
      const current = await tool.execute({ requestId, companyId, userId, membershipId: access.membershipId,
        permissions: access.permissions, roles: access.roles, branchIds: access.scopes.branchIds,
        locationIds: access.scopes.locationIds, locale: saved.locale, chatKeyHash: saved.chatKeyHash as string | undefined,
        ...(row.toolName === 'wht.calculate_withholding' && typeof saved.whtGrounding === 'string' ? { groundingText: saved.whtGrounding } : {}),
      }, saved.input as Record<string, unknown>);
      if (current.status !== 'ok' || lineReadResultHash(current) !== row.resultHash) return false;
    }
    return true;
  }
}

/** LINE permits at most 13 quick replies. These are plain user messages, never mutation controls. */
export function parseWhtReadChoices(value: unknown): Array<{ label: string; text: string; webPath?: string }> | undefined {
  if (!Array.isArray(value) || value.length > 13 || value.some(v => !v || typeof v.label !== 'string' || !v.label.trim()
    || Array.from(v.label).length > 20 || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 500
    || v.webPath !== undefined && v.webPath !== '/system/wht-income-categories')) return undefined;
  return value.map(({ label, text, webPath }) => ({ label, text, ...(webPath ? { webPath } : {}) }));
}
