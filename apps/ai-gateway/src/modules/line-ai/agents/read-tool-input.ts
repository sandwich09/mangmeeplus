import { LINE_CHAT_ACTIONS, LINE_AI_VALUE_CANDIDATES_V2_LIMITS, extractValueCandidates, isAmbiguousDateCandidate, isAmbiguousPeriodCandidate, resolvePeriodCandidates } from '@watchdog-bms/contracts';
import type { LineAiConversationContext, LineAiInputEvidenceV2, LineAiSourceRefV2, LineAiValueCandidates, LineAiTurnRequest, ToolMeta } from '@watchdog-bms/contracts';

/** Read memory identifies a record, never grants access or supplies its current figures. */
export function isExpenseReadReference(id: unknown, context?: LineAiConversationContext): boolean {
  return typeof id === 'string' && (context?.recentReads?.some(entry =>
    ['expense.list_recent', 'expense.get_detail', 'expense.list_substitute_receipts_to_sign'].includes(entry.tool)
    && entry.shownItems?.some(item => !item.kind && item.id === id)) === true
    || context?.recentCapturedExpenses?.some(item => item.id === id) === true
    || context?.activeExpenseDrafts?.some(item => item.expenseId === id) === true);
}

/** Repair the router's record/group confusion only from API-owned, typed shown items. */
export function resolveExpenseReadReferences(req: LineAiTurnRequest): LineAiTurnRequest {
  if (!req.semanticSubrequests?.length) return req;
  const previous = req.conversationContext?.recentTurns.at(-1);
  // The refusal reply names the action ("คุณยังไม่มีสิทธิ์ยกเลิกค่าใช้จ่าย"); the user's words may not.
  const refusedReply = previous?.assistantReplyPreview?.includes('ยังไม่มีสิทธิ์') ? previous.assistantReplyPreview : undefined;
  if (req.semanticSubrequests.length === 1 && (previous?.refused || refusedReply)
    && /^(?:แล้ว)?(?:ต้อง)?(?:ให้)?(?:ใคร|(?:ผู้มีสิทธิ์|คน)(?:คน)?ไหน)(?:เป็นคน)?(?:ทำ|ช่วย)(?:ให้|ได้|เรื่องนี้)*[?？]*(?:คะ|ค่ะ|ครับ|จ้า|จ้ะ|จ๊ะ|นะ)*$/u.test(req.messageText.replace(/\s+/gu, ''))) {
    const action = LINE_CHAT_ACTIONS.find(action => [action.command, action.title].some(label => label && [refusedReply, previous!.userMessagePreview].some(text => text?.includes(label))));
    if (action) return { ...req, semanticSubrequests: [{ ...req.semanticSubrequests[0]!, kind: 'read', toolHint: 'company.get_roles',
      requestedFilters: { permissionKey: action.permission } }] };
  }
  return { ...req, semanticSubrequests: req.semanticSubrequests.map(item => {
    if (item.kind !== 'read' || !item.toolHint?.startsWith('expense.')) return item;
    const text = evidenceRefsText(item.evidenceRefs, req.inputEvidence, req.messageText);
    const ordinal = /(?:อัน|รายการ|อันดับ)(?:ที่)?\s*(แรก|[0-9๐-๙]+)/u.exec(text)?.[1];
    const number = ordinal === 'แรก' ? 1 : Number(ordinal?.replace(/[๐-๙]/gu, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit))));
    const id = item.requestedFilters.expenseId;
    if (id === undefined && (!ordinal || item.toolHint !== 'expense.get_detail')) return item;
    const memory = req.conversationContext?.recentReads?.find(entry => entry.tool.startsWith('expense.')
      && (!item.requestedFilters.documentStatus || item.requestedFilters.documentStatus === entry.documentStatus)
      && entry.shownItems?.some(row => id !== undefined ? row.id === id : row.ordinal === number));
    const row = memory?.shownItems?.find(row => id !== undefined ? row.id === id : row.ordinal === number);
    if (!memory || !row) return item;
    const { expenseId: _id, groupBy: _group, ...filters } = item.requestedFilters;
    if (memory.tool === 'expense.get_breakdown' && row.kind) {
      return { ...item, toolHint: 'expense.list_recent', requestedFilters: {
        ...(memory.period ?? {}), ...Object.fromEntries(['documentStatus', 'paymentStatus', 'categoryId', 'categoryName', 'vendorId', 'vendorName', 'branchId', 'branchName']
          .flatMap(key => memory[key as keyof typeof memory] === undefined ? [] : [[key, memory[key as keyof typeof memory]]])),
        ...filters, [`${row.kind}Id`]: row.id } };
    }
    if (item.toolHint === 'expense.get_detail' && !row.kind && isExpenseReadReference(row.id, req.conversationContext)) {
      return { ...item, requestedFilters: { expenseId: row.id } };
    }
    return item;
  }) };
}

