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
import type {
  ExpenseCaptureAssembledObservations,
  ExpenseCaptureComponentObservation,
  ExpenseCaptureDocumentObservation,
  ExpenseCaptureDocumentReconciliation,
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
      // (§16.2). The id is `<page>:<line>`, so only a literally re-read row collapses.
      const key = `${documentRef}|${item.id}`;
      if (seenItems.has(key)) continue;
      seenItems.add(key);
      items.push({ ...item, documentRef });
    }
    for (const component of observations.components ?? []) {
      const documentRef = resolve(window.id, component.documentRef);
      if (!documentRef) continue;
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

  const reconciliation = documents.map((document) =>
    reconcileDocument(document, items, components, totals, context.pageCount));
  const issuers = new Set(documents.map((document) => (document.issuer?.name ?? '').trim()).filter(Boolean));

  return {
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
  into.pageIndexes = [...new Set([...into.pageIndexes, ...from.pageIndexes])].sort((a, b) => a - b);
  into.documentNumber ??= from.documentNumber;
  into.documentDate ??= from.documentDate;
  into.currency ??= from.currency;
  into.buyer ??= from.buyer;
  if (from.issuer) into.issuer = { ...from.issuer, ...into.issuer };
  // The printed "page n of m" of ANY page proves how many pages the document claims to have.
  if (from.printedPage?.of !== undefined && (into.printedPage?.of ?? 0) < from.printedPage.of) {
    into.printedPage = { ...into.printedPage, of: from.printedPage.of };
  }
  into.printedPages = [...new Set([...(into.printedPages ?? []), ...printedNumbers(into, from)])];
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
  for (const component of ownComponents) {
    const amount = money(component.amount);
    if (component.role === 'applied_discount' && ORDER_DISCOUNT_SCOPES.has(component.scope)) {
      if (component.appliedStatus === 'pending') continue;
      if (!amount) return base;
      sum = sum.minus(amount.abs());
      continue;
    }
    if (component.role === 'charge' && component.scope !== 'item') {
      if (!amount) return base;
      sum = sum.plus(amount);
    }
  }

  if (!documentTotal) return { ...base, computedTotal: sum.toString() };
  const difference = sum.minus(documentTotal);
  return {
    ...base,
    computedTotal: sum.toString(),
    difference: difference.toString(),
    status: difference.abs().lessThanOrEqualTo(EXPENSE_CAPTURE_RECONCILIATION_TOLERANCE) ? 'reconciled' : 'mismatch',
  };
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
