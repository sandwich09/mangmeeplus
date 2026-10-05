import { THAI_SYSTEM_ROLE_NAMES, formatThaiDate, isCivilDate, mapThaiDigits, type SpecialistOutput, type ToolResult } from '@watchdog-bms/contracts';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

const LEGACY_INCOMPLETE_KEY = /truncat|partial|capped|incomplete/i;

/** Aggregate truth is independent from bounded detail rows. */
export function aggregationIncomplete(data: UnknownRecord): boolean {
  const completeness = record(data['completeness']);
  const aggregate = completeness?.['aggregate'];
  if (aggregate !== undefined && aggregate !== 'complete') return true;
  return Object.entries(data).some(([key, value]) => LEGACY_INCOMPLETE_KEY.test(key) && Boolean(value));
}

export function appliedPeriod(data: UnknownRecord | undefined): { fromDate: string; toDate: string } | undefined {
  const query = record(data?.['queryApplied']);
  const period = record(query?.['period']);
  const startDate = period?.['startDate'];
  const endDate = period?.['endDate'];
  if (typeof startDate === 'string' && typeof endDate === 'string') return { fromDate: startDate, toDate: endDate };
  return undefined;
}

export function aggregateState(data: UnknownRecord | undefined): 'known' | 'empty' | 'unknown' | 'conflict' {
  if (!data || aggregationIncomplete(data)) return 'unknown';
  if (data['mixedCurrency'] === true && data['totalAmount'] !== null) return 'conflict';
  const facts = Array.isArray(data['facts']) ? data['facts'] : [];
  if (facts.some((item) => record(item)?.['state'] === 'conflict')) return 'conflict';
  if (facts.length > 0 && facts.every((item) => record(item)?.['state'] === 'empty')) return 'empty';
  return 'known';
}

/**
 * Item 2 (223-turn eval batch 2): expense.list_recent AND expense.get_breakdown both resolve a
 * free-text branch/category/vendor name server-side; several matches or none must become a real
 * clarification instead of silently falling through to a misleading zero/empty answer, or (the
 * model-driven path's failure mode) a raw TOOL_RESULT_NO_SOURCE code parroted at the customer.
 * Shared here, not defined in either agent file, because orchestrator.agent.ts and
 * semantic-turn-v2.ts are mutually circular (orchestrator.agent.ts imports runSemanticTurnV2).
 */
export type ExpenseNameResolutionIssue = {
  kind: 'ambiguous' | 'not_found' | 'out_of_scope';
  field: 'branch' | 'category' | 'vendor';
  requested: string;
  names: string[];
};

const EXPENSE_NAME_FIELDS: Array<{ field: ExpenseNameResolutionIssue['field']; ambiguousKey: string; unresolvedKey: string; outOfScopeKey?: string; availableKey: string }> = [
  // Item (branch-out-of-scope outcome): erp-tools.use-case.ts's ExpenseListRecentTool also reports
  // `branchOutOfScope` — a branch that exists in the company but outside this caller's OWN branch
  // scope. Only `branch` has this third shape; category/vendor names have no scope concept.
  { field: 'branch', ambiguousKey: 'branchAmbiguous', unresolvedKey: 'branchUnresolved', outOfScopeKey: 'branchOutOfScope', availableKey: 'availableBranches' },
  { field: 'category', ambiguousKey: 'categoryAmbiguous', unresolvedKey: 'categoryUnresolved', availableKey: 'availableCategories' },
  { field: 'vendor', ambiguousKey: 'vendorAmbiguous', unresolvedKey: 'vendorUnresolved', availableKey: 'availableVendors' },
];

/** Reads ONE tool result's raw `data` (never a specialist's shaped facts, which do not carry these
 *  keys through) for a branch/category/vendor ambiguity, not-found, or (branch only) out-of-scope marker. */
function expenseNameResolutionIssueFromData(data: UnknownRecord | undefined): ExpenseNameResolutionIssue | undefined {
  if (!data) return undefined;
  for (const { field, ambiguousKey, unresolvedKey, outOfScopeKey, availableKey } of EXPENSE_NAME_FIELDS) {
    const ambiguous = data[ambiguousKey], unresolved = data[unresolvedKey], outOfScope = outOfScopeKey ? data[outOfScopeKey] : undefined;
    const requested = typeof ambiguous === 'string' ? ambiguous : typeof outOfScope === 'string' ? outOfScope : typeof unresolved === 'string' ? unresolved : undefined;
    if (requested === undefined) continue;
    const available = Array.isArray(data[availableKey]) ? data[availableKey] as Array<UnknownRecord> : [];
    const names = available.map((item) => String(item['name'] ?? '').trim()).filter(Boolean).slice(0, 5);
    const kind = typeof ambiguous === 'string' ? 'ambiguous' : typeof outOfScope === 'string' ? 'out_of_scope' : 'not_found';
    return { kind, field, requested, names };
  }
  return undefined;
}

/** Same lookup across every read this turn's expense.list_recent/expense.get_breakdown/
 *  expense.get_daily_closing outputs carried, classic-path or fast-lane alike. F3 (tuning-6b): the
 *  daily closing tool now resolves its branchId the same way (resolveExpenseBranchFilter), so its
 *  ambiguous/unresolved/out-of-scope result needs the same honest reply, not the generic fallback. */
export function expenseNameResolutionIssue(outputs: SpecialistOutput[]): ExpenseNameResolutionIssue | undefined {
  for (const output of outputs) {
    for (const entry of output.toolData ?? []) {
      if (entry.tool !== 'expense.list_recent' && entry.tool !== 'expense.get_breakdown' && entry.tool !== 'expense.get_daily_closing') continue;
      const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data as UnknownRecord : undefined;
      const issue = expenseNameResolutionIssueFromData(data);
      if (issue) return issue;
    }
  }
  return undefined;
}

const EXPENSE_NAME_FIELD_TH: Record<ExpenseNameResolutionIssue['field'], string> = { branch: 'สาขา', category: 'หมวด', vendor: 'ร้าน' };
const EXPENSE_NAME_FIELD_EN: Record<ExpenseNameResolutionIssue['field'], string> = { branch: 'branch', category: 'category', vendor: 'vendor' };

/** Up to 5 display names, comma-joined — every branch below uses the same list rendering. */
function joinedNames(names: string[]): string {
  return names.join(', ');
}

/** C4 (batch 5c): the eval scored "เลือกจากหน้าเว็บ" as a dead end/refusal — every reply must leave
 *  the customer something to DO in the chat, so this is the one line every terminal (non-question)
 *  branch below ends on. */
