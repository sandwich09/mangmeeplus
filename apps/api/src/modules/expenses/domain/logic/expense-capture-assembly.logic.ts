/**
 * Deterministic assembly and reconciliation of the per-window observations (appendix §4.4).
 *
 * Pure and `decimal.js`-only: the model transcribes and selects, this decides. The three rules that
 * matter are all refusals — a repeated header/footer total is counted ONCE, an item whose amount
 * the page never printed stays unknown (never 0), and a document whose printed breakdown does not
 * meet its printed total is reported as `mismatch` instead of being balanced with an invented
 * rounding or discount (spec §6 rule 9, §16.2).
 */
import Decimal from 'decimal.js';
import { EXPENSE_CAPTURE_OBSERVATION_LIMITS, expenseCaptureFieldRole } from '@watchdog-bms/contracts';
import type {
  ExpenseCaptureAssembledObservations,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureDocumentObservation,
  ExpenseCaptureDocumentReconciliation,
  ExpenseCaptureExtractWindow,
  ExpenseCaptureItemObservation,
  ExpenseCaptureObservations,
  ExpenseCapturePaymentObservation,
  ExpenseCaptureRefundObservation,
  ExpenseCaptureTotalObservation,
} from '@watchdog-bms/contracts';

/** Appendix §4.4: satang-level tolerance, the same one the expense charge reconciliation uses. */
export const EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE = '0.05';

/** Order-level discounts reduce the document; an item-scope one is already inside its row. */
const ORDER_DISCOUNT_SCOPES = new Set(['order', 'checkout', 'document']);

/**
 * W10 D2: the retail N/V summary block (7-Eleven, Lotus's, Big C, Makro) prints GOODS subtotals
 * whose labels contain the word ภาษี — "สินค้าไม่เสียภาษีมูลค่าเพิ่ม 9.00" is the non-taxed part of
 * the basket, "มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม 66.36" and "มูลค่าสินค้ารวมภาษีมูลค่าเพิ่ม 71.00" are
 * the taxed part before and after its VAT. On the real CP ALL invoice the reader labelled the first
 * of them `applied_discount`, which took 9.00 off a document that added up. None of these rows is
 * money added or taken off, and none of them is the VAT AMOUNT: they are `summary`, always.
 */
const GOODS_SUBTOTAL_LABEL = /ไม่เสียภาษี|ยกเว้นภาษี|ไม่รวมภาษี|ก่อนภาษี|ก่อน\s*vat|รวมภาษีมูลค่าเพิ่ม|รวม\s*vat|non[\s-]?vat|before\s*vat|includ\w*\s*vat|exclud\w*\s*vat/i;
/** Roles a goods subtotal must never keep: each of them would move money or claim to be the tax. */
const GOODS_SUBTOTAL_WRONG_ROLES = new Set(['applied_discount', 'tax_included', 'tax_additional', 'tax_unknown']);
/** The VAT row itself: "ภาษีมูลค่าเพิ่ม 4.64" / "VAT 7% 776.87", never one of the rows above. */
const VAT_AMOUNT_LABEL = /ภาษีมูลค่าเพิ่ม|\bvat\b/i;
/**
 * A row whose label says it is a discount stays a discount whatever else the label mentions:
 * "ส่วนลดก่อนภาษี" and "ส่วนลดรวม VAT" are discounts qualified by a tax phrase, not goods subtotals,
 * and re-filing them would drop real money from the reconciliation and from the draft.
 */
const DISCOUNT_LABEL = /ส่วนลด|discount|คูปอง|coupon|voucher|โค้ด|promo/i;
/**
 * Thailand's standard VAT rate. A derived tax total may never exceed what 7 % of the document could
 * be (`total × 7 / 107`, the VAT inside a fully taxable inclusive total): a photographed summary
 * block whose labels came back shifted by one row otherwise turns "มูลค่าสินค้ารวมภาษี 71.00" into a
 * VAT of 71.00 on an 80-baht basket — worse than the empty VAT field it replaces.
 */
