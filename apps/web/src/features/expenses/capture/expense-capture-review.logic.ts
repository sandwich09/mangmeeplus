import type {
  CaptureAllocationLine,
  CaptureAllocationResult,
  CaptureAllocationScope,
  CaptureAllocationSelection,
  CaptureDocumentState,
  CaptureExpenseDateChoice,
  CaptureFactsDocument,
  CaptureFactsItem,
  CaptureFactsView,
  ExpenseCaptureBlocker,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureDerivedSourceDto,
  ExpenseCaptureFileDto,
  ExpenseCaptureGroupDetailDto,
  ExpenseCaptureItemEvent,
} from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';

/**
 * What the group page says, derived once (appendix §11, spec §13.2/§13.4).
 *
 * Nothing here computes money: the allocation is the server's snapshot and every amount is passed
 * through as the string it arrived as. What this file decides is which WORDS a state gets — and the
 * rule that costs the most to get wrong is spec §13.2: saved, read, added up, paid, allocated and
 * tax-reviewed are separate axes, so they are separate chips. One green tick over all of them would
 * claim six things from the evidence for one.
 */

/** `{name}` substitution, the shape every dictionary string in this feature already uses. */
export const captureText = (message: string, params: Record<string, string>): string =>
  Object.entries(params).reduce((text, [key, value]) => text.replace(`{${key}}`, value), message);

/** `facts` is declared as the narrower observation bag; W04a fills it with the assembled view. */
export function captureFactsView(group: Pick<ExpenseCaptureGroupDetailDto, 'facts'>): CaptureFactsView | null {
  return (group.facts as CaptureFactsView | null) ?? null;
}

/** `allocation.result` is `unknown` in the contract until somebody renders it. This is that somebody. */
export function captureAllocation(
  group: Pick<ExpenseCaptureGroupDetailDto, 'allocation'>,
): CaptureAllocationResult | null {
  const result = group.allocation?.result;
  return result && typeof result === 'object' ? result as CaptureAllocationResult : null;
}

// ─── Axis 1: the read ─────────────────────────────────────────────────────────

export type CaptureReadState = 'none' | 'running' | 'incomplete' | 'done';

const RUNNING_READ = new Set(['QUEUED', 'PREPARING', 'READING']);
const INCOMPLETE_READ = new Set(['PARTIAL', 'PAUSED', 'FAILED']);

/** Files the group still holds; a detached or rejected one is not evidence of anything. */
export const captureStoredFiles = (files: ExpenseCaptureFileDto[]): ExpenseCaptureFileDto[] =>
  files.filter((file) => file.uploadState === 'STORED');

export function captureReadState(files: ExpenseCaptureFileDto[]): CaptureReadState {
  const stored = captureStoredFiles(files);
  if (stored.length === 0) return 'none';
  if (stored.some((file) => file.readStatus !== null && RUNNING_READ.has(file.readStatus))) return 'running';
  if (stored.some((file) => file.readStatus !== null && INCOMPLETE_READ.has(file.readStatus))) return 'incomplete';
  return stored.every((file) => file.readStatus === 'DONE') ? 'done' : 'none';
}

// ─── The summary header (spec §13.4) ──────────────────────────────────────────

export type CaptureCountMessage = { key: DictionaryKey; params: Record<string, string> };

export type CapturePayer =
  | { kind: 'unknown' }
  | { kind: 'company' }
  | { kind: 'self'; userId: string }
  | { kind: 'member'; userId: string };

export type CaptureSummaryModel = {
  /** "พบ {documents} ร้าน • {items} รายการ" — null while no file has been read. */
  headline: CaptureCountMessage | null;
  /** The §13.4 rule: a count is only ever claimed WITH how much of the evidence it came from. */
  incomplete: CaptureCountMessage | null;
  paidTotal: string | null;
  companyAmount: string | null;
  personalAmount: string | null;
  payer: CapturePayer;
};

/**
 * The payer is who the SERVER recorded, never the uploader (spec §3 step 5 / A32). An unanswered
 * funding route is "ยังไม่ทราบ", not the person who happens to be looking at the page.
 */
export function capturePayer(
  group: Pick<ExpenseCaptureGroupDetailDto, 'fundingRoute' | 'payerUserId'>,
  viewerUserId: string,
): CapturePayer {
  if (group.fundingRoute === 'COMPANY') return { kind: 'company' };
  if (group.fundingRoute === 'EMPLOYEE' && group.payerUserId) {
    return group.payerUserId === viewerUserId
      ? { kind: 'self', userId: group.payerUserId }
      : { kind: 'member', userId: group.payerUserId };
  }
  return { kind: 'unknown' };
}

