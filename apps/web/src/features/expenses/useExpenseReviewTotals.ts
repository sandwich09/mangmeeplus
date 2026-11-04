import { useEffect, useState } from 'react';
import type { ExpenseDraftTotalsPreview, ExpenseVatMode } from '@watchdog-bms/contracts';
import { previewExpenseDraftTotals } from './expenses.api';
import { buildExpenseDraftReviewPayload, allowsDomesticInputTaxCode, clearExpenseTaxSelections, type ExpenseDetail, type ExpenseDraftReviewValues } from './expenses.model';
import { err } from './ExpensesUi';

export type ExpenseReviewTotalsState = {
  revision: string;
  status: 'loading' | 'ready' | 'error';
  vatMode: ExpenseVatMode;
  withholdingIncomplete?: boolean;
  totals?: ExpenseDraftTotalsPreview;
  message?: string;
  /** Local validation needs a field edit, never a retry of the same request. */
  blocked?: boolean;
};

/** Preview uses ERP's save calculator. Cancelled/older responses cannot replace newer edits. */
export function useExpenseReviewTotals(companyId: string, detail: ExpenseDetail, values: ExpenseDraftReviewValues,
  enabled: boolean, blockingMessage: string | null, retry: number,
  onChange?: (state: ExpenseReviewTotalsState | null) => void, withholdingIncomplete = false) {
  const [state, setState] = useState<ExpenseReviewTotalsState | null>(null);
  const disallowsTaxCode = !allowsDomesticInputTaxCode(detail.sourceDocumentType, detail.taxEvidenceStatus);
  // The two PATCH routes take the contract type, which the global ValidationPipe skips; this POST
  // takes `ExpenseTotalsPreviewDto`, which it validates with `forbidNonWhitelisted`. Neither the
  // seller address, branch code nor certificate classification moves a single satang, so they are
  // dropped here rather than widening a money DTO to carry fields it would never read.
  const { vendorAddressSnapshot: _address, vendorBranchCodeSnapshot: _branch,
    whtCategoryCode: _whtCategory, whtRate: _whtRate, whtRemittance: _whtRemittance, ...reviewPayload } =
    buildExpenseDraftReviewPayload(disallowsTaxCode ? { ...values, lines: clearExpenseTaxSelections(values.lines) } : values,
      { sourceDraft: detail.sourceDraft, originalLines: detail.lines });
  const payload = JSON.stringify({ expectedUpdatedAt: detail.updatedAt,
    ...reviewPayload });
  useEffect(() => {
    if (!enabled) { setState(null); onChange?.(null); return; }
    const controller = new AbortController();
    let active = true;
    const publish = (next: ExpenseReviewTotalsState) => { if (active) { setState(next); onChange?.(next); } };
    const common = { revision: `${detail.id}:${detail.updatedAt}`, vatMode: values.vatMode, withholdingIncomplete };
    publish({ ...common, status: blockingMessage ? 'error' : 'loading', blocked: Boolean(blockingMessage), ...(blockingMessage && { message: blockingMessage }) });
    const timer = blockingMessage ? undefined : window.setTimeout(() => {
      void previewExpenseDraftTotals(companyId, detail.id, JSON.parse(payload), controller.signal)
        .then((totals) => publish({ ...common, status: 'ready', totals }))
        .catch((error) => publish({ ...common, status: 'error', message: err(error) }));
    }, 300);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [companyId, detail.id, detail.updatedAt, values.vatMode, enabled, blockingMessage, payload, retry, onChange, withholdingIncomplete]);
  return state;
}