export const CLAIM_AMOUNT_FILTER_KEYS = ['amountGt', 'amountGte', 'amountLt', 'amountLte'] as const;
export const CLAIM_READ_FILTER_KEYS = ['requester', 'requesterName', 'categoryName', 'round', 'status', 'paymentStatus', ...CLAIM_AMOUNT_FILTER_KEYS] as const;

/** Select a threshold only from the deterministic candidates adjacent to its comparison word. */
export function claimAmountFilters(text: string, candidates?: LineAiTurnRequest['valueCandidates']): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const candidate of candidates?.amounts ?? []) {
    const escapedSpan = candidate.span.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const comparison = new RegExp(`(ไม่เกิน|ไม่ถึง|ต่ำกว่า|อย่างน้อย|มากกว่า|เกิน)\\s*${escapedSpan}`, 'u').exec(text)?.[1];
    const above = new RegExp(`${escapedSpan}\\s*กว่า`, 'u').test(text);
    const key = comparison === 'ไม่เกิน' ? 'amountLte' : comparison === 'ไม่ถึง' || comparison === 'ต่ำกว่า' ? 'amountLt'
      : comparison === 'อย่างน้อย' ? 'amountGte' : comparison || above ? 'amountGt' : undefined;
    if (key) filters[key] = candidate.value;
  }
  return filters;
}

/** Old delivered reads did not record their claim filters, so their group cannot be re-read safely. */
export function claimReadGroupUnavailable(req: Pick<LineAiTurnRequest, 'messageText' | 'conversationContext'>,
  item: NonNullable<LineAiTurnRequest['semanticSubrequests']>[number]): boolean {
  const previous = req.conversationContext?.recentReads?.[0];
  return item.kind === 'read' && item.toolHint === 'reimbursement.get_summary'
    && Object.keys(item.requestedFilters).length === 0 && previous?.tool.startsWith('reimbursement.') === true
    && previous.claimFilters === undefined
    && /รวม|ทั้งหมด|กี่ใบ|กี่รายการ|กี่บาท|เท่าไหร่|เท่าไร/u.test(req.messageText);
}

