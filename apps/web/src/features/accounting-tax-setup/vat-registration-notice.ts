'use client';

import { useEffect, useState } from 'react';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

/**
 * Whether this company has *answered* that it is not VAT-registered.
 *
 * Only `NOT_REGISTERED` produces a notice. `UNKNOWN` means nobody has answered, and telling
 * someone the tax steps are unnecessary on the strength of an unanswered question would be a
 * guess — the same rule the expense capture policy follows.
 *
 * A caller without `company.vat_registration.read` gets a 403 and no notice, which is exactly
 * today's screen. The wizard never blocks on this; it is one sentence of context.
 */
export function useNotVatRegistered(companyId: string): boolean {
  const [notRegistered, setNotRegistered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ status: string }>(`/v1/companies/${companyId}/vat-registration`)
      .then((view) => { if (!cancelled) setNotRegistered(view.status === 'NOT_REGISTERED'); })
      .catch(() => { if (!cancelled) setNotRegistered(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  return notRegistered;
}