export function captureSummary(
  group: ExpenseCaptureGroupDetailDto,
  viewerUserId: string,
): CaptureSummaryModel {
  const facts = captureFactsView(group);
  const allocation = captureAllocation(group);
  const stored = captureStoredFiles(group.files);
  const read = captureReadState(group.files);
  const filesRead = facts?.summary.filesRead ?? 0;
  return {
    headline: facts
      ? {
        key: 'expenses.capture.summary_documents',
        params: { documents: String(facts.summary.documents), items: String(facts.summary.items) },
      }
      : null,
    incomplete: read === 'done' && filesRead >= stored.length
      ? null
      : { key: 'expenses.capture.summary_incomplete', params: { read: String(filesRead), total: String(stored.length) } },
    paidTotal: allocation?.summary.paidTotal ?? null,
    companyAmount: allocation?.summary.companyAmount ?? null,
    personalAmount: allocation?.summary.personalAmount ?? null,
    payer: capturePayer(group, viewerUserId),
  };
}

// ─── The four state chips (spec §13.2) ────────────────────────────────────────

export type CaptureChipAxis = 'read' | 'money' | 'payer' | 'tax';
export type CaptureStateChip = { axis: CaptureChipAxis; key: DictionaryKey; tone: MangmeeTone };

const READ_CHIPS: Record<CaptureReadState, CaptureStateChip> = {
  none: { axis: 'read', key: 'expenses.capture.chip_read_none', tone: 'slate' },
  running: { axis: 'read', key: 'expenses.capture.chip_read_running', tone: 'sky' },
  incomplete: { axis: 'read', key: 'expenses.capture.chip_read_incomplete', tone: 'amber' },
  done: { axis: 'read', key: 'expenses.capture.chip_read_done', tone: 'brand' },
};

/** One chip per axis, always all four: a missing chip reads as "fine" to the person checking. */
export function captureStateChips(group: ExpenseCaptureGroupDetailDto): CaptureStateChip[] {
  const allocation = captureAllocation(group);
  const money: CaptureStateChip = !allocation
    ? { axis: 'money', key: 'expenses.capture.chip_money_unknown', tone: 'slate' }
    : allocation.outcome === 'BLOCKED'
      ? { axis: 'money', key: 'expenses.capture.chip_money_blocked', tone: 'amber' }
      : allocation.outcome === 'NO_COMPANY_PORTION'
        ? { axis: 'money', key: 'expenses.capture.chip_money_none', tone: 'slate' }
        : { axis: 'money', key: 'expenses.capture.chip_money_ready', tone: 'brand' };
  const payer: CaptureStateChip = group.fundingRoute === 'COMPANY'
    ? { axis: 'payer', key: 'expenses.capture.chip_payer_company', tone: 'sky' }
    : group.fundingRoute === 'EMPLOYEE'
      ? group.payerUserId
        ? { axis: 'payer', key: 'expenses.capture.chip_payer_employee', tone: 'sky' }
        : { axis: 'payer', key: 'expenses.capture.chip_payer_required', tone: 'amber' }
      : { axis: 'payer', key: 'expenses.capture.chip_payer_unknown', tone: 'amber' };
  const scopes = allocation?.scopes ?? [];
  const tax: CaptureStateChip = !allocation
    ? { axis: 'tax', key: 'expenses.capture.chip_tax_unknown', tone: 'slate' }
    : scopes.some((scope) => scope.blockers.some((entry) => entry.code === 'expense_capture_tax_review_pending'))
      ? { axis: 'tax', key: 'expenses.capture.chip_tax_pending', tone: 'amber' }
      : scopes.length > 0 && scopes.every((scope) => scope.taxSource === 'review')
        ? { axis: 'tax', key: 'expenses.capture.chip_tax_reviewed', tone: 'brand' }
        : { axis: 'tax', key: 'expenses.capture.chip_tax_facts', tone: 'slate' };
  return [READ_CHIPS[captureReadState(group.files)], money, payer, tax];
}

// ─── Blockers: what is wrong, and the way out (§10 / W04a §17.2) ──────────────