function nameResolutionNextStepText(english: boolean): string {
  return english ? 'Just type the name you mean.' : 'พิมพ์ชื่อที่ต้องการมาได้เลยค่ะ';
}

/** Ambiguous -> a real clarifying question ("หมายถึงร้านไหนคะ" + up to 5 options) when the matches
 *  have distinct display names — an actual chat-answerable question. Several matches sharing the
 *  EXACT same display name cannot be told apart in text at all (never print the internal id/code
 *  that could, nor `issue.requested` itself — see the branch below): C4 asks for other context
 *  instead, never "select it on the web". Out-of-scope (branch only) states the caller's OWN
 *  visible branches, never the forbidden branch's data, then invites them to ask about what they
 *  CAN see. Not-found never claims certainty the model doesn't have ("ยังระบุ...ไม่ได้" read as a
 *  system limitation) — it states the fact ("ไม่พบ...") and asks for the name again, matching the
 *  eval's "ไม่พบ|ไม่มี" honesty check. */
export function expenseNameResolutionReplyText(issue: ExpenseNameResolutionIssue, english: boolean): string {
  const th = EXPENSE_NAME_FIELD_TH[issue.field], en = EXPENSE_NAME_FIELD_EN[issue.field];
  const uniqueNames = [...new Set(issue.names)];
  const names = joinedNames(uniqueNames);
  if (issue.kind === 'ambiguous') {
    if (uniqueNames.length > 1) {
      return english
        ? `A few ${en}s have a name similar to "${issue.requested}": ${names}. Which ${en} do you mean?`
        : `มี${th}ที่ชื่อคล้าย "${issue.requested}" หลาย${th}ค่ะ: ${names} หมายถึง${th}ไหนคะ`;
    }
    // Every match has the SAME display name, so — unlike the distinct-names case above — neither
    // `issue.requested` nor a candidate's own id/code is safe to print here: none of it would help
    // tell them apart, and the caller-sent value in `requested` is not always a name the customer
    // themselves typed (e.g. a raw id the model echoed back). Ask for other context instead.
    return english
      ? `A few ${en}s share that exact name, so I can't tell them apart from the name alone. Try adding another detail and asking again.`
      : `มีหลาย${th}ที่ใช้ชื่อเดียวกันค่ะ แยกให้ไม่ได้จากชื่ออย่างเดียว ลองเพิ่มรายละเอียดอื่น แล้วถามอีกครั้งได้เลยค่ะ`;
  }
  if (issue.kind === 'out_of_scope') {
    return english
      ? `You can only view branch(es): ${names}. Feel free to ask about those.`
      : `คุณดูข้อมูลได้เฉพาะสาขา ${names} ค่ะ ถามข้อมูลสาขาที่ดูได้เลยค่ะ`;
  }
  return english
    ? `I could not find a ${en} named "${issue.requested}".${names ? ` ${en}s available: ${names}.` : ''} ${nameResolutionNextStepText(true)}`
    : `ไม่พบ${th}ชื่อ "${issue.requested}" ค่ะ${names ? ` ${th}ที่มี เช่น ${names}` : ''} ${nameResolutionNextStepText(false)}`;
}

// ─── reimbursement.list_pending_approvals forbidden outcome ────────────────────────────────────
// erp-reimbursement-tools.use-case.ts (ReimbursementListPendingApprovalsTool) returns status
// 'forbidden' with this errorCode for a caller without `reimbursement.approve` — a real, typed
// outcome, not a bare denial, so both lanes can name the one thing this caller CAN ask about (their
// own claim) instead of the generic "no permission" line. Shared here for the same reason as the
// name-resolution helpers above: orchestrator.agent.ts (via prepared-simple-read-formatter.ts's
// preparedTerminalReply) and semantic-turn-v2.ts both render it, and must say the same thing.
export const REIMBURSEMENT_APPROVAL_NOT_PERMITTED = 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED';

/** Terminal, permission-scoped answer — never a question, never a waiting task. */
export function reimbursementApprovalNotPermittedReplyText(english: boolean): string {
  return english
    ? 'Your role does not have permission to view or approve other people\'s reimbursement claims. If you want to check your own claim, just ask — for example, "How is my reimbursement claim going?"'
    : 'บทบาทของคุณยังไม่มีสิทธิ์ดูหรืออนุมัติใบเบิกของคนอื่นค่ะ ถ้าต้องการดูใบเบิกของตัวเอง ถามได้เลย เช่น “ใบเบิกของฉันถึงไหนแล้ว”';
}

// ─── Advisor S3: reimbursement.get_approval_backlog wording that must not depend on the model ──────
// Eval 2026-09-30/10-01 (R-20): with nothing waiting, a manager who had never filed a claim was told all of theirs had
// been processed. An empty backlog has one true answer per scope, so it is rendered here and never composed.
export function emptyApprovalBacklogReplyText(data: unknown, english: boolean): string | undefined {
  const backlog = record(data);
  if (backlog?.['total'] !== 0) return undefined;
  if (backlog['accessScope'] === 'own') {
    return backlog['hasOwnClaims'] === false
      ? (english ? 'You have no reimbursement claims yet.' : 'คุณยังไม่มีใบเบิกในระบบค่ะ')
      : (english ? 'None of your reimbursement claims is waiting right now.' : 'ตอนนี้ไม่มีใบเบิกของคุณที่รออยู่ค่ะ');
  }
  if (backlog['accessScope'] === 'related') {
    return english ? 'No reimbursement claim related to you is waiting right now.' : 'ตอนนี้ไม่มีใบเบิกที่เกี่ยวข้องกับคุณที่รออยู่ค่ะ';
  }
  return english ? 'No reimbursement claim is waiting right now.' : 'ตอนนี้ไม่มีใบเบิกที่รออยู่ค่ะ';
}

// Eval 2026-09-30/10-01 (R-01, R-12): the backlog total also counts claims already approved and waiting for finance or
// payment, yet composed answers opened with "ค้างอนุมัติรวม 8 ใบ". Only that total, and only when it is more than what
// still waits for an approver, is re-worded to "ค้างอยู่"; a group's own "ค้างอนุมัติ 2 ใบ" is left alone.
export function approvalBacklogStageWording(text: string, data: unknown): string {
  const backlog = record(data);
  const total = backlog?.['total'], awaiting = backlog?.['awaitingApprovalCount'];
  if (typeof total !== 'number' || typeof awaiting !== 'number' || total <= awaiting) return text;
  const count = [...new Set([String(total), total.toLocaleString('en-US')])].join('|');
  return text.replace(new RegExp(`(ค้าง|รอ)(?:การ)?อนุมัติ(\\s*(?:อยู่)?\\s*(?:รวม|ทั้งหมด)?\\s*)(${count})(\\s*(?:ใบ|รายการ))`, 'gu'),
    (_match, verb: string, middle: string, number: string, unit: string) => `${verb}${middle.includes('อยู่') ? '' : 'อยู่'}${middle}${number}${unit}`);
}