const THAI_VAT_RATE = new Decimal('0.07');

export type CaptureAssemblyWindow = {
  /** Window id, only used to keep document refs unique across windows. */
  id: string;
  observations: ExpenseCaptureObservations;
};

const money = (value: string | undefined): Decimal | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = new Decimal(normalized);
  return parsed.isFinite() ? parsed : null;
};

/**
 * Merge every window into one document graph.
 *
 * Two readings are the SAME document when the later one continues the earlier (`continuationOfRef`)
 * or when both print the same issuer AND the same document number. A shared shop name alone never
 * merges two bills (§16.8) — that is how two receipts in one file stay two documents.
 */
export function assembleCaptureObservations(
  windows: readonly CaptureAssemblyWindow[],
  context: { pageCount: number },
): ExpenseCaptureAssembledObservations {
  const documents: ExpenseCaptureDocumentObservation[] = [];
  /** `<windowId>|<ref>` → the canonical ref it merged into. */
  const canonical = new Map<string, string>();
  const byIdentity = new Map<string, string>();

  for (const window of windows) {
    for (const document of window.observations.documents ?? []) {
      const identity = documentIdentity(document);
      const continued = document.continuationOfRef
        ? canonical.get(`${window.id}|${document.continuationOfRef}`)
          ?? [...canonical.entries()].find(([key]) => key.endsWith(`|${document.continuationOfRef}`))?.[1]
        : undefined;
      const existingRef = continued ?? (identity ? byIdentity.get(identity) : undefined);
      if (existingRef) {
        canonical.set(`${window.id}|${document.ref}`, existingRef);
        mergeDocument(documents.find((row) => row.ref === existingRef)!, document);
        if (identity && !byIdentity.has(identity)) byIdentity.set(identity, existingRef);
        continue;
      }
      const ref = uniqueRef(documents, document.ref);
      canonical.set(`${window.id}|${document.ref}`, ref);
      if (identity) byIdentity.set(identity, ref);
      const { continuationOfRef: _dropped, ...rest } = document;
      documents.push({ ...rest, ref, pageIndexes: [...new Set(document.pageIndexes)].sort((a, b) => a - b) });
    }
  }

  const resolve = (windowId: string, ref: string): string | null => canonical.get(`${windowId}|${ref}`) ?? null;

  const items: ExpenseCaptureItemObservation[] = [];
  const components: ExpenseCaptureComponentObservation[] = [];
  const totals: ExpenseCaptureTotalObservation[] = [];
  const payments: ExpenseCapturePaymentObservation[] = [];
  const refunds: ExpenseCaptureRefundObservation[] = [];
  const seenItems = new Set<string>();
  const seenComponents = new Set<string>();
  const seenTotals = new Set<string>();
  const seenPayments = new Set<string>();
  const seenRefunds = new Set<string>();
  let itemsTruncated = false;
  let unreadableRows = 0;
  const pagesCovered = new Set<number>();
  const notes: string[] = [];

  for (const window of windows) {
    const observations = window.observations;
    for (const item of observations.items ?? []) {
      const documentRef = resolve(window.id, item.documentRef);
      if (!documentRef) continue;
      // Rows are NOT deduped by description — two lines of the same product are two purchases
      // (§16.2). V2 ids bind original page offsets, including across split windows.
      const key = `${documentRef}|${item.id}`;
      if (seenItems.has(key)) continue;
      seenItems.add(key);
      items.push({ ...item, documentRef });
    }
    for (const raw of observations.components ?? []) {
      const documentRef = resolve(window.id, raw.documentRef);
      if (!documentRef) continue;
      // W10 D2: the model's own role is a suggestion. A goods subtotal of the retail N/V block is
      // filed by what it SAYS, before it can take 9 baht off a basket that balances.
      const component = goodsSubtotalRole(raw);
      // A footer discount reprinted on every page is ONE discount (§4.4): identity is what it is,
      // where it applies and how much — the first span wins, which is the one the reviewer opens.
      const key = `${documentRef}|${component.role}|${component.scope}|${component.label}|${component.amount ?? ''}`;
      if (seenComponents.has(key)) continue;
      seenComponents.add(key);
      components.push({ ...component, documentRef });
    }
    for (const total of observations.totals ?? []) {
      const documentRef = resolve(window.id, total.documentRef);
      if (!documentRef) continue;
      const key = `${documentRef}|${total.kind}|${total.amount}`;
      if (seenTotals.has(key)) continue;
      seenTotals.add(key);
      totals.push({ ...total, documentRef });
    }
    for (const payment of observations.payments ?? []) {
      const documentRef = resolve(window.id, payment.documentRef);
      if (!documentRef) continue;
      const key = `${documentRef}|${payment.method ?? ''}|${payment.status}|${payment.amount ?? ''}|${payment.occurredAt ?? ''}|${payment.reference ?? ''}`;
      if (seenPayments.has(key)) continue;
      seenPayments.add(key);
      payments.push({ ...payment, documentRef });
    }
    for (const refund of observations.refunds ?? []) {
      const documentRef = resolve(window.id, refund.documentRef);
      if (!documentRef) continue;
      const key = `${documentRef}|${refund.state}|${refund.amount ?? ''}|${refund.destination ?? ''}`;
      if (seenRefunds.has(key)) continue;
      seenRefunds.add(key);
      refunds.push({ ...refund, documentRef });
    }
    const completeness = observations.completeness;
    if (completeness?.itemsTruncated) itemsTruncated = true;
    unreadableRows += completeness?.unreadableRows ?? 0;
    for (const page of completeness?.pagesCovered ?? []) pagesCovered.add(page);
    for (const note of completeness?.notes ?? []) if (!notes.includes(note)) notes.push(note);
  }

  // W10 D2: a printed VAT amount the model filed as a component and not as a total is still this
  // document's tax — without it the reviewer's VAT field stays empty on every 7-Eleven full form.
  for (const document of documents) {
    const derived = derivedTaxTotal(document.ref, components, totals);
    if (derived) totals.push(derived);
  }

  const reconciliation = documents.map((document) =>
    reconcileDocument(document, items, components, totals, context.pageCount));
  const issuers = new Set(documents.map((document) => (document.issuer?.name ?? '').trim()).filter(Boolean));

  return {
    ...(windows.length && windows.every(window => window.observations.fieldEvidenceVersion === 2) ? { fieldEvidenceVersion: 2 as const } : {}),
    documents,
    items,
    components,
    totals,
    payments,
    refunds,
    completeness: {
      itemsTruncated,
      unreadableRows,
      pagesCovered: [...pagesCovered].sort((a, b) => a - b),
      notes: notes.slice(0, 20),
    },
    reconciliation,
    multiDocument: documents.length > 1 || issuers.size > 1,
  };
}

