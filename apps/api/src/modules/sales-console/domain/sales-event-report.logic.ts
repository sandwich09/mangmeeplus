/**
 * Sales-event report (docs/specs/sales-event-discounts-spec-th.md §10): event → batch → เซลล์.
 *
 * Pure: the service reads ticket rows, this decides what each one counts as. Deliberately apart from
 * `sales-attribution.logic.ts` — a ticket is never sales credit (SD-Q3), so nothing here feeds or is
 * fed by `SalesAttribution`.
 */
import type {
  SalesEventReport,
  SalesEventReportEvent,
  SalesEventReportFigures,
  SalesEventTicketDisplayState,
} from '@watchdog-bms/contracts';

export type SalesEventReportTicketRow = {
  batchId: string; salesUserId: string;
  /** 'ISSUED' | 'RESERVED' | 'USED' | 'REVOKED'; a USED row always carries `redeemedAs` (DB CHECK). */
  state: string; redeemedAs: string | null; expiresAt: Date;
  discountSatang: number; appliedDiscountSatang: number | null;
  /** The bill a first-bill discount was paid on; null for every other row. */
  invoice: { paidSatang: number; refundedSatang: number } | null;
};

/** Spec §6.3: expired is not a state, it is ISSUED with `expiresAt <= now`. */
export function ticketDisplayState(row: { state: string; expiresAt: Date }, now: Date): SalesEventTicketDisplayState {
  if (row.state === 'RESERVED') return 'IN_PAYMENT';
  if (row.state === 'USED') return 'USED';
  if (row.state === 'REVOKED') return 'REVOKED';
  return row.expiresAt <= now ? 'EXPIRED' : 'AVAILABLE';
}

export function emptyEventReportFigures(): SalesEventReportFigures {
  return { issued: 0, available: 0, inPayment: 0, usedAsDiscount: 0, usedAsCredit: 0, expired: 0, revoked: 0,
    openDiscountSatang: 0, appliedDiscountSatang: 0, paidSatang: 0, refundedSatang: 0 };
}

function count(figures: SalesEventReportFigures, row: SalesEventReportTicketRow, now: Date): void {
  figures.issued += 1;
  switch (ticketDisplayState(row, now)) {
    case 'AVAILABLE': figures.available += 1; figures.openDiscountSatang += row.discountSatang; return;
    // RESERVED is money not yet received: "กำลังชำระ", never a use and never a sale.
    case 'IN_PAYMENT': figures.inPayment += 1; return;
    case 'EXPIRED': figures.expired += 1; return;
    case 'REVOKED': figures.revoked += 1; return;
    case 'USED':
      if (row.redeemedAs !== 'DISCOUNT') { figures.usedAsCredit += 1; return; }
      figures.usedAsDiscount += 1;
      figures.appliedDiscountSatang += row.appliedDiscountSatang ?? 0;
      // One bill once: `invoiceId` is unique on the ticket, so each bill reaches here at most once.
      figures.paidSatang += row.invoice?.paidSatang ?? 0;
      figures.refundedSatang += row.invoice?.refundedSatang ?? 0;
  }
}

const byThai = (a: string, b: string) => a.localeCompare(b, 'th');

/**
 * Groups by the event NAME (an event has no record of its own, spec §2), then batch, then เซลล์.
 * A batch the caller cannot resolve is left out rather than shown as a nameless row.
 */
export function aggregateEventReport(
  rows: readonly SalesEventReportTicketRow[],
  batches: ReadonlyMap<string, { eventName: string; batchName: string }>,
  agentName: (salesUserId: string) => string,
  now: Date,
): Pick<SalesEventReport, 'events' | 'totals'> {
  const totals = emptyEventReportFigures();
  const events = new Map<string, Map<string, { figures: SalesEventReportFigures; agents: Map<string, SalesEventReportFigures> }>>();
  for (const row of rows) {
    const batch = batches.get(row.batchId);
    if (!batch) continue;
    const eventBatches = events.get(batch.eventName) ?? new Map();
    events.set(batch.eventName, eventBatches);
    const entry = eventBatches.get(row.batchId) ?? { figures: emptyEventReportFigures(), agents: new Map() };
    eventBatches.set(row.batchId, entry);
    const agent = entry.agents.get(row.salesUserId) ?? emptyEventReportFigures();
    entry.agents.set(row.salesUserId, agent);
    for (const figures of [totals, entry.figures, agent]) count(figures, row, now);
  }
  const report: SalesEventReportEvent[] = [...events].map(([eventName, eventBatches]) => {
    const figures = emptyEventReportFigures();
    const batchList = [...eventBatches].map(([batchId, entry]) => {
      for (const key of Object.keys(figures) as (keyof SalesEventReportFigures)[]) figures[key] += entry.figures[key];
      return {
        batchId, batchName: batches.get(batchId)!.batchName, figures: entry.figures,
        agents: [...entry.agents].map(([salesUserId, agentFigures]) => ({ salesUserId, displayName: agentName(salesUserId), figures: agentFigures }))
          .sort((a, b) => byThai(a.displayName, b.displayName)),
      };
    }).sort((a, b) => byThai(a.batchName, b.batchName));
    return { eventName, figures, batches: batchList };
  }).sort((a, b) => byThai(a.eventName, b.eventName));
  return { events: report, totals };
}