// ─── billing.get_package_usage forbidden outcome (advisor spec §5.1, P8) ─────────────────────────
// erp-package-tools.use-case.ts refuses a caller without `company.plan.manage` with this errorCode.
// Owner decision 2026-09-30 (§10 item 2): that caller hears one fixed sentence, whatever the clause
// asked (figures, an upgrade, a package change) — never a figure, never a package link, and never a
// wrong reason such as "the package does not include this".
export const PACKAGE_MANAGER_REQUIRED = 'PACKAGE_MANAGER_REQUIRED';

export function packageManagerRequiredReplyText(english: boolean): string {
  return english
    ? 'For this shop\'s package and credit, please ask the shop owner or someone who manages the package.'
    : `เรื่องแพ็กเกจและเครดิตของร้าน ถาม${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจได้นะคะ`;
}

// Owner 2026-09-30 (no upsell): a package answer tells nobody how or where to buy, change, upgrade or renew a package
// unless the clause asked that. ANSWER_PROMPT says so, yet answers kept closing with it in two shapes: the invitation
// "หากต้องการเปลี่ยนแพ็กเกจ ทำได้บนเว็บ…" (advisor eval r5, r6, r10) and the plain statement "การซื้อหรือเปลี่ยนแพ็กเกจ
// ทำได้บนเว็บ ที่หน้าแพ็กเกจของร้านค่ะ" (final-assembly run, P-32). Both are cut here, from where they start to the end of
// their sentence; what stands before them on the line stays. The package page link is not text: it rides sourceRefs
// and only ever goes to someone who may manage the plan.
export const PACKAGE_TOOL_NAMES: ReadonlySet<string> = new Set(['billing.get_package_usage', 'billing.get_package_catalog']);
const PURCHASE_VERB = '(?:ซื้อ(?:เพิ่ม)?|เปลี่ยน|อัป?เกรด|อัพเกรด|ต่ออายุ)';
// The clause asks about buying or changing ("อัปเกรดยังไง", "เปลี่ยนแพ็กเกจที่ไหน", "แล้วถ้าอัปเกรดล่ะ"), not a price or
// what a package holds: "ถ้าซื้อรายปีราคาเท่าไหร่" names buying yet asks a price.
const PURCHASE_WORD = new RegExp(`${PURCHASE_VERB}|upgrad|\\bbuy|\\bchang|\\brenew`, 'iu');
const HOW_OR_WHERE = /ยังไง|อย่างไร|ที่ไหน|ตรงไหน|ทางไหน|ทำไง|วิธี|ขั้นตอน|\bhow (?:do|can|to)\b|\bwhere\b/iu;
const PRICE_OR_CONTENTS = /ราคา|เท่าไหร่|เท่าไร|กี่บาท|อะไรบ้าง|ได้อะไร|ต่างกัน|เทียบ|\bprice|how much|\bcost|\binclude|\bcompare/iu;
// A sentence runs to its closing particle (or the line's end); "นะคะ" closes on "คะ".
const SENTENCE_REST = '(?:(?!(?:ค่ะ|คะ|ครับ|นะ)(?:[ \\t]|$))[^\\n])*';
const SENTENCE_END = '(?:(?:ค่ะ|คะ|ครับ|นะ)(?:[ \\t]*\\p{Extended_Pictographic}\\uFE0F?)*)?';
const WHERE_OR_HOW = '(?:บนเว็บ|ทางเว็บ|ผ่านเว็บ|หน้าเว็บ|เว็บไซต์|หน้าแพ็?[กค]เกจ|ติดต่อ(?:เจ้าหน้าที่|ทีมงาน|แอดมิน))';
const UNASKED_PURCHASE_SENTENCE = new RegExp([
  // "หาก/ถ้า ต้องการ|สนใจ|อยาก … ซื้อ/เปลี่ยน/อัปเกรด/ต่ออายุ …": an invitation, wherever it sends the reader.
  `[ \\t]*(?:(?:และ|หรือ|แต่)[ \\t]*)?(?:หาก|ถ้า)[ \\t]*(?:ต้องการ|สนใจ|อยาก)(?=${SENTENCE_REST}${PURCHASE_VERB})`
    + `(?=${SENTENCE_REST}(?:แพ็?[กค]เกจ|อัป?เกรด|อัพเกรด|ต่ออายุ))${SENTENCE_REST}${SENTENCE_END}`,
  // "การซื้อหรือเปลี่ยนแพ็กเกจทำได้บนเว็บ …", "สามารถอัปเกรดได้ที่หน้าแพ็กเกจ …": a statement of where or how. It starts
  // a clause, so "ยังไม่ได้ตั้งต่ออายุอัตโนมัติ" (a fact about this package) is never taken for one.
  `(?<![\\u0E00-\\u0E7F])[ \\t]*(?:(?:ส่วน|และ|โดย|ทั้งนี้|นอกจากนี้)[ \\t]*)?(?:(?:คุณ|ร้าน|ลูกค้า|ท่าน)[ \\t]*)?(?:การ|สามารถ)?`
    + `(?:เพิ่ม(?:หรือ|และ))?${PURCHASE_VERB}(?:(?:หรือ|และ)(?:${PURCHASE_VERB}|เพิ่ม))*`
    + `(?=${SENTENCE_REST}แพ็?[กค]เกจ)(?=${SENTENCE_REST}${WHERE_OR_HOW})${SENTENCE_REST}${SENTENCE_END}`,
  String.raw`[ \t]*if you(?:'d| would)? (?:like|want|wish|need) to (?:buy|change|upgrade|renew)\b[^.!?\n]*[.!?]?`,
  String.raw`(?<![a-z])[ \t]*(?:you can |to )?(?:buy(?:ing)?|chang(?:e|ing)|upgrad(?:e|ing)|renew(?:ing)?)\b[^.!?\n]*\bpackage[^.!?\n]*(?:on the web|website|package page)[^.!?\n]*[.!?]?`,
].join('|'), 'gimu');
// What a cut can leave behind on its line: a joining word at the end, or only a bullet or a "หมายเหตุ:" label.
const DANGLING_JOIN = /[ \t]*(?:และ|ส่วน|โดย|แต่|ทั้งนี้|นอกจากนี้|[,—–-])?[ \t]*$/u;
const EMPTY_LABEL = /^(?:[•·▪◦*-]|\d+[.)])?[ \t]*(?:หมายเหตุ|note)?[ \t]*[:：]?[ \t]*$/iu;