/**
 * W10 D2: a component that the page itself calls a goods subtotal is `summary`, whatever role the
 * model chose. Only the roles that would move money or claim to be the VAT are rewritten — a
 * `charge` whose printed label happens to mention VAT is still a charge the buyer paid.
 */
function goodsSubtotalRole(
  component: ExpenseCaptureComponentObservation,
): ExpenseCaptureComponentObservation {
  if (!GOODS_SUBTOTAL_WRONG_ROLES.has(component.role)) return component;
  if (DISCOUNT_LABEL.test(`${component.label} ${component.evidenceSpan}`)) return component;
  return GOODS_SUBTOTAL_LABEL.test(`${component.label} ${component.evidenceSpan}`)
    ? { ...component, role: 'summary', ...(component.fieldEvidence ? { fieldEvidence: Object.fromEntries(Object.entries(component.fieldEvidence).map(([field, evidence]) => [field, { ...evidence, role: expenseCaptureFieldRole({ role: 'summary' }, field) }])) } : {}) }
    : component;
}

/**
 * W10 D2: the `tax` total of a document whose printed VAT row came back as a component.
 *
 * Returns nothing when the document already has a `tax` total (the read's own answer wins), when no
 * component prints a bare VAT amount, or when two of them print DIFFERENT amounts — a document that
 * states its VAT twice over is a question for the reviewer, not a value to pick from.
 */