const WAY_OUT_KEYS: Record<string, DictionaryKey> = {
  expense_capture_no_evidence: 'expenses.capture.way_out_no_evidence',
  expense_capture_read_pending: 'expenses.capture.way_out_read_pending',
  expense_capture_facts_unavailable: 'expenses.capture.way_out_facts_unavailable',
  expense_capture_review_required: 'expenses.capture.way_out_review_required',
  expense_capture_business_use_required: 'expenses.capture.way_out_business_use',
  expense_capture_funding_route_required: 'expenses.capture.way_out_funding_route',
  expense_capture_payer_required: 'expenses.capture.way_out_payer',
  expense_capture_company_paid_personal_portion: 'expenses.capture.way_out_company_paid_personal',
  expense_capture_item_amount_unknown: 'expenses.capture.way_out_item_amount',
  expense_capture_document_mismatch: 'expenses.capture.way_out_document_mismatch',
  expense_capture_component_unclassified: 'expenses.capture.way_out_component_unclassified',
  expense_capture_expense_date_required: 'expenses.capture.way_out_expense_date',
  expense_capture_currency_unsupported: 'expenses.capture.way_out_currency',
  expense_capture_totals_identity_failed: 'expenses.capture.way_out_totals_identity',
  expense_capture_tax_review_pending: 'expenses.capture.way_out_tax_review',
};

export type CaptureBlockerRow = {
  code: string;
  /** The server's Thai sentence; the same wording `api-error-message.ts` carries for the code. */
  message: string;
  wayOutKey: DictionaryKey;
};

export function captureBlockerRows(
  blockers: ExpenseCaptureBlocker[],
  fallbackMessage: (code: string) => string,
): CaptureBlockerRow[] {
  return blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.messageTh?.trim() || fallbackMessage(blocker.code),
    wayOutKey: WAY_OUT_KEYS[blocker.code] ?? 'expenses.capture.way_out_generic',
  }));
}

// ─── Facts: what one document says ────────────────────────────────────────────

export function captureIssuerName(document: Pick<CaptureFactsDocument, 'issuer'>): string | null {
  const issuer = document.issuer ?? {};
  return issuer.storefront?.trim() || issuer.name?.trim() || issuer.platform?.trim() || null;
}

export function captureReconciliationChip(state: CaptureDocumentState): { key: DictionaryKey; tone: MangmeeTone } {
  if (state.reconciliation === 'reconciled') return { key: 'expenses.capture.recon_reconciled', tone: 'brand' };
  if (state.reconciliation === 'mismatch') return { key: 'expenses.capture.recon_mismatch', tone: 'danger' };
  return { key: 'expenses.capture.recon_insufficient', tone: 'amber' };
}

/**
 * Spec §13.4 row 1: an order total is not a payment. Until the document says the money moved, the
 * page says exactly that — and never offers a "mark as paid" as the way out.
 */
export function capturePaymentNoticeKey(state: CaptureDocumentState): DictionaryKey {
  return state.paymentStatus === 'paid'
    ? 'expenses.capture.payment_paid'
    : 'expenses.capture.payment_unpaid';
}

const ITEM_EVENT_KEYS: Partial<Record<ExpenseCaptureItemEvent, DictionaryKey>> = {
  void: 'expenses.capture.event_void',
  discount: 'expenses.capture.event_discount',
  price_correction: 'expenses.capture.event_price_correction',
  zero_price_promo: 'expenses.capture.event_gift',
  reward: 'expenses.capture.event_reward',
  info: 'expenses.capture.event_info',
  unknown: 'expenses.capture.event_unknown',
};

/** `sale` is the ordinary case and gets no chip; everything else is flagged as what it did. */
export const captureItemEventKey = (event: ExpenseCaptureItemEvent): DictionaryKey | null =>
  ITEM_EVENT_KEYS[event] ?? null;

const COMPONENT_ROLE_KEYS: Record<string, DictionaryKey> = {
  charge: 'expenses.capture.role_charge',
  applied_discount: 'expenses.capture.role_discount',
  tax_included: 'expenses.capture.role_tax_included',
  tax_additional: 'expenses.capture.role_tax_additional',
  tax_unknown: 'expenses.capture.role_tax_unknown',
  tender: 'expenses.capture.role_tender',
  change: 'expenses.capture.role_change',
  future_reward: 'expenses.capture.role_future_reward',
  refund: 'expenses.capture.role_refund',
  balance: 'expenses.capture.role_balance',
  summary: 'expenses.capture.role_summary',
  unclassified: 'expenses.capture.role_unclassified',
};

