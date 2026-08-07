'use client';

import { useEffect, useState } from 'react';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

/**
 * `LOADING` is a real third state, not a placeholder for FULL. Defaulting to FULL while the
 * answer is in flight would flash the Tax Code card at exactly the users this exists to spare;
 * defaulting to SIMPLE would flash a missing field at a VAT-registered company. Rendering nothing
 * until the answer arrives is the only option that is never wrong.
 */
export type ExpenseCaptureMode = 'FULL' | 'SIMPLE' | 'LOADING';

export type ExpenseCapturePolicy = {
  mode: ExpenseCaptureMode;
  vatStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN' | 'HIDDEN';
  canAnswerVatStatus: boolean;
  /** Whether this user may run the tax setup wizard the Tax Code empty state links to. */
  canConfigureTax: boolean;
};

/**
 * Whether this screen asks Thai VAT questions, for one document date.
 *
 * `on` is the DOCUMENT's date. A company that registered mid-year must not be offered input VAT
 * on a document dated before it registered, so a manual form re-asks when its date changes.
 *
 * A failed read answers FULL: a degraded policy must never hide a field a VAT-registered company
 * needs, and it must not raise an error banner over a question the user did not ask.
 */
export function useExpenseCapturePolicy(companyId: string, on?: string): ExpenseCapturePolicy {
  const [policy, setPolicy] = useState<ExpenseCapturePolicy>({
    mode: 'LOADING', vatStatus: 'HIDDEN', canAnswerVatStatus: false, canConfigureTax: false,
  });

  useEffect(() => {
    let cancelled = false;
    apiFetch<ExpenseCapturePolicy>(`/v1/companies/${companyId}/expenses/capture-policy${on ? `?on=${encodeURIComponent(on)}` : ''}`)
      .then((next) => { if (!cancelled) setPolicy(next); })
      .catch(() => { if (!cancelled) setPolicy({ mode: 'FULL', vatStatus: 'HIDDEN', canAnswerVatStatus: false, canConfigureTax: false }); });
    return () => { cancelled = true; };
  }, [companyId, on]);

  return policy;
}

/**
 * Spec §7.5. Hiding is presentation, never deletion: an expense that already carries VAT or a Tax
 * Code shows its tax fields even inside a SIMPLE workspace, or the person responsible for it could
 * no longer see what is recorded.
 */
export function hasRecordedTax(lines: Array<{ vatAmount?: string | null; taxCodeDefinitionId?: string | null; externalTaxCode?: string | null }>): boolean {
  return lines.some((line) => Number(line.vatAmount ?? '0') !== 0
    || Boolean(line.taxCodeDefinitionId)
    || Boolean(line.externalTaxCode));
}

/** Show tax capture when the policy says so, or when the document already has tax recorded. */
export function showsTaxCapture(mode: ExpenseCaptureMode, recordedTax = false): boolean {
  return mode === 'FULL' || (recordedTax && mode !== 'LOADING');
}