function derivedTaxTotal(
  documentRef: string,
  components: readonly ExpenseCaptureComponentObservation[],
  totals: readonly ExpenseCaptureTotalObservation[],
): ExpenseCaptureTotalObservation | null {
  if (totals.some((total) => total.documentRef === documentRef && total.kind === 'tax')) return null;
  const documentTotal = money(totals.find((total) => total.documentRef === documentRef && total.kind === 'document_total')?.amount);
  if (!documentTotal) return null;
  const vatCeiling = documentTotal.times(THAI_VAT_RATE).dividedBy(THAI_VAT_RATE.plus(1)).plus(EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE);
  const candidates = components.filter((component) => component.documentRef === documentRef
    && component.amount !== undefined
    && money(component.amount) !== null
    && !GOODS_SUBTOTAL_LABEL.test(`${component.label} ${component.evidenceSpan}`)
    && !DISCOUNT_LABEL.test(`${component.label} ${component.evidenceSpan}`)
    && VAT_AMOUNT_LABEL.test(`${component.label} ${component.evidenceSpan}`));
  const amounts = new Set(candidates.map((component) => money(component.amount)!.toString()));
  const first = candidates[0];
  if (amounts.size !== 1 || !first) return null;
  // Plausibility, not arithmetic proof: an amount above the 7 % ceiling is some other row's money.
  if (money(first.amount)!.greaterThan(vatCeiling)) return null;
  return { documentRef, kind: 'tax', amount: first.amount!, evidenceSpan: first.evidenceSpan,
    ...(first.fieldEvidence?.amount ? { fieldEvidence: { amount: { ...first.fieldEvidence.amount, role: 'tax:amount' } } } : {}) };
}

/** Same issuer AND same printed number. Either one missing means "cannot prove they are one". */
function documentIdentity(document: ExpenseCaptureDocumentObservation): string | null {
  const issuer = (document.issuer?.name ?? '').trim().toUpperCase();
  const number = (document.documentNumber ?? '').trim().toUpperCase();
  return issuer && number ? `${issuer}|${number}` : null;
}

/** A later page may print facts the header page did not; it never overwrites one that is set. */
function mergeDocument(
  into: ExpenseCaptureDocumentObservation,
  from: ExpenseCaptureDocumentObservation,
): void {
  const printedEvidence = new Map([
    ...(from.printedPage?.number !== undefined ? [[from.printedPage.number, from.fieldEvidence?.['printedPage.number']] as const] : []),
    ...(into.printedPage?.number !== undefined ? [[into.printedPage.number, into.fieldEvidence?.['printedPage.number']] as const] : []),
    ...(from.printedPages ?? []).map((value, index) => [value, from.fieldEvidence?.[`printedPages.${index}`]] as const),
    ...(into.printedPages ?? []).map((value, index) => [value, into.fieldEvidence?.[`printedPages.${index}`]] as const),
  ]);
  if (from.fieldEvidence || into.fieldEvidence) into.fieldEvidence = { ...from.fieldEvidence, ...into.fieldEvidence };
  into.pageIndexes = [...new Set([...into.pageIndexes, ...from.pageIndexes])].sort((a, b) => a - b);
  into.documentNumber ??= from.documentNumber;
  into.documentDate ??= from.documentDate;
  into.currency ??= from.currency;
  into.buyer ??= from.buyer;
  if (from.issuer) into.issuer = { ...from.issuer, ...into.issuer };
  // The printed "page n of m" of ANY page proves how many pages the document claims to have.
  if (from.printedPage?.of !== undefined && (into.printedPage?.of ?? 0) < from.printedPage.of) {
    into.printedPage = { ...into.printedPage, of: from.printedPage.of };
    if (from.fieldEvidence?.['printedPage.of']) (into.fieldEvidence ??= {})['printedPage.of'] = from.fieldEvidence['printedPage.of'];
  }
  into.printedPages = [...new Set([...(into.printedPages ?? []), ...(from.printedPages ?? []), ...printedNumbers(into, from)])];
  if (into.fieldEvidence) {
    for (const key of Object.keys(into.fieldEvidence)) if (key.startsWith('printedPages.')) delete into.fieldEvidence[key];
    into.printedPages.forEach((value, index) => { const evidence = printedEvidence.get(value); if (evidence) into.fieldEvidence![`printedPages.${index}`] = { ...evidence, role: `document:printedPages.${index}` }; });
  }
}