export function captureComponentRoleKey(
  component: Pick<ExpenseCaptureComponentObservation, 'role' | 'scope'>,
): DictionaryKey {
  if (component.role === 'charge' && component.scope === 'shipping') return 'expenses.capture.role_shipping';
  return COMPONENT_ROLE_KEYS[component.role] ?? 'expenses.capture.role_unclassified';
}

// ─── Selection: how many of a row are personal (spec §3 step 4 / §16.2) ───────

/** The engine's own set: a void, a discount line or a correction is not a thing you can own. */
const SELECTABLE_EVENTS = new Set<ExpenseCaptureItemEvent>(['sale', 'zero_price_promo', 'reward', 'info']);

export type CaptureItemSelection = {
  itemId: string;
  /** What the document printed. `null` = it printed no count, so the row is all-or-nothing. */
  quantity: number | null;
  selectable: boolean;
};

const positiveNumber = (value: string | undefined): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function captureItemSelection(item: CaptureFactsItem): CaptureItemSelection {
  return {
    itemId: item.id,
    quantity: positiveNumber(item.quantity),
    selectable: SELECTABLE_EVENTS.has(item.event),
  };
}

/** 0…qty, and 0…1 for a row whose count nobody read — never a split of a number nobody printed. */
export function capturePersonalMax(item: CaptureFactsItem): number {
  const selection = captureItemSelection(item);
  if (!selection.selectable) return 0;
  return selection.quantity ?? 1;
}

/**
 * What the last allocation says was kept for the company, so reopening the page shows the answers
 * that are actually stored (A14) instead of silently offering "all company" again.
 *
 * ponytail: rebuilt from `provenance`, because `selectionJson` is not on the allocation dto. A row
 * the allocation dropped is a row whose company quantity was 0 — EXCEPT one the engine skipped for
 * having no readable amount, which stays at 0 personal so a blocked row is not flipped to personal
 * behind the reviewer. Exact restore needs `selection` on `ExpenseCaptureAllocationDto` (W05+).
 */
export function capturePersonalFromAllocation(
  group: Pick<ExpenseCaptureGroupDetailDto, 'facts' | 'allocation' | 'businessUse'>,
): Record<string, number> {
  const allocation = captureAllocation(group);
  const facts = captureFactsView(group);
  if (!allocation || !facts || group.businessUse !== 'MIXED') return {};
  const companyByItem = new Map<string, number>();
  for (const scope of allocation.scopes) {
    for (const line of scope.lines) {
      companyByItem.set(line.provenance.itemId, Number(line.provenance.companyQuantity) || 0);
    }
  }
  const personal: Record<string, number> = {};
  for (const item of facts.items) {
    const max = capturePersonalMax(item);
    if (max <= 0) continue;
    const company = companyByItem.get(item.id);
    if (company !== undefined) {
      personal[item.id] = Math.max(max - company, 0);
      continue;
    }
    const amountKnown = Boolean(item.amount ?? item.unitPrice);
    personal[item.id] = amountKnown ? max : 0;
  }
  return personal;
}

/**
 * `selection` for `POST …/review`. MIXED sends every selectable row, because a row the server does
 * not hear about is a row it gives entirely to the person (`companyQuantity` defaults to 0) — the
 * opposite of what leaving a stepper at zero means on screen. ALL_COMPANY sends nothing: the engine
 * gives the company every unit and a stale selection must not survive the answer changing.
 */
export function captureSelectionPayload(
  items: CaptureFactsItem[],
  personalByItem: Record<string, number>,
  businessUse: 'UNKNOWN' | 'ALL_COMPANY' | 'MIXED',
): CaptureAllocationSelection {
  if (businessUse !== 'MIXED') return {};
  const selection: CaptureAllocationSelection = {};
  for (const item of items) {
    const max = capturePersonalMax(item);
    if (max <= 0) continue;
    const personal = Math.min(Math.max(personalByItem[item.id] ?? 0, 0), max);
    selection[item.id] = { companyQuantity: String(max - personal) };
  }
  return selection;
}

// ─── The preview: what the split was made of ──────────────────────────────────

export type CaptureProvenanceRow =
  | { kind: 'base'; amount: string }
  | { kind: 'discount'; amount: string; remainderAdjust: boolean }
  | { kind: 'shipping'; amount: string }
  | { kind: 'quantity'; company: string; quantity: string; inferred: boolean };

