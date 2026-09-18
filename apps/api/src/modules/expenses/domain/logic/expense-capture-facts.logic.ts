/**
 * Buyer expense capture — the group's assembled facts, and the human edits to them (W04a).
 *
 * Appendix §4.4 (assembly/reconciliation) and §9 (`POST …/facts`). Pure: no clock, no database,
 * no AI. Everything here is a restatement of what a document already says — the one thing this
 * file is allowed to decide is which observation of a file is the current one.
 *
 * `distributeCaptureAmounts` is shared with `expense-capture-allocation.logic.ts` on purpose: the
 * reconciliation and the allocation must divide a checkout coupon exactly the same way, or a
 * document that reconciles at 810 would be split into scopes that add up to something else.
 */
import Decimal from 'decimal.js';
import type {
  CaptureDocumentReconciliation,
  CaptureDocumentState,
  CaptureFactsComponent,
  CaptureFactsDocument,
  CaptureFactsItem,
  CaptureFactsPatch,
  CaptureFactsProvenance,
  CaptureFactsSource,
  CaptureFactsView,
  CaptureHumanObservationPayload,
  ExpenseCaptureComponentRole,
  ExpenseCaptureCompleteness,
  ExpenseCaptureItemEvent,
  ExpenseCaptureObservations,
  ExpenseCaptureTotalKind,
} from '@watchdog-bms/contracts';
import { EXPENSE_TOTALS_TOLERANCE } from './expense-totals.logic';
import { deriveCaptureScopeKey } from './expense-capture.logic';

// Satang policy of `expense-totals.logic.ts` §19d, restated in three lines rather than exported
// from there: that file is shared with the draft use cases and is not this wave's to widen.
const D = (value: string | number | null | undefined): Decimal => {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};
const round2 = (value: Decimal): Decimal => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const money = (value: Decimal): string => round2(value).toFixed(2);

/** A money/quantity string we are willing to do arithmetic on. Anything else stays unknown. */
const NUMERIC = /^-?\d{1,13}(\.\d{1,4})?$/;
export const isCaptureNumeric = (value: string | null | undefined): value is string =>
  typeof value === 'string' && NUMERIC.test(value.trim());

const numeric = (value: string | null | undefined): Decimal | null =>
  isCaptureNumeric(value) ? D(value.trim()) : null;

// ─── Which observation is the current one ─────────────────────────────────────

export type CaptureObservationRow = {
  id: string;
  fileId: string | null;
  expenseId?: string | null;
  version: number;
  source: CaptureFactsSource;
  basedOnVersion?: number | null;
  stale?: boolean | null;
  payloadJson: unknown;
};

/**
 * The key a file's facts live under. A converted expense (§3.1) has no file at all, so its own id
 * is the key — otherwise every conversion in a group would collide on `null`.
 */
export const captureFactsKey = (row: Pick<CaptureObservationRow, 'fileId' | 'expenseId' | 'id'>): string =>
  row.fileId ?? (row.expenseId ? `expense:${row.expenseId}` : `observation:${row.id}`);

const SOURCE_RANK: Record<CaptureFactsSource, number> = { HUMAN: 3, EXPENSE_FACTS: 2, AI: 1 };

/**
 * One observation per file: the newest HUMAN version if a person has touched this file at all,
 * otherwise the newest non-stale machine version.
 *
 * HUMAN wins outright rather than by version number because a read that lands after a correction
 * carries a higher version of its own (A12/A48): `basedOnVersion` records what the human edited,
 * and a later AI version is a parallel branch, not a successor.
 */
export function selectCaptureObservations(
  rows: readonly CaptureObservationRow[],
): Map<string, CaptureObservationRow> {
  const best = new Map<string, CaptureObservationRow>();
  for (const row of rows) {
    if (row.stale) continue;
    const key = captureFactsKey(row);
    const current = best.get(key);
    if (!current || wins(row, current)) best.set(key, row);
  }
  return best;
}