/** Every printed page number seen for this document, so a gap (1 of 3, 3 of 3) is visible. */
function printedNumbers(
  into: ExpenseCaptureDocumentObservation,
  from: ExpenseCaptureDocumentObservation,
): number[] {
  return [into.printedPage?.number, from.printedPage?.number].filter((value): value is number => typeof value === 'number');
}

function uniqueRef(documents: readonly ExpenseCaptureDocumentObservation[], ref: string): string {
  if (!documents.some((document) => document.ref === ref)) return ref;
  let suffix = 2;
  while (documents.some((document) => document.ref === `${ref}#${suffix}`)) suffix += 1;
  return `${ref}#${suffix}`;
}

/**
 * `Σ sale − Σ void − Σ applied_discount(order/checkout/document) + Σ charge` against the printed
 * `document_total` (§4.4).
 *
 * Every refusal is deliberate: a sale row with no printed amount makes the answer `insufficient`
 * rather than a total computed from the rows that happen to be readable; a void cancels only when
 * it names the row it cancels; `tender`, `change`, `future_reward`, `summary` and `balance` never
 * enter the sum (500 handed over and 68 back is a purchase of 68, not of 500).
 *
 * The one addition (W10 D1) is also a refusal: a discount the printed rows have already had taken
 * off is NOT subtracted a second time, and the row says so (`discountAlreadyInRows`).
 */
function reconcileDocument(
  document: ExpenseCaptureDocumentObservation,
  items: readonly ExpenseCaptureItemObservation[],
  components: readonly ExpenseCaptureComponentObservation[],
  totals: readonly ExpenseCaptureTotalObservation[],
  pageCount: number,
): ExpenseCaptureDocumentReconciliation {
  const ownItems = items.filter((item) => item.documentRef === document.ref);
  const ownComponents = components.filter((component) => component.documentRef === document.ref);
  const ownTotals = totals.filter((total) => total.documentRef === document.ref);
  const documentTotal = money(ownTotals.find((total) => total.kind === 'document_total')?.amount);
  const suspectedMissingPages = hasMissingPages(document, pageCount);
  const base: ExpenseCaptureDocumentReconciliation = {
    documentRef: document.ref,
    status: 'insufficient',
    ...(documentTotal ? { documentTotal: documentTotal.toString() } : {}),
    suspectedMissingPages,
  };

  const saleRows = ownItems.filter((item) => item.event === 'sale' || item.event === 'price_correction');
  const itemIds = new Set(ownItems.map((item) => item.id));
  let sum: Decimal | null = null;
  if (saleRows.length > 0) {
    let total = new Decimal(0);
    for (const row of saleRows) {
      const amount = money(row.amount);
      // Unknown stays unknown: one unreadable row makes the document's own arithmetic unprovable.
      if (!amount) return base;
      total = total.plus(amount);
    }
    sum = total;
  } else {
    // No item block at all (a summary-only page): the printed merchandise subtotal is the base.
    // A `merchandise` total is NOT used when rows exist — a subtotal that already includes
    // shipping would then be added to the shipping charge twice (A25).
    const merchandise = money(ownTotals.find((total) => total.kind === 'merchandise')?.amount);
    if (!merchandise) return base;
    sum = merchandise;
  }

  for (const row of ownItems) {
    if (row.event !== 'void') continue;
    // Evidence, not inference: an unlinked negative row is reported, never netted off (§16.2).
    if (!row.linkedItemId || !itemIds.has(row.linkedItemId)) continue;
    const amount = money(row.amount);
    if (!amount) return base;
    sum = sum.minus(amount.abs());
  }
  // W10 D1: a per-line discount that the summary repeats has already been taken off every row.
  const alreadyNet = saleRows.length > 0 && discountAlreadyInRows(sum, ownComponents, ownTotals);
  for (const component of ownComponents) {
    const amount = money(component.amount);
    if (component.role === 'applied_discount' && ORDER_DISCOUNT_SCOPES.has(component.scope)) {
      if (component.appliedStatus === 'pending') continue;
      // An unreadable discount still makes the arithmetic unprovable, net rows or not.
      if (!amount) return base;
      if (alreadyNet) continue;
      sum = sum.minus(amount.abs());
      continue;
    }
    if (component.role === 'charge' && component.scope !== 'item') {
      if (!amount) return base;
      sum = sum.plus(amount);
    }
  }

  const decision = { ...base, ...(alreadyNet ? { discountAlreadyInRows: true } : {}) };
  if (!documentTotal) return { ...decision, computedTotal: sum.toString() };
  const difference = sum.minus(documentTotal);
  return {
    ...decision,
    computedTotal: sum.toString(),
    difference: difference.toString(),
    status: difference.abs().lessThanOrEqualTo(EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE) ? 'reconciled' : 'mismatch',
  };
}