/** Continue the latest delivered claim group without treating its previous figures as current data. */
export function resolveClaimReadFilters<T extends Pick<LineAiTurnRequest, 'messageText' | 'semanticSubrequests' | 'conversationContext' | 'inputEvidence' | 'valueCandidates'>>(req: T): T {
  const latest = req.conversationContext?.recentReads?.[0];
  return { ...req, semanticSubrequests: req.semanticSubrequests?.map(item => {
    const text = evidenceRefsText(item.evidenceRefs, req.inputEvidence, req.messageText);
    const totalQuestion = /รวม|ทั้งหมด|กี่ใบ|กี่รายการ|กี่บาท|เท่าไหร่|เท่าไร/u.test(text);
    const followUp = /เมื่อกี้|ที่แสดง|กลุ่ม|คนนี้|ของเขา|ของคนนี้|ของคนเดิม|แล้ว.*(?:รวม|กี่|เท่า)/u.test(text)
      || /^(?:แล้ว)?(?:รวม(?:ทั้งหมด)?|ยอดรวม|ทั้งหมด|มีกี่ใบ|กี่ใบ)(?:เป็นเงิน)?(?:เท่าไหร่|เท่าไร|กี่บาท|กี่ใบ|กี่รายการ)?(?:คะ|ค่ะ|ครับ|นะ|ไหม|บ้าง|[?？\s])*$/u.test(text);
    const samePerson = latest?.claimFilters?.requesterName && item.requestedFilters.requesterName === latest.claimFilters.requesterName
      || latest?.claimFilters?.requester && item.requestedFilters.requester === latest.claimFilters.requester;
    const previous = totalQuestion && (followUp || samePerson) && latest?.tool.startsWith('reimbursement.') ? latest : undefined;
    if (item.kind !== 'read' || item.toolHint && !item.toolHint.startsWith('reimbursement.')
      || !(item.toolHint?.startsWith('reimbursement.') || reimbursementStatusQuestion(text) || previous)) return item;
    const carried = previous?.claimFilters ?? {};
    const amounts = claimAmountFilters(text, req.valueCandidates);
    return { ...item, ...(previous ? { toolHint: 'reimbursement.get_summary' } : {}), requestedFilters: { ...carried, ...amounts, ...item.requestedFilters } };
  }) };
}

export type ConversationReadCandidates = {
  turns: Array<{ at: string; todayIso: string; dates: LineAiValueCandidates['dates']; periods: NonNullable<LineAiValueCandidates['periods']> }>;
  candidates: LineAiValueCandidates;
};

function currentScopeBlocksHistory(candidates?: LineAiValueCandidates): boolean {
  return !!candidates && (('completeness' in candidates && candidates.completeness === 'overflow')
    || candidates.dates.length > 0 || (candidates.periods?.length ?? 0) > 0);
}

export function conversationReadCandidates(
  context?: LineAiConversationContext,
  current?: LineAiValueCandidates,
): ConversationReadCandidates | undefined {
  if (!context || currentScopeBlocksHistory(current)) return undefined;
  const turns: ConversationReadCandidates['turns'] = [];
  for (const turn of context.recentTurns) {
    if (turn.userMessagePreviewComplete !== true || !turn.userMessagePreview) continue;
    const at = new Date(turn.at);
    if (!Number.isFinite(at.getTime())) continue;
    const todayIso = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (new TextEncoder().encode(turn.userMessagePreview).length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.utf8Bytes) continue;
    const extracted = extractValueCandidates(turn.userMessagePreview, todayIso, { scan: {
      observe() {}, datePositions: new WeakMap(),
    } });
    if (extracted.dates.length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.dates
      || (extracted.periods?.length ?? 0) > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.periods) continue;
    const dates = extracted.dates.filter(candidate => !isAmbiguousDateCandidate(candidate));
    const periods = (extracted.periods ?? []).filter(candidate => !isAmbiguousPeriodCandidate(candidate));
    if (dates.length || periods.length) turns.push({ at: turn.at, todayIso, dates, periods });
  }
  if (!turns.length) return undefined;
  const dates = [...new Map(turns.flatMap(turn => turn.dates).map(date => [date.isoDate, date])).values()];
  const periods = [...new Map(turns.flatMap(turn => turn.periods)
    .map(period => [`${period.fromDate}:${period.toDate}:${period.monthKey ?? ''}`, period])).values()];
  return { turns, candidates: { amounts: [], dates, periods } };
}

/** NFC + lowercase + collapsed-whitespace, so spacing/case/composed-character differences between
 *  what the model echoes and what the user actually typed never cause a false grounding mismatch. */