export function withoutUnaskedPackagePurchaseLine(text: string, clauseText: string): string {
  if (PURCHASE_WORD.test(clauseText) && (HOW_OR_WHERE.test(clauseText) || !PRICE_OR_CONTENTS.test(clauseText))) return text;
  let changed = false;
  const lines = text.split('\n').flatMap((line) => {
    const cut = line.replace(UNASKED_PURCHASE_SENTENCE, '');
    if (cut === line) return [line];
    changed = true;
    const rest = cut.replace(DANGLING_JOIN, '');
    return EMPTY_LABEL.test(rest) ? [] : [rest];
  });
  if (!changed) return text;
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim() || text;
}

// ─── A3 (batch5, T-084-b): reimbursement.list_pending_approvals has no code-computed total ───────
// erp-reimbursement-tools.use-case.ts's ReimbursementListPendingApprovalsTool returns `total` (the
// full count, never truncated) and `items` capped to the first 10 rows — no total AMOUNT at all.
// Sum the shown items in code, and only when nothing is missing (`items` actually holds every row,
// i.e. total <= 10) and every row shares one currency; a partial sum would silently understate a
// longer queue. Joins the SAME derivedFacts path as the comparison/share facts below, so compose can
// cite the total and grounding allows it (run 4 rejected 7 composed answers stating it).
export function reimbursementPendingApprovalsTotal(data: UnknownRecord): string | undefined {
  const total = data['total'];
  const items = Array.isArray(data['items']) ? data['items'] as UnknownRecord[] : [];
  if (typeof total !== 'number' || items.length === 0 || items.length !== total) return undefined;
  const currencies = new Set(items.map((item) => String(item['currency'] ?? '')));
  if (currencies.size !== 1 || [...currencies][0] === '') return undefined;
  const sum = items.reduce((acc, item) => acc + Number(item['amount'] ?? 0), 0);
  if (!Number.isFinite(sum)) return undefined;
  return `ใบเบิกรออนุมัติทั้งหมด: ${total} รายการ รวม ${formatSignedMoney(sum)} บาท`;
}

// ─── Item 3 (223-turn eval batch 2): period comparisons and breakdown shares ───────────────────
// "เทียบกับเดือนที่แล้วเป็นยังไงบ้าง" style turns kept failing compose because the model computed
// its own difference/percentage across two tool results and grounding correctly rejected numbers
// nobody's tool result actually contained. Compute the SAME arithmetic here, in code, from the
// SAME two already-permission-checked results, so it is never a number the model invented.

type ExpensePeriodTotals = {
  fromDate: string;
  toDate: string;
  totalAmount: string;
  count: number;
  /** Same-shaped sub-split when the tool result carries one: get_breakdown's byCategory/byBranch/
   *  byVendor rows (whichever `queryApplied.filters.groupBy` actually applied — A8/T-082-a: this
   *  used to always read byCategory, so a vendor-grouped comparison silently answered with category
   *  rows), or list_recent's per-payment-status amounts. Matched across periods by `label`. */
  byLabel: Array<{ label: string; totalAmount: string }>;
  /** A8 (T-080-a): `queryApplied.accessScope`, when the tool result carries one — "own"/"related"
   *  means this period's figures cover only the caller's own/related records. */
  accessScope?: 'own' | 'related' | 'company';
  /** get_breakdown only: the grouping actually applied, for the rank-1 "same X?" wording below. */
  groupBy?: 'category' | 'branch' | 'vendor';
};

const EXPENSE_STATUS_AMOUNT_LABELS_TH: Record<string, string> = {
  paidAmount: 'จ่ายแล้ว', unpaidAmount: 'ยังไม่จ่าย', confirmedAmount: 'ยืนยันแล้ว', draftAmount: 'ร่าง', pendingAmount: 'รอดำเนินการ',
};

const BREAKDOWN_GROUP_FIELDS = {
  category: { key: 'byCategory', field: 'category' },
  branch: { key: 'byBranch', field: 'branch' },
  vendor: { key: 'byVendor', field: 'vendor' },
} as const;

/** Same default as ExpenseGetBreakdownTool's own `groupBy` echo (erp-business-tools.use-case.ts):
 *  an absent or unrecognized value reads as "category" — that tool always computes and returns all
 *  three group arrays, so this only decides WHICH one this comparison actually follows. */
function appliedGroupBy(data: UnknownRecord): 'category' | 'branch' | 'vendor' {
  const filters = record(record(data['queryApplied'])?.['filters']);
  const groupBy = filters?.['groupBy'];
  return groupBy === 'branch' || groupBy === 'vendor' ? groupBy : 'category';
}

function accessScopeOf(data: UnknownRecord): 'own' | 'related' | 'company' | undefined {
  const scope = record(data['queryApplied'])?.['accessScope'] ?? data['accessScope'];
  return scope === 'own' || scope === 'related' || scope === 'company' ? scope : undefined;
}

/** Reads a generic "grand total + count, and a same-shaped sub-split when present" out of either
 *  expense.list_recent's or expense.get_breakdown's `data` — comparison and share math never needs
 *  to know which of the two tools produced it. Both already echo `data.period.fromDate/toDate`. */
function expensePeriodTotals(toolName: string, data: UnknownRecord): ExpensePeriodTotals | undefined {
  const currencies = Array.isArray(data['totalsByCurrency']) ? data['totalsByCurrency'] : [];
  const currency = data['currency'] ?? record(currencies[0])?.['currency'] ?? 'THB';
  if (aggregationIncomplete(data) || data['mixedCurrency'] === true || currencies.length > 1 || currency !== 'THB') return undefined;
  const period = record(data['period']);
  const fromDate = period?.['fromDate'], toDate = period?.['toDate'];
  if (!isCivilDate(fromDate) || !isCivilDate(toDate) || fromDate > toDate) return undefined;
  const accessScope = accessScopeOf(data);
  if (toolName === 'expense.get_breakdown') {
    const totalAmount = data['totalAmount'], totalCount = data['totalCount'];
    if (typeof totalAmount !== 'string' || !Number.isFinite(Number(totalAmount)) || !totalAmount.trim()
      || typeof totalCount !== 'number' || !Number.isSafeInteger(totalCount) || totalCount < 0) return undefined;
    const groupBy = appliedGroupBy(data);
    const { key, field } = BREAKDOWN_GROUP_FIELDS[groupBy];
    const rows = Array.isArray(data[key]) ? data[key] as UnknownRecord[] : [];
    if (rows.some(row => !record(row) || typeof row['totalAmount'] !== 'string' || !row['totalAmount'].trim() || !Number.isFinite(Number(row['totalAmount'])))) return undefined;
    return { fromDate, toDate, totalAmount, count: totalCount, accessScope, groupBy,
      byLabel: rows.map((row) => ({ label: String(row[field] ?? ''), totalAmount: row['totalAmount'] as string })).filter((row) => row.label) };
  }
  if (toolName === 'expense.list_recent') {
    const summary = record(data['summary']);
    const totalAmount = summary?.['totalAmount'];
    if (typeof totalAmount !== 'string' || !Number.isFinite(Number(totalAmount)) || !totalAmount.trim()
      || typeof data['total'] !== 'number' || !Number.isSafeInteger(data['total']) || data['total'] < 0) return undefined;
    const byLabel: ExpensePeriodTotals['byLabel'] = [];
    for (const [key, label] of Object.entries(EXPENSE_STATUS_AMOUNT_LABELS_TH)) {
      const value = summary?.[key];
      if (typeof value === 'string') byLabel.push({ label, totalAmount: value });
    }
    return { fromDate, toDate, totalAmount, count: data['total'], byLabel, accessScope };
  }
  return undefined;
}