function wins(candidate: CaptureObservationRow, current: CaptureObservationRow): boolean {
  const rank = SOURCE_RANK[candidate.source] - SOURCE_RANK[current.source];
  if (rank !== 0) return rank > 0;
  return candidate.version > current.version;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

const EMPTY_COMPLETENESS = (): ExpenseCaptureCompleteness =>
  ({ itemsTruncated: false, unreadableRows: 0, pagesCovered: [], notes: [] });

const observations = (payload: unknown): ExpenseCaptureObservations => {
  const value = (payload ?? {}) as Partial<ExpenseCaptureObservations>;
  return {
    documents: Array.isArray(value.documents) ? value.documents : [],
    items: Array.isArray(value.items) ? value.items : [],
    components: Array.isArray(value.components) ? value.components : [],
    totals: Array.isArray(value.totals) ? value.totals : [],
    payments: Array.isArray(value.payments) ? value.payments : [],
    refunds: Array.isArray(value.refunds) ? value.refunds : [],
    completeness: value.completeness ?? EMPTY_COMPLETENESS(),
  };
};

/** `<fileId>:<id>`: an item id is `<page>:<line>`, unique inside ONE read and nowhere else. */
const ns = (fileId: string, id: string): string => `${fileId}:${id}`;

/**
 * Every file's facts, merged into one view: documents keep their identity, items keep their rows,
 * and nothing is deduplicated by name (A27) or merged because two files show the same total.
 */
export function assembleCaptureFacts(rows: readonly CaptureObservationRow[]): CaptureFactsView {
  const selected = [...selectCaptureObservations(rows).entries()].sort(([left], [right]) => (left < right ? -1 : 1));

  const view: CaptureFactsView = {
    documents: [], items: [], components: [], totals: [], payments: [], refunds: [],
    completeness: EMPTY_COMPLETENESS(),
    files: [],
    summary: { documents: 0, items: 0, filesRead: 0, filesPartial: 0, unknownItems: 0 },
  };
  const pagesCovered = new Set<number>();

  for (const [fileId, row] of selected) {
    const facts = observations(row.payloadJson);
    const scopeOf = new Map<string, string>();

    for (const document of facts.documents) {
      const ref = ns(fileId, document.ref);
      const scopeKey = deriveCaptureScopeKey({
        id: ref,
        vendorTaxIdSnapshot: document.issuer?.taxId ?? null,
        vendorNameSnapshot: document.issuer?.name ?? null,
      });
      scopeOf.set(document.ref, scopeKey);
      view.documents.push({
        ...document,
        ref,
        ...(document.continuationOfRef ? { continuationOfRef: ns(fileId, document.continuationOfRef) } : {}),
        fileId,
        scopeKey,
        // Filled below, once every file has contributed the rows this document is made of.
        state: { reconciliation: 'insufficient', paymentStatus: 'unknown', unknownAmounts: [], completeness: facts.completeness },
      });
    }
    for (const item of facts.items) {
      view.items.push({
        ...item,
        id: ns(fileId, item.id),
        documentRef: ns(fileId, item.documentRef),
        ...(item.linkedItemId ? { linkedItemId: ns(fileId, item.linkedItemId) } : {}),
        fileId,
        scopeKey: scopeOf.get(item.documentRef) ?? `issuer:${ns(fileId, item.documentRef)}`,
      });
    }
    for (const component of facts.components) {
      view.components.push({
        ...component,
        id: ns(fileId, component.id),
        documentRef: ns(fileId, component.documentRef),
        ...(component.parentId ? { parentId: ns(fileId, component.parentId) } : {}),
        fileId,
        scopeKey: scopeOf.get(component.documentRef) ?? `issuer:${ns(fileId, component.documentRef)}`,
      });
    }
    for (const total of facts.totals) view.totals.push({ ...total, documentRef: ns(fileId, total.documentRef), fileId });
    for (const payment of facts.payments) view.payments.push({ ...payment, documentRef: ns(fileId, payment.documentRef), fileId });
    for (const refund of facts.refunds) view.refunds.push({ ...refund, documentRef: ns(fileId, refund.documentRef), fileId });

    view.files.push({
      fileId, observationId: row.id, version: row.version, source: row.source,
      completeness: facts.completeness,
    });
    view.completeness.itemsTruncated ||= facts.completeness.itemsTruncated === true;
    view.completeness.unreadableRows += Number(facts.completeness.unreadableRows ?? 0);
    for (const page of facts.completeness.pagesCovered ?? []) pagesCovered.add(page);
    view.completeness.notes.push(...(facts.completeness.notes ?? []));
  }

  view.completeness.pagesCovered = [...pagesCovered].sort((left, right) => left - right);

  const distribution = distributeCaptureAmounts(view);
  for (const document of view.documents) document.state = documentState(view, document.ref, distribution);

  view.summary = {
    documents: view.documents.length,
    items: view.items.length,
    filesRead: view.files.length,
    filesPartial: view.files.filter((file) => file.completeness.itemsTruncated || Number(file.completeness.unreadableRows ?? 0) > 0).length,
    unknownItems: [...distribution.items.values()].filter((item) => item.base === null).length,
  };
  return view;
}

// ─── Distribution: what each row is worth, and what each document adds up to ──

export type CaptureItemAmounts = {
  itemId: string;
  documentRef: string;
  scopeKey: string;
  /** null = the document never said. Never 0 (spec §6 rule 9). */
  base: Decimal | null;
  quantity: Decimal;
  quantityKnown: boolean;
  /** Units cancelled by a linked `void` row (A52). */
  cancelledQuantity: Decimal;
  selectable: boolean;
  itemDiscount: Decimal;
  discountShares: Array<{ componentId: string; share: Decimal; remainderAdjust: boolean }>;
  /** base − every discount that reached this row. The basis for the shipping split. */
  netBase: Decimal;
  shipping: Decimal;
  shippingShares: Array<{ componentId: string; share: Decimal }>;
  charges: Map<string, Decimal>;
};

export type CaptureDocumentAmounts = {
  itemsBase: Decimal;
  discount: Decimal;
  charge: Decimal;
  taxAdditional: Decimal;
  /** Rows that would be needed to add this document up and could not be read. */
  unknownAmounts: string[];
  hasUnclassified: boolean;
};

export type CaptureDistribution = {
  items: Map<string, CaptureItemAmounts>;
  documents: Map<string, CaptureDocumentAmounts>;
};

/** Items a person may hand to the company. Everything else describes the bill, it is not on it. */
const SELECTABLE_EVENTS = new Set<ExpenseCaptureItemEvent>(['sale', 'zero_price_promo', 'reward', 'info']);
/** Rows that carry no money of their own — a gift adds nothing to the bill (A27). */
const ZERO_BASE_EVENTS = new Set<ExpenseCaptureItemEvent>(['zero_price_promo', 'reward', 'info']);
/** Roles that never move an amount (A06/A29/A30/A49/A56/A57). */
const INERT_ROLES = new Set<ExpenseCaptureComponentRole>([
  'tender', 'change', 'future_reward', 'refund', 'balance', 'summary', 'tax_included',
]);

const applied = (component: { appliedStatus: string }): boolean => component.appliedStatus === 'applied';

/**
 * Splits `amount` across `basis` in proportion to each entry's weight, to the satang, by largest
 * remainder with a stable tie-break on id (spec §6 rule 7). Σ of the shares is exactly `amount`.
 *
 * A zero basis (every weight 0) shares nothing rather than dividing by zero: an order discount on
 * a document whose items are all unknown has no defensible split, and the unknown blocks anyway.
 */
export function shareByBasis(
  amount: Decimal,
  basis: ReadonlyArray<{ id: string; weight: Decimal }>,
): Map<string, { share: Decimal; remainderAdjust: boolean }> {
  const shares = new Map<string, { share: Decimal; remainderAdjust: boolean }>();
  const total = basis.reduce((sum, entry) => sum.plus(entry.weight), new Decimal(0));
  if (basis.length === 0 || total.lte(0)) return shares;

  const target = round2(amount);
  const exact = basis.map((entry) => {
    const value = target.mul(entry.weight).div(total);
    const floor = value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    return { id: entry.id, floor, remainder: value.minus(floor) };
  });
  let assigned = exact.reduce((sum, entry) => sum.plus(entry.floor), new Decimal(0));
  // Satang left over after flooring: hand them to the largest remainders, ties by id, so the same
  // receipt always splits the same way.
  const order = [...exact].sort((left, right) => {
    const remainder = right.remainder.comparedTo(left.remainder);
    return remainder !== 0 ? remainder : (left.id < right.id ? -1 : 1);
  });
  for (const entry of exact) shares.set(entry.id, { share: entry.floor, remainderAdjust: false });
  const step = target.isNegative() ? new Decimal('-0.01') : new Decimal('0.01');
  let index = 0;
  while (!assigned.eq(target) && index < order.length * 2) {
    const entry = order[index % order.length]!;
    const current = shares.get(entry.id)!;
    shares.set(entry.id, { share: current.share.plus(step), remainderAdjust: true });
    assigned = assigned.plus(step);
    index += 1;
  }
  return shares;
}

/**
 * The whole money pipeline of `shared-discount-v1` / `shipping-by-eligible-item-v1` (appendix §7),
 * before anyone asks what is company and what is personal:
 *
 *   1. item base            = `amount`, else `quantity × unitPrice`  (never both — spec §6 rule 1)
 *   2. − item-scope discounts attached to that row
 *   3. − order/document-scope discounts, shared across that document's items by (2)
 *   4. − checkout-scope discounts, shared across that FILE's items by (3)   ← "หลังส่วนลดร้าน"
 *   5. + shipping (charge scope shipping|order, net of scope-shipping discounts, counted once)
 *        and other charges, shared by (4)
 *
 * Every stage uses `shareByBasis`, so the shares of a stage always add back up to the component.
 */
export function distributeCaptureAmounts(view: {
  documents: ReadonlyArray<Pick<CaptureFactsDocument, 'ref' | 'fileId'>>;
  items: readonly CaptureFactsItem[];
  components: readonly CaptureFactsComponent[];
}): CaptureDistribution {
  const items = new Map<string, CaptureItemAmounts>();
  const documents = new Map<string, CaptureDocumentAmounts>();
  const fileOfDocument = new Map(view.documents.map((document) => [document.ref, document.fileId]));
  const document = (ref: string): CaptureDocumentAmounts => {
    let entry = documents.get(ref);
    if (!entry) {
      entry = {
        itemsBase: new Decimal(0), discount: new Decimal(0), charge: new Decimal(0),
        taxAdditional: new Decimal(0), unknownAmounts: [], hasUnclassified: false,
      };
      documents.set(ref, entry);
    }
    return entry;
  };
  for (const ref of fileOfDocument.keys()) document(ref);

  // 1. Bases, and the voids that cancel them. A void that names no quantity cancels the row (A52).
  const cancelled = new Map<string, { quantity: Decimal; full: boolean }>();
  for (const item of view.items) {
    if (item.event !== 'void' || !item.linkedItemId) continue;
    const quantity = numeric(item.quantity ?? null);
    const entry = cancelled.get(item.linkedItemId) ?? { quantity: new Decimal(0), full: false };
    if (quantity && quantity.abs().gt(0)) entry.quantity = entry.quantity.plus(quantity.abs());
    else entry.full = true;
    cancelled.set(item.linkedItemId, entry);
  }

  for (const item of view.items) {
    const quantityRead = numeric(item.quantity ?? null);
    const quantityKnown = quantityRead !== null && quantityRead.gt(0);
    const quantity = quantityKnown ? quantityRead! : new Decimal(1);
    const amount = numeric(item.amount ?? null);
    const unitPrice = numeric(item.unitPrice ?? null);
    // Unit and extended price are different columns and are never multiplied twice (spec §6 rule 1).
    const gross = amount ?? (unitPrice ? round2(quantity.mul(unitPrice)) : null);

    let base: Decimal | null;
    let selectable = SELECTABLE_EVENTS.has(item.event);
    if (ZERO_BASE_EVENTS.has(item.event)) base = new Decimal(0);
    else if (item.event === 'sale') base = gross;
    else if (item.event === 'void') base = item.linkedItemId ? new Decimal(0) : (gross ? gross.abs().negated() : null);
    else if (item.event === 'discount') base = gross ? gross.abs().negated() : null;
    else base = gross; // price_correction / unknown keep the sign the document printed

    const voided = cancelled.get(item.id);
    const cancelledQuantity = voided
      ? (voided.full ? quantity : Decimal.min(quantity, voided.quantity))
      : new Decimal(0);
    if (base !== null && cancelledQuantity.gt(0) && quantity.gt(0)) {
      base = round2(base.mul(quantity.minus(cancelledQuantity)).div(quantity));
    }
    if (cancelledQuantity.gte(quantity)) selectable = false;

    const entry: CaptureItemAmounts = {
      itemId: item.id, documentRef: item.documentRef, scopeKey: item.scopeKey,
      base, quantity, quantityKnown, cancelledQuantity, selectable,
      itemDiscount: new Decimal(0), discountShares: [], netBase: base ?? new Decimal(0),
      shipping: new Decimal(0), shippingShares: [], charges: new Map(),
    };
    items.set(item.id, entry);
    const doc = document(item.documentRef);
    if (base === null) doc.unknownAmounts.push(item.id);
    else doc.itemsBase = doc.itemsBase.plus(base);
  }

  // 2. Item-scope discounts stay on their row.
  for (const component of view.components) {
    const doc = document(component.documentRef);
    if (component.role === 'unclassified' || component.role === 'tax_unknown') doc.hasUnclassified = true;
    if (INERT_ROLES.has(component.role) || !applied(component)) continue;
    const amount = numeric(component.amount ?? null);
    if (amount === null) { doc.unknownAmounts.push(component.id); continue; }
    if (component.role !== 'applied_discount' || component.scope !== 'item') continue;
    const target = component.parentId ? items.get(component.parentId) : undefined;
    if (!target) continue;
    const share = amount.abs();
    target.itemDiscount = target.itemDiscount.plus(share);
    target.discountShares.push({ componentId: component.id, share, remainderAdjust: false });
    target.netBase = target.netBase.minus(share);
    doc.discount = doc.discount.plus(share);
  }

  // 3/4. Order, document and checkout discounts, in that order, each on the previous stage's net.
  const discountStage = (
    scopes: ReadonlyArray<CaptureFactsComponent['scope']>,
    coverage: (component: CaptureFactsComponent) => CaptureItemAmounts[],
  ): void => {
    for (const component of view.components) {
      if (component.role !== 'applied_discount' || !scopes.includes(component.scope) || !applied(component)) continue;
      const amount = numeric(component.amount ?? null);
      if (amount === null) continue;
      const covered = coverage(component).filter((item) => item.selectable && item.base !== null);
      const shares = shareByBasis(
        amount.abs(),
        covered.map((item) => ({ id: item.itemId, weight: Decimal.max(item.netBase, 0) })),
      );
      // A checkout coupon printed under one seller still belongs to every seller it paid for, so
      // the reconciliation of each document sees its own share and not the whole coupon.
      const perDocument = new Map<string, Decimal>();
      for (const item of covered) {
        const share = shares.get(item.itemId);
        if (!share || share.share.isZero()) continue;
        item.discountShares.push({ componentId: component.id, share: share.share, remainderAdjust: share.remainderAdjust });
        item.netBase = item.netBase.minus(share.share);
        perDocument.set(item.documentRef, (perDocument.get(item.documentRef) ?? new Decimal(0)).plus(share.share));
      }
      // Nothing to apply it to: the discount still came off the bill, on its own document.
      if (perDocument.size === 0) perDocument.set(component.documentRef, amount.abs());
      for (const [ref, share] of perDocument) document(ref).discount = document(ref).discount.plus(share);
    }
  };
  const itemsOfDocument = (ref: string): CaptureItemAmounts[] =>
    [...items.values()].filter((item) => item.documentRef === ref);
  const itemsOfFile = (component: CaptureFactsComponent): CaptureItemAmounts[] => {
    const fileId = fileOfDocument.get(component.documentRef);
    if (fileId === undefined) return itemsOfDocument(component.documentRef);
    return [...items.values()].filter((item) => fileOfDocument.get(item.documentRef) === fileId);
  };

  discountStage(['order', 'document'], (component) => itemsOfDocument(component.documentRef));
  discountStage(['checkout'], itemsOfFile);

  // 5. Charges, shipping first: gross minus its own discount, counted once (spec §6 rule 2).
  const shippingDiscount = new Map<string, Decimal>();
  for (const component of view.components) {
    if (component.role !== 'applied_discount' || component.scope !== 'shipping' || !applied(component)) continue;
    const amount = numeric(component.amount ?? null);
    if (amount === null) continue;
    shippingDiscount.set(component.documentRef, (shippingDiscount.get(component.documentRef) ?? new Decimal(0)).plus(amount.abs()));
    document(component.documentRef).discount = document(component.documentRef).discount.plus(amount.abs());
  }

  for (const component of view.components) {
    const doc = document(component.documentRef);
    if (component.role === 'tax_additional' && applied(component)) {
      const amount = numeric(component.amount ?? null);
      if (amount !== null) doc.taxAdditional = doc.taxAdditional.plus(amount);
      continue;
    }
    if (component.role !== 'charge' || !applied(component)) continue;
    const amount = numeric(component.amount ?? null);
    if (amount === null) continue;
    const isShipping = component.scope === 'shipping' || component.scope === 'order';
    const net = isShipping
      ? amount.minus(shippingDiscount.get(component.documentRef) ?? new Decimal(0))
      : amount;
    if (isShipping) shippingDiscount.delete(component.documentRef);
    doc.charge = doc.charge.plus(amount);

    const covered = (component.scope === 'checkout' ? itemsOfFile(component) : itemsOfDocument(component.documentRef))
      .filter((item) => item.selectable && item.base !== null);
    const shares = shareByBasis(net, covered.map((item) => ({ id: item.itemId, weight: Decimal.max(item.netBase, 0) })));
    for (const item of covered) {
      const share = shares.get(item.itemId)?.share ?? new Decimal(0);
      if (share.isZero()) continue;
      if (isShipping) {
        item.shipping = item.shipping.plus(share);
        item.shippingShares.push({ componentId: component.id, share });
      } else {
        item.charges.set(component.id, share);
      }
    }
  }
  // A shipping discount with no shipping charge to net against is still money off the bill.
  for (const [ref, amount] of shippingDiscount) {
    if (amount.isZero()) continue;
    document(ref).charge = document(ref).charge.minus(amount);
    document(ref).discount = document(ref).discount.minus(amount);
  }

  return { items, documents };
}

// ─── Per-document state ───────────────────────────────────────────────────────

const totalOf = (
  view: Pick<CaptureFactsView, 'totals'>,
  ref: string,
  kind: ExpenseCaptureTotalKind,
): string | undefined => {
  const row = view.totals.find((total) => total.documentRef === ref && total.kind === kind);
  return row && isCaptureNumeric(row.amount) ? money(D(row.amount)) : undefined;
};

function documentState(
  view: CaptureFactsView,
  ref: string,
  distribution: CaptureDistribution,
): CaptureDocumentState {
  const amounts = distribution.documents.get(ref);
  const documentTotal = totalOf(view, ref, 'document_total');
  const payments = view.payments.filter((payment) => payment.documentRef === ref);
  const file = view.documents.find((document) => document.ref === ref)?.fileId;

  let reconciliation: CaptureDocumentReconciliation = 'insufficient';
  if (amounts && documentTotal !== undefined && amounts.unknownAmounts.length === 0) {
    // §4.4: Σ sale − Σ void − Σ applied discount + Σ charge (+ tax added on top), against the
    // total the document printed. No balancing row is ever invented to close the gap (A24/A34).
    const derived = amounts.itemsBase.minus(amounts.discount).plus(amounts.charge).plus(amounts.taxAdditional);
    reconciliation = round2(derived).minus(D(documentTotal)).abs().gt(EXPENSE_TOTALS_TOLERANCE) ? 'mismatch' : 'reconciled';
  }

  return {
    reconciliation,
    ...(documentTotal !== undefined ? { documentTotal } : {}),
    ...(totalOf(view, ref, 'buyer_payable') !== undefined ? { buyerPayable: totalOf(view, ref, 'buyer_payable')! } : {}),
    ...(totalOf(view, ref, 'reported_paid') !== undefined ? { reportedPaid: totalOf(view, ref, 'reported_paid')! } : {}),
    paymentStatus: payments.some((payment) => payment.status === 'paid') ? 'paid'
      : payments.some((payment) => payment.status === 'pending') ? 'pending' : 'unknown',
    unknownAmounts: amounts?.unknownAmounts ?? [],
    completeness: view.files.find((entry) => entry.fileId === file)?.completeness ?? EMPTY_COMPLETENESS(),
  };
}

/** `reported_paid` ?? `buyer_payable` ?? `document_total` — what the buyer actually handed over. */
export function capturePaidTotal(view: Pick<CaptureFactsView, 'totals'>, ref: string): string | undefined {
  return totalOf(view, ref, 'reported_paid') ?? totalOf(view, ref, 'buyer_payable') ?? totalOf(view, ref, 'document_total');
}

// ─── Human facts patch (§9) ───────────────────────────────────────────────────

export class CaptureFactsPatchError extends Error {
  constructor(readonly code: string, readonly messageTh: string, detail?: string) {
    super(detail ?? code);
  }
}

const PATCH_MAX_EDITS = 200;
const ITEM_EVENTS: readonly ExpenseCaptureItemEvent[] = ['sale', 'void', 'discount', 'price_correction', 'zero_price_promo', 'reward', 'info', 'unknown'];
const COMPONENT_ROLES: readonly ExpenseCaptureComponentRole[] = ['charge', 'applied_discount', 'tax_included', 'tax_additional', 'tax_unknown', 'tender', 'change', 'future_reward', 'refund', 'balance', 'summary', 'unclassified'];
const TOTAL_KINDS: readonly ExpenseCaptureTotalKind[] = ['merchandise', 'shipping', 'tax', 'document_total', 'buyer_payable', 'reported_paid'];
const PAYMENT_STATUSES = ['paid', 'pending', 'unknown'] as const;

const unsupported = (detail: string) => new CaptureFactsPatchError(
  'expense_capture_facts_patch_unsupported',
  'แก้ไขข้อมูลนี้ยังไม่รองรับ กรุณาแก้เฉพาะรายการสินค้า ยอด วันที่ หรือผู้ออกเอกสาร',
  detail,
);
const unknownTarget = (detail: string) => new CaptureFactsPatchError(
  'expense_capture_facts_patch_unknown_target',
  'ไม่พบรายการที่จะแก้ในไฟล์นี้ กรุณาเปิดข้อมูลล่าสุดแล้วลองใหม่',
  detail,
);
const invalidAmount = (detail: string) => new CaptureFactsPatchError(
  'expense_capture_facts_patch_invalid_amount',
  'กรุณากรอกตัวเลขให้ถูกต้อง (ไม่เกินทศนิยม 4 ตำแหน่ง)',
  detail,
);

const keysWithin = (entry: object, allowed: readonly string[], where: string): void => {
  for (const key of Object.keys(entry)) if (!allowed.includes(key)) throw unsupported(`${where}.${key}`);
};

/** `undefined` = not edited; `null` = edited back to unknown. */
const edited = (entry: Record<string, unknown>, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(entry, field) && entry[field] !== undefined;

/**
 * A person's correction of what a machine read, as a NEW observation (§9). Only the fields a
 * document can actually disagree about may be touched, unknown may become a value and a value may
 * become unknown again (spec §6 rule 9), and every change records what it replaced.
 *
 * Nothing is invented: a row that is not already in the file cannot be added here, because the
 * evidence for it would not exist.
 */
export function applyCaptureFactsPatch(
  current: ExpenseCaptureObservations,
  patch: CaptureFactsPatch,
  actor: { userId: string; at: string; fileId?: string },
): CaptureHumanObservationPayload {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw unsupported('patch');
  keysWithin(patch, ['items', 'components', 'totals', 'documents', 'payments'], 'patch');

  const next = structuredClone(observations(current)) as CaptureHumanObservationPayload;
  next.provenance = [];
  const edits = (patch.items?.length ?? 0) + (patch.components?.length ?? 0)
    + (patch.totals?.length ?? 0) + (patch.documents?.length ?? 0) + (patch.payments?.length ?? 0);
  if (edits === 0) {
    throw new CaptureFactsPatchError('expense_capture_facts_patch_empty', 'ยังไม่มีการแก้ไขข้อมูล', 'patch is empty');
  }
  if (edits > PATCH_MAX_EDITS) {
    throw new CaptureFactsPatchError('expense_capture_facts_patch_too_large', 'แก้ไขพร้อมกันได้ไม่เกิน 200 รายการ กรุณาแบ่งเป็นหลายครั้ง', `${edits} edits`);
  }

  // The view namespaces every id with its file; the stored observation does not. Accept both.
  const bare = (id: unknown, where: string): string => {
    if (typeof id !== 'string' || id.trim() === '') throw unknownTarget(where);
    return actor.fileId && id.startsWith(`${actor.fileId}:`) ? id.slice(actor.fileId.length + 1) : id;
  };
  const record = (target: CaptureFactsProvenance['target'], id: string, field: string, previous: unknown): void => {
    next.provenance.push({
      target, id, field, source: 'HUMAN', userId: actor.userId, at: actor.at,
      previous: previous === undefined || previous === null || previous === '' ? null : String(previous),
    });
  };
  const amount = (value: unknown, where: string): string | undefined => {
    if (value === null) return undefined;
    if (!isCaptureNumeric(value as string)) throw invalidAmount(where);
    return (value as string).trim();
  };
  const text = (value: unknown, where: string): string | undefined => {
    if (value === null) return undefined;
    if (typeof value !== 'string' || value.length > 500) throw unsupported(where);
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  for (const entry of patch.items ?? []) {
    keysWithin(entry, ['id', 'description', 'quantity', 'unitPrice', 'amount', 'event'], 'items');
    const id = bare(entry.id, 'items.id');
    const item = next.items.find((row) => row.id === id);
    if (!item) throw unknownTarget(`items.${id}`);
    if (edited(entry, 'description')) {
      const value = text(entry.description, 'items.description');
      if (value === undefined) throw unsupported('items.description');
      record('item', id, 'description', item.description);
      item.description = value;
    }
    for (const field of ['quantity', 'unitPrice', 'amount'] as const) {
      if (!edited(entry, field)) continue;
      const value = amount(entry[field], `items.${field}`);
      record('item', id, field, item[field]);
      if (value === undefined) delete item[field]; else item[field] = value;
    }
    if (edited(entry, 'event')) {
      if (!ITEM_EVENTS.includes(entry.event as ExpenseCaptureItemEvent)) throw unsupported(`items.event.${String(entry.event)}`);
      record('item', id, 'event', item.event);
      item.event = entry.event as ExpenseCaptureItemEvent;
    }
  }

  for (const entry of patch.components ?? []) {
    keysWithin(entry, ['id', 'amount', 'role'], 'components');
    const id = bare(entry.id, 'components.id');
    const component = next.components.find((row) => row.id === id);
    if (!component) throw unknownTarget(`components.${id}`);
    if (edited(entry, 'amount')) {
      const value = amount(entry.amount, 'components.amount');
      record('component', id, 'amount', component.amount);
      if (value === undefined) delete component.amount; else component.amount = value;
    }
    if (edited(entry, 'role')) {
      if (!COMPONENT_ROLES.includes(entry.role as ExpenseCaptureComponentRole)) throw unsupported(`components.role.${String(entry.role)}`);
      record('component', id, 'role', component.role);
      component.role = entry.role as ExpenseCaptureComponentRole;
    }
  }

  for (const entry of patch.totals ?? []) {
    keysWithin(entry, ['documentRef', 'kind', 'amount'], 'totals');
    const ref = bare(entry.documentRef, 'totals.documentRef');
    if (!next.documents.some((document) => document.ref === ref)) throw unknownTarget(`totals.${ref}`);
    if (!TOTAL_KINDS.includes(entry.kind)) throw unsupported(`totals.kind.${String(entry.kind)}`);
    const index = next.totals.findIndex((total) => total.documentRef === ref && total.kind === entry.kind);
    const previous = index >= 0 ? next.totals[index]!.amount : null;
    const value = amount(entry.amount, 'totals.amount');
    record('total', `${ref}:${entry.kind}`, 'amount', previous);
    if (value === undefined) { if (index >= 0) next.totals.splice(index, 1); }
    else if (index >= 0) next.totals[index]!.amount = value;
    // The reviewer read it off the document the machine could not; `evidenceSpan` says who said so.
    else next.totals.push({ documentRef: ref, kind: entry.kind, amount: value, evidenceSpan: '' });
  }

  for (const entry of patch.documents ?? []) {
    keysWithin(entry, ['ref', 'issuerName', 'issuerTaxId', 'documentNumber', 'documentDate', 'currency'], 'documents');
    const ref = bare(entry.ref, 'documents.ref');
    const document = next.documents.find((row) => row.ref === ref);
    if (!document) throw unknownTarget(`documents.${ref}`);
    if (edited(entry, 'issuerName')) {
      const value = text(entry.issuerName, 'documents.issuerName');
      record('document', ref, 'issuerName', document.issuer?.name);
      document.issuer = { ...document.issuer };
      if (value === undefined) delete document.issuer.name; else document.issuer.name = value;
    }
    if (edited(entry, 'issuerTaxId')) {
      const value = text(entry.issuerTaxId, 'documents.issuerTaxId');
      record('document', ref, 'issuerTaxId', document.issuer?.taxId);
      document.issuer = { ...document.issuer };
      if (value === undefined) delete document.issuer.taxId; else document.issuer.taxId = value;
    }
    for (const field of ['documentNumber', 'documentDate', 'currency'] as const) {
      if (!edited(entry, field)) continue;
      const value = text(entry[field], `documents.${field}`);
      record('document', ref, field, document[field]);
      if (value === undefined) delete document[field]; else document[field] = value;
    }
  }

  for (const entry of patch.payments ?? []) {
    keysWithin(entry, ['index', 'status'], 'payments');
    const payment = Number.isInteger(entry.index) ? next.payments[entry.index] : undefined;
    if (!payment) throw unknownTarget(`payments.${String(entry.index)}`);
    if (!(PAYMENT_STATUSES as readonly string[]).includes(entry.status)) throw unsupported(`payments.status.${String(entry.status)}`);
    record('payment', String(entry.index), 'status', payment.status);
    payment.status = entry.status;
  }

  if (next.provenance.length === 0) {
    throw new CaptureFactsPatchError('expense_capture_facts_patch_empty', 'ยังไม่มีการแก้ไขข้อมูล', 'patch changed nothing');
  }
  next.completeness = {
    ...next.completeness,
    notes: [...(next.completeness.notes ?? []), `human edit by ${actor.userId} at ${actor.at}`],
  };
  return next;
}