/**
 * W10 D1: true when the printed rows have ALREADY had the document's discount taken off them.
 *
 * FlowAccount, PEAK and Leceipt print a per-line discount column (`50 × 250.00, ส่วนลด 5 %,
 * มูลค่า 11,875.00`) and then repeat the SAME 625.00 as a document-level discount in the summary.
 * §4.4's `Σ sale − Σ discount` therefore subtracted it twice and reported `mismatch −625` on an
 * invoice that adds up — the layout every marketplace seller's e-tax tool produces.
 *
 * The proof is the document's own PRINTED pre-discount subtotal, never an inferred one: rows that
 * already net the discount come to `subtotal − discount`, gross rows come to `subtotal` itself, so
 * the two layouts cannot be confused. (When the rows print a unit price this is the same identity as
 * `Σ quantity × unitPrice = subtotal`; the abbreviated form prints no unit price, only the subtotal.)
 */
function discountAlreadyInRows(
  rowSum: Decimal,
  components: readonly ExpenseCaptureComponentObservation[],
  totals: readonly ExpenseCaptureTotalObservation[],
): boolean {
  let discount = new Decimal(0);
  for (const component of components) {
    if (component.role !== 'applied_discount' || !ORDER_DISCOUNT_SCOPES.has(component.scope)) continue;
    if (component.appliedStatus === 'pending') continue;
    const amount = money(component.amount);
    if (!amount) return false;
    discount = discount.plus(amount.abs());
  }
  if (!discount.greaterThan(EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE)) return false;
  const gross = rowSum.plus(discount);
  const printed = [
    ...totals.filter((total) => total.kind === 'merchandise').map((total) => money(total.amount)),
    // อย่างย่อ prints no merchandise total — only the "รวมเป็นเงิน" line above the discount.
    ...components.filter((component) => component.role === 'summary').map((component) => money(component.amount)),
  ];
  return printed.some((value) => value !== null
    && value.minus(gross).abs().lessThanOrEqualTo(EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE));
}

/**
 * §16.8: a printed `page n of m` is the document's own claim about its size. `m` larger than the
 * file's page count, or a gap in the printed numbers, means pages are missing from the EVIDENCE —
 * file coverage can still be complete, and nothing here invents the missing page.
 */