function normalizeForNameGrounding(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Spec item 2(b): a categoryName/vendorName the model sends as a tool filter is only trustworthy when
 * the user actually typed it this turn — otherwise the model can invent a plausible-looking name and
 * the tool would silently filter (or mis-resolve) by something nobody asked for. `name` must appear as
 * a substring of `messageText` after normalization. A category may omit its leading ค่า when
 * its remaining Thai word has at least three characters.
 *
 * P3 hook: this only grounds against the CURRENT message. `conversationReadCandidates` above is where
 * recent-turn text would be pulled in to also ground a name the user typed earlier in the conversation
 * — pass its turns' `userMessagePreview` text through this same normalize-and-include check.
 */
export function nameFilterGroundedInText(name: string, messageText: string, categoryName = false): boolean {
  const needle = normalizeForNameGrounding(name);
  const text = normalizeForNameGrounding(messageText);
  const distinctive = categoryName && needle.startsWith('ค่า') ? needle.slice(3) : '';
  return needle.length > 0 && text.includes(needle)
    || /^[ก-๙]{3,}$/u.test(distinctive) && text.includes(distinctive);
}

/** Item 1 (223-turn eval batch 2, T-001#0): "จ่ายไป/ใช้ไป/ใช้จ่ายไป/เสียไปเท่าไหร่" is a plain TOTAL
 *  spending question — it contains the verb "จ่าย" but names no payment STATE, so it must carry no
 *  paymentStatus filter at all. A paymentStatus value is grounded only by an explicit contrast:
 *  PAID needs "จ่ายแล้ว/ชำระแล้ว/จ่ายจริง"; UNPAID needs "ยังไม่จ่าย/ค้างจ่าย/ยังไม่ชำระ". The generic
 *  enum-membership check (any listed value is "grounded") cannot tell these apart — both are valid
 *  enum members — so paymentStatus needs this word-level check instead. PARTIALLY_PAID/VOIDED are
 *  outside this eval's scope and keep using the ordinary enum-membership check. */
const PAYMENT_STATE_WORDS: Partial<Record<string, RegExp>> = {
  PAID: /จ่ายแล้ว|ชำระแล้ว|จ่ายจริง|\bpaid\b/iu,
  UNPAID: /ยังไม่จ่าย|ค้างจ่าย|ยังไม่ชำระ|\bunpaid\b|\bnot\s+paid\b/iu,
};

export function paymentStatusGroundedInText(value: string, messageText: string): boolean {
  const pattern = PAYMENT_STATE_WORDS[value];
  return !pattern || pattern.test(messageText);
}

/** Item 3 root cause: despite the router prompt explicitly forbidding it ("never invent aliases such
 *  as this_month"), the real model sometimes sends a `periodKey` of a well-known relative-month word
 *  instead of the tool's actual `YYYY-MM` key — e.g. `{"periodKey":"this_month"}` for "เดือนนิจ่ายไป
 *  เทาไหร่แล้วค้า" (eval T-009-a). That value never matches any extracted candidate (least of all when
 *  the message also typos the Thai word, so no candidate was extracted at all) and used to dead-end
 *  the whole call as `TOOL_INPUT_NOT_AUTHORIZED`. Each alias below names an exact calendar month
 *  computable from `todayIso` alone — exactly as deterministic as the candidate the extractor would
 *  have produced had the message spelled the Thai phrase correctly — so resolving it is not
 *  "inventing" a period. Bounded to month-shaped aliases only: a `periodKey` field is only ever a
 *  calendar month (`LineAiPeriodCandidate.monthKey`); "today"/"this_week" are expressed via
 *  fromDate/toDate instead and are not this field's concern. */
const PERIOD_KEY_ALIASES: Record<string, string> = {
  this_month: 'เดือนนี้', current_month: 'เดือนนี้', this_month_to_date: 'เดือนนี้',
  last_month: 'เดือนที่แล้ว', previous_month: 'เดือนที่แล้ว',
};

export function resolvePeriodKeyAlias(periodKey: string, todayIso: string | undefined): string | undefined {
  const phrase = PERIOD_KEY_ALIASES[periodKey];
  if (!phrase || !todayIso) return undefined;
  return resolvePeriodCandidates(phrase, todayIso).find(candidate => candidate.kind === 'month')?.monthKey;
}

export function canonicalizeReadToolEnums(
  meta: Pick<ToolMeta, 'inputEnumValues'> & { name?: string },
  raw: Record<string, unknown>,
  messageText?: string,
  recentReads?: readonly NonNullable<LineAiConversationContext['recentReads']>[number][],
): Record<string, unknown> | undefined {
  const canonical = { ...raw };
  if (meta.name?.startsWith('reimbursement.')) {
    for (const key of CLAIM_AMOUNT_FILTER_KEYS) if (typeof canonical[key] === 'number' && Number.isFinite(canonical[key])) canonical[key] = String(canonical[key]);
    for (const key of ['requesterName', 'categoryName']) {
      if (canonical[key] !== undefined && (typeof canonical[key] !== 'string' || !nameFilterGroundedInText(canonical[key] as string, messageText ?? '', key === 'categoryName') && !recentReads?.some(entry => entry.tool.startsWith('reimbursement.') && entry.claimFilters?.[key as 'requesterName' | 'categoryName'] === canonical[key]))) return undefined;
    }
    if (canonical.round !== undefined) {
      const spoken = /รอบ\s*(?:ที่\s*)?([0-9๐-๙]+|[ก-๙]+)/u.exec(messageText ?? '')?.[1];
      const rawRound = String(canonical.round);
      const round = /^\d+$/u.test(rawRound) ? rawRound
        : extractValueCandidates(rawRound).amounts.find(candidate => candidate.span === rawRound)?.value;
      if (!round || (!spoken || extractValueCandidates(spoken).amounts[0]?.value !== round)
        && !recentReads?.some(entry => entry.tool.startsWith('reimbursement.') && entry.claimFilters?.round === round)) return undefined;
      canonical.round = round;
    }
    if (canonical.status === 'APPROVED' && /อนุมัติแล้ว.*(?:ยังไม่จ่าย|ยังไม่ได้จ่าย|รอจ่าย)/u.test(messageText ?? '')) canonical.status = 'APPROVED_UNPAID';
  }
  if (canonical.olderThanMonths !== undefined) {
    const spoken = /(?:เกิน|นานกว่า|มากกว่า)\s*([0-9๐-๙]+|[ก-๙]+)\s*เดือน/u.exec(messageText ?? '')?.[1];
    if (!spoken || extractValueCandidates(spoken).amounts[0]?.value !== String(canonical.olderThanMonths)) return undefined;
  }
  if (meta.inputEnumValues?.documentStatus?.includes('NEEDS_REVIEW')
    && ['DRAFT', 'READY_FOR_CONFIRMATION'].includes(String(canonical.documentStatus))
    && /ยัง(?:ไม่|ไม่ได้)ยืนยัน|\bunconfirmed\b/iu.test(messageText ?? '')
    && !/ร่าง|พร้อมยืนยัน|\bdraft\b|ready.for.confirmation/iu.test(messageText ?? '')) canonical.documentStatus = 'NEEDS_REVIEW';
  for (const [key, values] of Object.entries(meta.inputEnumValues ?? {})) {
    if (!(key in canonical)) continue;
    const value = canonical[key];
    if (typeof value !== 'string') return undefined;
    const matches = values.filter(candidate => candidate.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US'));
    if (matches.length !== 1) return undefined;
    canonical[key] = matches[0];
  }
  return canonical;
}

/** Item 1 (spec §2/§3 row 17): the exact customer words a semantic subrequest's evidenceRefs quote
 *  out of the current inputEvidence — the same provenance runSemanticTurnV2 already trusts for
 *  numeric grounding, reused here so a scope-policy check is grounded in what the customer actually
 *  typed for THIS clause, not the model's paraphrase or an unrelated clause in the same message.
 *  Falls back to the whole message when no evidence is available (older/simple callers). */
export function evidenceRefsText(
  evidenceRefs: readonly LineAiSourceRefV2[] | undefined,
  inputEvidence: LineAiInputEvidenceV2 | undefined,
  fallback: string,
): string {
  if (!evidenceRefs?.length || !inputEvidence) return fallback;
  const quoted = evidenceRefs
    .map(ref => inputEvidence.parts.find(part => part.partId === ref.partId)?.rawText.slice(ref.startUtf16, ref.endUtf16) ?? '')
    .filter(Boolean)
    .join(' ');
  return quoted || fallback;
}

/** Item 4 (spec row 3, eval T-093-b): "ใบเบิก"/"เบิกเงิน"/"ขอเบิก" name the reimbursement CLAIM, a
 *  different record than the expense ledger — expense.list_recent/get_breakdown must never answer
 *  it (e.g. a paymentStatus on the expense ledger is not the claim's own approve/pay status). A
 *  message that separately names the expense ledger itself ("ค่าใช้จ่าย"/"รายจ่าย") is unaffected. */
const REIMBURSEMENT_STATUS_WORDS_TH = ['ใบเบิก', 'เบิกเงิน', 'ขอเบิก'];
const EXPENSE_LEDGER_WORDS_TH = ['ค่าใช้จ่าย', 'รายจ่าย'];

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some(needle => text.includes(needle));
}

export function reimbursementStatusQuestion(text: string): boolean {
  return includesAny(text, REIMBURSEMENT_STATUS_WORDS_TH) && !includesAny(text, EXPENSE_LEDGER_WORDS_TH);
}

/** Advisor Q2 (owner 2026-09-30): "มีอะไรค้างที่ฉันต้องทำ", "งานค้างของฉัน" ask for the caller's OWN pending
 *  work across queues — never Q1's one-day checklist ("วันนี้มีอะไรต้องทำ"), which stays on its fast lane. A
 *  message naming one document ("ใบเบิกของฉันค้างที่ใคร", "ค้างจ่าย") asks about that document instead. */
const MY_PENDING_WORK_PATTERN = /งาน[^\n]{0,8}ค้าง|(?:อะไร|งาน)[^\n]{0,12}(?:ค้าง|รอ)[^\n]{0,12}(?:ฉัน|ผม|หนู|ดิฉัน)|(?:ฉัน|ผม|หนู|ดิฉัน)[^\n]{0,12}ค้าง/u;
const NAMED_DOCUMENT_WORDS_TH = ['ใบเบิก', 'เบิก', 'ค่าใช้จ่าย', 'รายจ่าย', 'ใบรับรอง', 'ใบแทน', 'บิล', 'ใบเสร็จ', 'จ่าย', 'ชำระ'];

export function myPendingWorkQuestion(text: string): boolean {
  return MY_PENDING_WORK_PATTERN.test(text) && !includesAny(text, NAMED_DOCUMENT_WORDS_TH);
}

/** Item 4 (spec row 14, eval T-107-b): line.explain_file_attempt explains a file/photo the customer
 *  says was sent in THIS chat. A "ทำไม"/category/spending question that names no file/photo/document
 *  at all has nothing to do with an upload attempt and must never route there. */
const FILE_REFERENCE_WORDS_TH = ['ไฟล์', 'รูป', 'เอกสาร', 'สลิป', 'ใบเสร็จ'];
const FILE_REFERENCE_WORDS_EN = ['file', 'photo', 'image', 'document', 'pdf', 'slip'];

export function fileAttemptReferenceGrounded(text: string): boolean {
  return includesAny(text, FILE_REFERENCE_WORDS_TH) || includesAny(text.toLocaleLowerCase('en-US'), FILE_REFERENCE_WORDS_EN);
}

/** Item 4: the one guard shared by the prepared-simple fast lane (`preparedSimplePreCallCheck`) and
 *  the classic per-turn tool loop (`runSemanticTurnV2`) — a proposed tool that this clause's own
 *  quoted text rules out, regardless of which lane picked it. */
export function misroutedReadTool(toolName: string, text: string): boolean {
  if (toolName === 'line.explain_file_attempt') return !fileAttemptReferenceGrounded(text);
  if (toolName === 'expense.list_recent' || toolName === 'expense.get_breakdown') return reimbursementStatusQuestion(text);
  return false;
}