/** The §7 order, as the line was actually built: base → discounts → shipping → how many are ours. */
export function captureProvenanceRows(line: CaptureAllocationLine): CaptureProvenanceRow[] {
  const rows: CaptureProvenanceRow[] = [
    { kind: 'base', amount: line.provenance.baseAmount },
    ...line.provenance.discountShares.map((share) => ({
      kind: 'discount' as const, amount: share.share, remainderAdjust: share.remainderAdjust,
    })),
  ];
  if (line.provenance.shippingShare) rows.push({ kind: 'shipping', amount: line.provenance.shippingShare });
  rows.push({
    kind: 'quantity',
    company: line.provenance.companyQuantity,
    quantity: line.provenance.quantity,
    inferred: line.provenance.quantityInferred,
  });
  return rows;
}

export function captureScopeLabel(scope: CaptureAllocationScope): string {
  return captureIssuerName(scope) ?? scope.scopeKey;
}

/** Employee route only: a company-funded source is not something anybody claims back (§7). */
export const captureClaimReady = (scope: CaptureAllocationScope, fundingRoute: string): boolean =>
  fundingRoute === 'EMPLOYEE' && scope.claimReady;

// ─── Handoff and what it produced ─────────────────────────────────────────────

/** The confirm says what will exist afterwards and in which state — never just "ยืนยัน?" (§17.1). */
export function captureHandoffConfirmParams(allocation: CaptureAllocationResult): Record<string, string> {
  return {
    count: String(allocation.scopes.length),
    shops: allocation.scopes.map((scope) => captureScopeLabel(scope)).join(', '),
  };
}

export type CaptureDerivedRow = {
  expenseId: string;
  scopeKey: string;
  status: string;
  grandTotalAmount: string;
  label: string;
  claimReady: boolean;
  claimHref: string | null;
  /** W06 §12.3: where this shop's certificate work continues, and what to call that link. */
  nextAction: ExpenseCaptureDerivedSourceDto['nextAction'];
  certificate: ExpenseCaptureDerivedSourceDto['certificate'];
  certificateHref: string | null;
  certificateLabelKey: DictionaryKey | null;
  certificateStatusKey: DictionaryKey;
};

/** One row per shop, so "ร้าน A ออกแล้ว / ร้าน B รอลงนาม" is what the page reads (A40). */
const CERTIFICATE_STATUS_KEYS: Record<ExpenseCaptureDerivedSourceDto['nextAction'], DictionaryKey> = {
  certificate_available: 'expenses.capture.derived_certificate_available',
  certificate_prepared: 'expenses.capture.derived_certificate_prepared',
  certificate_certified: 'expenses.capture.derived_certificate_certified',
  certificate_issued: 'expenses.capture.derived_certificate_issued',
  receipt_present: 'expenses.capture.derived_certificate_receipt',
  blocked: 'expenses.capture.derived_certificate_blocked',
};

/**
 * The derived sources, told apart by the allocation that made them. `claimHref` exists only for an
 * employee-funded source whose tax review already passed: "เตรียมใบเบิก" on a source the resolver
 * would refuse is a dead end with a button on it (A04/A08).
 */
export function captureDerivedRows(
  group: Pick<ExpenseCaptureGroupDetailDto, 'derivedSources' | 'allocation' | 'fundingRoute'>,
  companyId: string,
): CaptureDerivedRow[] {
  const allocation = captureAllocation(group);
  const scopes = new Map((allocation?.scopes ?? []).map((scope) => [scope.scopeKey, scope]));
  return group.derivedSources.map((source: ExpenseCaptureDerivedSourceDto) => {
    const scope = scopes.get(source.scopeKey);
    const claimReady = scope ? captureClaimReady(scope, group.fundingRoute) : false;
    const nextAction = source.nextAction ?? 'blocked';
    return {
      expenseId: source.expenseId,
      scopeKey: source.scopeKey,
      status: source.status,
      grandTotalAmount: source.grandTotalAmount,
      label: scope ? captureScopeLabel(scope) : source.scopeKey || source.expenseId,
      claimReady,
      claimHref: claimReady
        ? `/companies/${companyId}/reimbursements/new?expenseId=${encodeURIComponent(source.expenseId)}`
        : null,
      nextAction,
      certificate: source.certificate ?? null,
      // §12.3: "จัดทำ" only where the server says a certificate may start; otherwise the document
      // that exists. A shop with its own receipt gets neither — it gets the chip that says so.
      certificateHref: source.certificate
        ? `/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(source.certificate.evidenceId)}`
        : nextAction === 'certificate_available'
          ? `/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(source.expenseId)}`
          : null,
      certificateLabelKey: source.certificate
        ? 'expenses.capture.derived_certificate_open'
        : nextAction === 'certificate_available' ? 'expenses.capture.derived_certificate_start' : null,
      certificateStatusKey: CERTIFICATE_STATUS_KEYS[nextAction] ?? CERTIFICATE_STATUS_KEYS.blocked,
    };
  });
}