function moneyDiff(a: string, b: string): { diff: number; percent?: number } {
  const numA = Number(a), numB = Number(b);
  const diff = numB - numA;
  return { diff, ...(numA !== 0 ? { percent: (diff / Math.abs(numA)) * 100 } : {}) };
}

function formatSignedMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedPercent(percent: number | undefined): string | undefined {
  return percent === undefined ? undefined : `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ENGLISH_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const THAI_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** True when `text` names this day of this month in any form an answer uses: "1 พ.ย.", "1 พย", "1 พฤศจิกายน",
 *  "1/11" (Thai digits too), or "Nov 1". The year may be there or not. */
function statesCivilDay(text: string, month: number, day: number): boolean {
  const abbr = THAI_MONTH_ABBR[month - 1]!;
  const thai = `(?<![\\d.])${day}\\s*(?:${abbr.replace(/\./gu, '\\.')}|${abbr.replace(/\./gu, '')}|${THAI_MONTH_FULL[month - 1]}|/\\s*0?${month}(?!\\d))`;
  const english = `\\b${ENGLISH_MONTH_ABBR[month - 1]}[a-z]*\\.?\\s*${day}(?!\\d)`;
  return new RegExp(`${thai}|${english}`, 'iu').test(mapThaiDigits(text));
}

/**
 * Advisor S2a (eval r11 P-02, 2026-10-01): a monthly receipt allowance starts counting again on
 * `receipts.resetsOn` from billing.get_package_usage, and an answer about receipts must say that day.
 * The model gave only the month's range ("1–31 ต.ค.") although the tool returned the day, and the prompt
 * rule alone failed before, so a receipt answer that does not name the day gets one line that does.
 * No restart day in the data (a paid allowance, or a package that ends first) leaves the answer as is.
 */
export function withReceiptRestartDate(text: string, results: readonly ToolResult[], english: boolean): string {
  const usage = results.find((result) => result.toolName === 'billing.get_package_usage' && result.status === 'ok');
  const resetsOn = record(record(usage?.data)?.['receipts'])?.['resetsOn'];
  const date = typeof resetsOn === 'string' ? CIVIL_DATE.exec(resetsOn) : null;
  if (!date) return text;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const aboutReceipts = english ? /receipt/iu.test(text) : /ใบเสร็จ|\d\s*ใบ/u.test(mapThaiDigits(text));
  if (!aboutReceipts || statesCivilDay(text, month, day)) return text;
  return `${text}\n${english ? `Receipts start counting again on ${ENGLISH_MONTH_ABBR[month - 1]} ${day}, ${year}.`
    : `ใบเสร็จจะเริ่มนับใหม่ ${formatThaiDate({ day, month, yearBe: year + 543 })} ค่ะ`}`;
}

// ─── Advisor S1: expense.list_substitute_receipts_to_sign — the side the question names leads ──────
// R1 integrated eval (2026-10-01, S-09): "มีใบรับรองรอฉันอนุมัติไหม" reached the tool with no role, so both sides came
// back and the reply opened with their total ("ทั้งหมด 4 ฉบับ"), never the 3 waiting for approval. The side is read
// from the question here, not left to the model: อนุมัติ/ตรวจรับ is the approver side, ผู้จ่าย the payer side.
// เซ็น, ลงนาม, ลงลายมือชื่อ and ลงชื่อ name no side — people say them for approving too — and
// beside อนุมัติ they may be the payer's step ("เซ็นหรืออนุมัติ"), so that question is left alone as well.
// Only a reply whose first line does not already state that side's count gets one line that does; the rest
// stays. A question naming neither side or both, a read that carried a role (one side returned) and an answer
// that also reads another tool are left as they are.
// ponytail: "already states it" is the count with its unit in the first line, whichever side that line names —
// equal counts on both sides read as stated; match the side's wording too if that ever misleads.
const SUBSTITUTE_QUEUE_TOOL = 'expense.list_substitute_receipts_to_sign';
const APPROVER_SIDE_ASKED = /อนุมัติ|ตรวจรับ|\bapprov/iu;
const PAYER_SIDE_ASKED = /ผู้จ่าย|\bpayer/iu;
const SIGN_VERB_ASKED = /(?<!เปอร์)เซ็น|ลงนาม|ลงลายมือชื่อ|ลงชื่อ|\bsign/iu;

export function withAskedSubstituteQueueSideLead(text: string, results: readonly ToolResult[], clauseText: string, english: boolean): string {
  if (results.length === 0 || results.some((result) => result.toolName !== SUBSTITUTE_QUEUE_TOOL || result.status !== 'ok')) return text;
  const queue = record(results[0]!.data);
  const payer = record(queue?.['asPayer'])?.['count'], approver = record(queue?.['asApprover'])?.['count'];
  if (typeof payer !== 'number' || typeof approver !== 'number') return text;
  const question = clauseText.normalize('NFC');
  const asksApprover = APPROVER_SIDE_ASKED.test(question);
  if (asksApprover === PAYER_SIDE_ASKED.test(question) || (asksApprover && SIGN_VERB_ASKED.test(question))) return text;
  const count = asksApprover ? approver : payer;
  const firstLine = mapThaiDigits(text).split('\n').find((line) => line.trim()) ?? '';
  const stated = count === 0 ? /ไม่มี|\bno\b|\bnone\b|(?<![\d,.])0\s*(?:ใบ|ฉบับ|รายการ)/iu
    : new RegExp(`(?<![\\d,.])${count}${english ? '(?![\\d,.])' : '\\s*(?:ใบ|ฉบับ|รายการ)'}`, 'u');
  if (stated.test(firstLine)) return text;
  const side = asksApprover ? (english ? 'your approval' : 'รอคุณอนุมัติ') : (english ? 'your signature as the payer' : 'รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน');
  const lead = english
    ? (count === 0 ? `No substitute receipt is waiting for ${side}.` : `${count} substitute receipt${count === 1 ? ' is' : 's are'} waiting for ${side}.`)
    : (count === 0 ? `ไม่มีใบรับรองแทนใบเสร็จที่${side}ค่ะ` : `ใบรับรองแทนใบเสร็จที่${side}มี ${count} ใบค่ะ`);
  return `${lead}\n${text}`;
}

function lastDayOfMonthCe(yearCe: number, month: number): number {
  return new Date(Date.UTC(yearCe, month, 0)).getUTCDate();
}

/** A8 (batch5, T-082-a/T-080-a): a Thai (or English) period phrase for the deterministic comparison
 *  reply, never the raw ISO dates it replaced. A whole calendar month prints as just the month
 *  ("ส.ค. 2569"/"Aug 2026"); a partial month (typically month-to-date) keeps its day range
 *  ("1–28 ก.ย. 2569"/"1–28 Sep 2026"); a single day prints once; anything else falls back to a
 *  day-month-year range. Local month table — copied from prepared-simple-read-formatter.ts's own
 *  THAI_MONTH_ABBR (read-only for this task) rather than imported, since that agents-layer file must
 *  not become a dependency of this domain/logic module. */
export function periodLabel(fromDate: string, toDate: string, english: boolean): string {
  const from = CIVIL_DATE.exec(fromDate), to = CIVIL_DATE.exec(toDate);
  if (!from || !to) return fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;
  const [fy, fm, fd] = [Number(from[1]), Number(from[2]), Number(from[3])];
  const [ty, tm, td] = [Number(to[1]), Number(to[2]), Number(to[3])];
  const month = (m: number) => (english ? ENGLISH_MONTH_ABBR : THAI_MONTH_ABBR)[m - 1];
  const year = (y: number) => (english ? String(y) : String(y + 543));
  if (fromDate === toDate) return english ? `${month(fm)} ${fd}, ${year(fy)}` : `${fd} ${month(fm)} ${year(fy)}`;
  if (fy === ty && fm === tm) {
    if (fd === 1 && td === lastDayOfMonthCe(fy, fm)) return `${month(fm)} ${year(fy)}`;
    return `${fd}–${td} ${month(fm)} ${year(fy)}`;
  }
  if (fy === ty) return english ? `${month(fm)} ${fd} – ${month(tm)} ${td}, ${year(ty)}` : `${fd} ${month(fm)} – ${td} ${month(tm)} ${year(ty)}`;
  return english ? `${month(fm)} ${fd}, ${year(fy)} – ${month(tm)} ${td}, ${year(ty)}` : `${fd} ${month(fm)} ${year(fy)} – ${td} ${month(tm)} ${year(ty)}`;
}

/** A8 (T-080-a): direction from the LATER period's (b's) point of view; `a` is always the caller's
 *  older period, unchanged contract from tuning-3. */
function directionSentence(labelA: string, diff: number, percent: number | undefined, multiple: number | undefined, english: boolean): string {
  if (diff === 0) return english ? `Equal to ${labelA}` : `เท่ากับ ${labelA}`;
  const amount = formatSignedMoney(Math.abs(diff));
  const pctWord = diff < 0 ? (english ? 'down' : 'ลดลง') : (english ? 'up' : 'เพิ่มขึ้น');
  const ratio = multiple === undefined ? '' : (english ? ` or about ${multiple.toFixed(1)} times ${labelA}` : ` หรือราว ${multiple.toFixed(1)} เท่าของ ${labelA}`);
  const pct = percent === undefined ? '' : ` (${pctWord} ${Math.abs(percent).toFixed(1)}%${ratio})`;
  return english
    ? `${diff < 0 ? 'Less than' : 'More than'} ${labelA} by ${amount} THB${pct}`
    : `${diff < 0 ? 'น้อยกว่า' : 'มากกว่า'} ${labelA} ${amount} บาท${pct}`;
}

export type ExpenseComparisonPeriod = { fromDate: string; toDate: string; label: string; totalAmount: string; count: number };

function wholeMonth(period: Pick<ExpenseComparisonPeriod, 'fromDate' | 'toDate'>): boolean {
  return period.fromDate.slice(0, 7) === period.toDate.slice(0, 7) && period.fromDate.endsWith('-01')
    && Number(period.toDate.slice(8)) === lastDayOfMonthCe(Number(period.toDate.slice(0, 4)), Number(period.toDate.slice(5, 7)));
}

function comparisonHeader(periods: ExpenseComparisonPeriod[], english: boolean): string {
  const first = periods[0]!, last = periods[periods.length - 1]!;
  const span = periods.every(wholeMonth)
    ? `${first.fromDate.slice(0, 4) === last.toDate.slice(0, 4) ? first.label.replace(/ \d{4}$/u, '') : first.label} – ${last.label}`
    : periodLabel(first.fromDate, last.toDate, english);
  return `${english ? 'Expense comparison' : 'เปรียบเทียบค่าใช้จ่าย'} ${span}`;
}

function partialPeriodWarning(periods: ExpenseComparisonPeriod[], english: boolean): string {
  const partial = periods.some(period => !period.fromDate.endsWith('-01')
    || Number(period.toDate.slice(8)) !== lastDayOfMonthCe(Number(period.toDate.slice(0, 4)), Number(period.toDate.slice(5, 7))));
  return periods.some(wholeMonth) && partial
    ? (english ? 'This comparison includes both full months and partial periods.' : 'การเปรียบเทียบนี้มีทั้งเดือนเต็มและช่วงที่ไม่ครบเดือน') : '';
}

function periodTotalLine(period: ExpenseComparisonPeriod, english: boolean): string {
  return `• ${period.label}: ${formatSignedMoney(Number(period.totalAmount))} ${english ? `THB (${period.count} ${period.count === 1 ? 'item' : 'items'})` : `บาท (${period.count} รายการ)`}`;
}

/** Compare the applied basis, filters and scope, excluding only the dates being compared. */
function comparisonBasis(data: UnknownRecord): string {
  const { period: _period, ...basis } = record(data['queryApplied']) ?? {};
  return JSON.stringify({ ...basis, accessScope: accessScopeOf(data) ?? data['accessScope'], currency: data['currency'] ?? 'THB' },
    (_, value) => record(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

/** Failed/refused/incomplete reads are named without pretending their amount is zero. */
export function expenseComparisonUnavailableReplyText(fromDate: string, toDate: string, status: 'forbidden' | 'incomplete' | 'unavailable', english = false): string {
  const label = periodLabel(fromDate, toDate, english);
  if (status === 'forbidden') return english ? `You do not have permission to view expenses for ${label}.` : `คุณไม่มีสิทธิ์ดูค่าใช้จ่าย ${label} ค่ะ`;
  if (status === 'incomplete') return english ? `Expense data for ${label} is incomplete, so a total is not available.` : `ข้อมูลค่าใช้จ่าย ${label} ยังไม่ครบ จึงยังสรุปยอดไม่ได้ค่ะ`;
  return english ? `Expense data for ${label} is not available yet.` : `ข้อมูลค่าใช้จ่าย ${label} ยังไม่พร้อมค่ะ`;
}

const GROUP_NOUN_TH: Record<'category' | 'branch' | 'vendor', string> = { category: 'หมวด', branch: 'สาขา', vendor: 'ร้าน' };

/** A8 (T-082-a): up to the top 3 groups of EACH period, ranked independently — never the matched-
 *  intersection `groupLines` below, so a group only one period returned still shows (that is exactly
 *  what reveals "not the same vendor"). Only rank 1 states whether the two periods agree. */
function topRankLines(a: ExpensePeriodTotals, b: ExpensePeriodTotals, labelA: string, labelB: string, english: boolean): string[] {
  const top = (totals: ExpensePeriodTotals) => [...totals.byLabel].sort((x, y) => Number(y.totalAmount) - Number(x.totalAmount)).slice(0, 3);
  const topA = top(a), topB = top(b);
  const noun = GROUP_NOUN_TH[a.groupBy ?? 'category'];
  const lines: string[] = [];
  for (let i = 0; i < Math.max(topA.length, topB.length); i++) {
    const rowA = topA[i], rowB = topB[i];
    const sideA = rowA ? `${labelA}: ${rowA.label} ${formatSignedMoney(Number(rowA.totalAmount))} ${english ? 'THB' : 'บาท'}` : undefined;
    const sideB = rowB ? `${labelB}: ${rowB.label} ${formatSignedMoney(Number(rowB.totalAmount))} ${english ? 'THB' : 'บาท'}` : undefined;
    const sides = [sideA, sideB].filter((side): side is string => !!side);
    if (!sides.length) continue;
    for (const side of sides) lines.push(`${english ? 'Rank' : 'อันดับ'} ${i + 1} ${side}`);
    if (i === 0 && rowA && rowB) {
      const same = rowA.label === rowB.label;
      lines.push(english ? `Rank 1: ${same ? 'same' : 'not the same'} ${a.groupBy ?? 'category'}` : `อันดับ 1 ${same ? '' : 'ไม่ใช่'}${noun}เดียวกัน`);
    }
  }
  return lines;
}

/** tuning-3 item 4: same cap as prepared-simple-read-formatter.ts's MAX_BREAKDOWN_GROUPS (R-A2) —
 *  its own constant, since this domain/logic module has no dependency on that agents-layer file. */
const MAX_COMPARISON_GROUPS = 8;

export type ExpensePeriodComparison = {
  /** Labelled facts (Thai) for the compose context AND, via the same decimals() extraction every
   *  other allowed number already goes through, the grounding allow-set — see runSemanticTurnV2.
   *  Unconditionally includes every matching byLabel row (get_breakdown's categories/vendors/branches,
   *  or list_recent's paid/unpaid/confirmed/draft/pending split) — unbounded, and never gated by
   *  tool, so a model composing its own prose always has the full grounding it had before tuning-3. */
  factsText: string;
  periodA: ExpenseComparisonPeriod;
  periodB: ExpenseComparisonPeriod;
  headerLine: string;
  partialPeriodLine: string;
  english: boolean;
  diffAmount: string;
  percent?: string;
  /** A8 (T-080-a): replaces the bare "ต่างกัน X บาท (Y%)" line in the deterministic reply, worded
   *  from periodB's (the later period's) point of view. */
  directionLine: string;
  /** tuning-3 item 4 (T-016/T-082): the SAME per-label lines as in `factsText`, but only for a
   *  GROUPED read (expense.get_breakdown's categories/vendors/branches — never list_recent's fixed
   *  status split, which is not a "group" the customer asked for), ranked by whichever period's
   *  amount is larger and capped like the single-period breakdown formatter — for
   *  `expensePeriodComparisonReplyText` to append to the deterministic customer-facing reply. */
  groupLines: string[];
  /** A8 (T-082-a): grouped comparisons only — up to the top 3 groups of EACH period, independently
   *  ranked, plus whether the two periods' rank-1 group is the same. */
  rankLines: string[];
  /** A8 (T-080-a): the fast lane's own scope sentence, set when either period's read was scoped to
   *  the caller's own/related records ("" when company-wide or unknown). */
  scopeLine: string;
};

/**
 * Item 3(a): two successful reads of the SAME tool with different periods. Computes each period's
 * total, the difference, the percent change (one decimal), and the same per status/category when
 * both periods carry one. `dataA`/`dataB` must be given oldest-period-first; overlapping ranges
 * and different applied bases cannot be compared as a series.
 */
export function expensePeriodComparison(toolName: string, dataA: UnknownRecord, dataB: UnknownRecord, english = false): ExpensePeriodComparison | undefined {
  const a = expensePeriodTotals(toolName, dataA), b = expensePeriodTotals(toolName, dataB);
  if (!a || !b || a.toDate >= b.fromDate || comparisonBasis(dataA) !== comparisonBasis(dataB) || a.groupBy !== b.groupBy) return undefined;
  const labelA = periodLabel(a.fromDate, a.toDate, english), labelB = periodLabel(b.fromDate, b.toDate, english);
  const periodA = { fromDate: a.fromDate, toDate: a.toDate, label: labelA, totalAmount: a.totalAmount, count: a.count };
  const periodB = { fromDate: b.fromDate, toDate: b.toDate, label: labelB, totalAmount: b.totalAmount, count: b.count };
  const total = moneyDiff(a.totalAmount, b.totalAmount);
  const sameYear = a.fromDate.slice(0, 4) === b.toDate.slice(0, 4);
  const reference = sameYear ? labelA.replace(/,? \d{4}$/u, '') : labelA;
  const multiple = Number(a.totalAmount) > 0 && total.percent !== undefined && total.percent >= 100
    ? Number(b.totalAmount) / Number(a.totalAmount) : undefined;
  const directionLine = directionSentence(reference, total.diff, total.percent, multiple, english);
  const unit = english ? 'THB' : 'บาท', differenceWord = english ? 'Difference' : 'ต่างกัน';
  const lines = [
    periodTotalLine(periodA, english), periodTotalLine(periodB, english), directionLine,
    `${differenceWord} ${formatSignedMoney(total.diff)} ${unit}${formatSignedPercent(total.percent) ? ` (${formatSignedPercent(total.percent)})` : ''}`,
  ];
  const matched = a.byLabel
    .flatMap((rowA) => { const rowB = b.byLabel.find((row) => row.label === rowA.label); return rowB ? [{ rowA, rowB }] : []; })
    .map(({ rowA, rowB }) => {
      const sub = moneyDiff(rowA.totalAmount, rowB.totalAmount);
      const subPercent = formatSignedPercent(sub.percent);
      return { rank: Math.max(Number(rowA.totalAmount), Number(rowB.totalAmount)),
        line: `${rowA.label}\n  ${labelA}: ${formatSignedMoney(Number(rowA.totalAmount))} ${unit}\n  ${labelB}: ${formatSignedMoney(Number(rowB.totalAmount))} ${unit}\n  ${differenceWord} ${formatSignedMoney(sub.diff)} ${unit}${subPercent ? ` (${subPercent})` : ''}` };
    });
  for (const { line } of matched) lines.push(line);
  // tuning-3 item 4 (T-016/T-082): ranked by whichever period's amount is larger, same cap as the
  // single-period breakdown formatter, only a label BOTH periods actually returned (spec's own "the
  // change for groups present in both") — get_breakdown only, never list_recent's fixed status
  // split, which already reads fine as the 3 lines above (T-076/077/078/080/081, unflagged today).
  const grouped = toolName === 'expense.get_breakdown';
  const groupLines = grouped ? matched.sort((left, right) => right.rank - left.rank).slice(0, MAX_COMPARISON_GROUPS).map(({ line }) => line) : [];
  // A8 (T-082-a): independent top-3-per-period ranking — deliberately NOT the `matched` intersection
  // above, since a period-exclusive top group is exactly what reveals "not the same vendor".
  const rankLines = grouped ? topRankLines(a, b, labelA, labelB, english) : [];
  const scoped = a.accessScope === 'own' || a.accessScope === 'related' || b.accessScope === 'own' || b.accessScope === 'related';
  return {
    factsText: lines.join('\n'), groupLines, rankLines,
    periodA, periodB, english, headerLine: comparisonHeader([periodA, periodB], english),
    partialPeriodLine: partialPeriodWarning([periodA, periodB], english),
    diffAmount: formatSignedMoney(total.diff),
    percent: formatSignedPercent(total.percent),
    directionLine,
    // A8 (T-080-a): same words prepared-simple-read-formatter.ts's fast lane already uses.
    scopeLine: scoped ? (english ? 'Scope: only records related to you' : 'ขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ') : '',
  };
}

/** One set of period rows and adjacent changes for text, card rows and grounding. */
export type ExpensePeriodComparisonSeries = Pick<ExpensePeriodComparison,
  'headerLine' | 'partialPeriodLine' | 'english' | 'factsText' | 'directionLine' | 'groupLines' | 'rankLines' | 'scopeLine'> & {
  periods: ExpenseComparisonPeriod[];
  /** One computed change for each adjacent pair, oldest first. */
  comparisons: ExpensePeriodComparison[];
};

/** The caller's planner admits at most eight reads. Never drop a read to manufacture a series. */
export function expensePeriodComparisonSeries(toolName: string, data: readonly UnknownRecord[], english = false): ExpensePeriodComparisonSeries | undefined {
  if (data.length < 2 || data.length > 8) return undefined;
  const ordered = [...data].sort((a, b) => String(record(a['period'])?.['fromDate']).localeCompare(String(record(b['period'])?.['fromDate'])));
  const comparisons: ExpensePeriodComparison[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const comparison = expensePeriodComparison(toolName, ordered[i - 1]!, ordered[i]!, english);
    if (!comparison) return undefined;
    comparisons.push(comparison);
  }
  const periods = [comparisons[0]!.periodA, ...comparisons.map(comparison => comparison.periodB)];
  return { periods, comparisons, english, headerLine: comparisonHeader(periods, english), partialPeriodLine: partialPeriodWarning(periods, english),
    factsText: comparisons.map(comparison => comparison.factsText).join('\n'), directionLine: comparisons.map(comparison => comparison.directionLine).join('\n'),
    groupLines: comparisons.flatMap(comparison => comparison.groupLines), rankLines: comparisons.flatMap(comparison => comparison.rankLines), scopeLine: comparisons[0]!.scopeLine };
}

export function expensePeriodComparisonReplyText(comparison: ExpensePeriodComparison | ExpensePeriodComparisonSeries): string {
  const periods = 'periods' in comparison ? comparison.periods : [comparison.periodA, comparison.periodB];
  const changes = 'comparisons' in comparison ? comparison.comparisons : [comparison];
  const lines = [
    comparison.headerLine,
    ...periods.flatMap((period, i) => [periodTotalLine(period, comparison.english), ...(i ? [`  ${changes[i - 1]!.directionLine}`] : [])]),
    ...(comparison.partialPeriodLine ? [comparison.partialPeriodLine] : []),
    ...comparison.groupLines,
    ...comparison.rankLines,
    ...(comparison.scopeLine ? [comparison.scopeLine] : []),
  ];
  return lines.join('\n');
}

/**
 * Item 3(b): each category/branch/vendor row's share of ITS OWN period's total, computed in code —
 * the same formula prepared-simple-read-formatter.ts's fast lane already uses for the same tool's
 * output — so a "why is X so big" answer can cite a percentage without the model computing one.
 */
export function expenseBreakdownShares(data: UnknownRecord): string {
  const totalAmount = Number(data['totalAmount'] ?? 0);
  if (!(totalAmount > 0)) return '';
  const lines: string[] = [];
  for (const key of ['byCategory', 'byBranch', 'byVendor'] as const) {
    const rows = Array.isArray(data[key]) ? data[key] as UnknownRecord[] : [];
    for (const row of rows) {
      const amount = Number(row['totalAmount'] ?? NaN);
      const label = String(row['category'] ?? row['branch'] ?? row['vendor'] ?? '').trim();
      if (!label || !Number.isFinite(amount)) continue;
      lines.push(`${label}: สัดส่วน ${(amount / totalAmount * 100).toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}