function hasMissingPages(document: ExpenseCaptureDocumentObservation, pageCount: number): boolean {
  const of = document.printedPage?.of;
  if (typeof of !== 'number' || of < 1) return false;
  if (of > pageCount) return true;
  const seen = new Set(document.printedPages ?? []);
  if (typeof document.printedPage?.number === 'number') seen.add(document.printedPage.number);
  if (seen.size === 0) return false;
  for (let page = 1; page <= of; page += 1) if (!seen.has(page)) return true;
  return false;
}

/**
 * Consecutive read pages grouped into windows inside the declared 12,000-character ceiling (§4.3).
 * Whole pages stay together when possible. Long pages split at line boundaries without losing
 * their tail; an oversized single line stays whole for the Gateway's explicit size refusal.
 */
export function planWindows(
  pages: Record<string, { text?: string }>,
): Array<{ id: string; pageIndexes: number[]; pages: ExpenseCaptureExtractWindow['pages'] }> {
  const ordered = Object.entries(pages)
    .map(([index, page]) => ({ pageIndex: Number(index), text: page.text ?? '' }))
    .filter((page) => Number.isSafeInteger(page.pageIndex) && page.text.trim().length > 0)
    .sort((left, right) => left.pageIndex - right.pageIndex);
  const windows: Array<{ id: string; pageIndexes: number[]; pages: ExpenseCaptureExtractWindow['pages'] }> = [];
  let current: { id: string; pageIndexes: number[]; pages: ExpenseCaptureExtractWindow['pages']; chars: number } | null = null;
  const chunks = ordered.flatMap(page => {
    const chunks: ExpenseCaptureExtractWindow['pages'] = [];
    const limit = EXPENSE_CAPTURE_OBSERVATION_LIMITS.maxWindowTextChars;
    for (let start = 0; start < page.text.length;) {
      let end = page.text.length;
      if (end - start > limit) {
        const previousBreak = page.text.lastIndexOf('\n', start + limit - 1);
        const nextBreak = page.text.indexOf('\n', start + limit);
        end = previousBreak >= start ? previousBreak + 1 : nextBreak >= 0 ? nextBreak + 1 : page.text.length;
      }
      chunks.push({ pageIndex: page.pageIndex, text: page.text.slice(start, end), ...(start ? { sourceOffset: start } : {}) });
      start = end;
    }
    return chunks;
  });
  for (const page of chunks) {
    const text = page.text;
    if (current && (current.chars + text.length > EXPENSE_CAPTURE_OBSERVATION_LIMITS.maxWindowTextChars || current.pageIndexes.includes(page.pageIndex))) {
      windows.push({ id: current.id, pageIndexes: current.pageIndexes, pages: current.pages });
      current = null;
    }
    if (!current) current = { id: `w${windows.length + 1}`, pageIndexes: [], pages: [], chars: 0 };
    current.pageIndexes.push(page.pageIndex);
    current.pages.push(page);
    current.chars += text.length;
  }
  if (current) windows.push({ id: current.id, pageIndexes: current.pageIndexes, pages: current.pages });
  return windows;
}

/** What a later window is told about the documents earlier windows already found (§4.3). */
export function priorDocuments(
  windows: Record<string, ExpenseCaptureObservations>,
): NonNullable<ExpenseCaptureExtractWindow['priorDocuments']> {
  const out: NonNullable<ExpenseCaptureExtractWindow['priorDocuments']> = [];
  for (const observations of Object.values(windows)) {
    for (const document of observations.documents ?? []) {
      if (out.length >= EXPENSE_CAPTURE_OBSERVATION_LIMITS.maxDocumentsPerWindow) return out;
      out.push({
        ref: document.ref,
        ...(document.issuer?.name ? { issuerName: document.issuer.name } : {}),
        ...(document.documentNumber ? { documentNumber: document.documentNumber } : {}),
        ...(document.documentDate ? { documentDate: document.documentDate } : {}),
        ...(document.currency ? { currency: document.currency } : {}),
        openTotals: !(observations.totals ?? []).some((total) => total.documentRef === document.ref && total.kind === 'document_total'),
      });
    }
  }
  return out;
}