/**
 * W06 §12.2 — what the certificate wizard may fill in for the payer on a derived source, taken
 * from the facts the group already reviewed. Everything here is a starting value the human can
 * change: the payer still types the reason and the business purpose themselves.
 */
export type CaptureCertificatePrefill = {
  fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | '';
  payerUserId: string | null;
  /** The reviewed payment date, never today and never the upload day (A42). */
  paymentDate: string | null;
  paymentMethod: string | null;
  /** A suggestion for "why is there no receipt", offered as text to accept — never pre-typed. */
  missingReasonSuggestionKey: DictionaryKey | null;
};

const CAPTURE_PAYMENT_METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER']);

export function captureCertificatePrefill(
  group: Pick<ExpenseCaptureGroupDetailDto, 'derivedSources' | 'facts' | 'fundingRoute'>,
  expenseId: string,
): CaptureCertificatePrefill | null {
  const source = group.derivedSources.find((row) => row.expenseId === expenseId);
  if (!source) return null;
  const facts = captureFactsView(group);
  const documents = (facts?.documents ?? []).filter((document) => document.scopeKey === source.scopeKey);
  const refs = new Set(documents.map((document) => document.ref));
  const payment = (facts?.payments ?? []).find((row) => refs.has(row.documentRef) && row.status === 'paid');
  const kind = documents[0]?.kind;
  return {
    fundingSource: group.fundingRoute === 'EMPLOYEE' ? 'PERSONAL_ADVANCE' : group.fundingRoute === 'COMPANY' ? 'COMPANY' : '',
    payerUserId: source.payerUserId,
    paymentDate: payment?.occurredAt?.slice(0, 10) ?? null,
    paymentMethod: payment?.method && CAPTURE_PAYMENT_METHODS.has(payment.method) ? payment.method : null,
    missingReasonSuggestionKey: kind === 'MARKETPLACE_ORDER' || kind === 'ORDER_OR_CHECK_BILL'
      ? 'expenses.capture.certificate_reason_order'
      : kind === 'TRANSFER_SLIP' ? 'expenses.capture.certificate_reason_slip' : null,
  };
}

// ─── Tax review labels (§7) ───────────────────────────────────────────────────

/** `EXPENSE_VAT_MODE_LABELS` and `TAX_EVIDENCE_STATUS_LABELS` already exist; this one did not. */
export const CAPTURE_CLAIM_STATUS_KEYS: Record<string, DictionaryKey> = {
  CLAIMABLE: 'expenses.capture.tax_claim_claimable',
  NON_CLAIMABLE: 'expenses.capture.tax_claim_non_claimable',
  NEEDS_REVIEW: 'expenses.capture.tax_claim_needs_review',
};

// ─── Dates (A42) ──────────────────────────────────────────────────────────────

export type CaptureDateOption = 'payment' | 'document' | 'order' | 'custom';

export const CAPTURE_DATE_OPTION_KEYS: Record<CaptureDateOption, DictionaryKey> = {
  payment: 'expenses.capture.expense_date_payment',
  document: 'expenses.capture.expense_date_document',
  order: 'expenses.capture.expense_date_order',
  custom: 'expenses.capture.expense_date_custom',
};

/** The default is whatever the server already resolved for the scope — never today (A42). */
export function captureDateOption(scope: CaptureAllocationScope): CaptureDateOption {
  return scope.expenseDateSource === 'explicit' ? 'custom' : scope.expenseDateSource ?? 'payment';
}

export function captureDateChoicePayload(
  option: CaptureDateOption,
  customDate: string | null,
): CaptureExpenseDateChoice | null {
  if (option !== 'custom') return option;
  return customDate && /^\d{4}-\d{2}-\d{2}/.test(customDate) ? { date: customDate } : null;
}
