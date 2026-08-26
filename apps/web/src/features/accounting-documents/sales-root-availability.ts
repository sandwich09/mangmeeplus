import { useCallback, useEffect, useState } from 'react';
import { getSalesDocumentRootAvailability } from './accounting-documents.api';

export type SalesRootAvailabilityState = 'NOT_NEEDED' | 'LOADING' | 'OPEN' | 'CLOSED' | 'ERROR';

export function useSalesRootAvailability(companyId: string, enabled: boolean) {
  const [resolved, setResolved] = useState<{ companyId: string; state: SalesRootAvailabilityState }>({
    companyId,
    state: enabled ? 'LOADING' : 'NOT_NEEDED',
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    if (!enabled) {
      setResolved({ companyId, state: 'NOT_NEEDED' });
      return () => { current = false; };
    }
    setResolved({ companyId, state: 'LOADING' });
    void getSalesDocumentRootAvailability(companyId)
      .then((result) => { if (current) setResolved({ companyId, state: result.canCreateSalesRoot ? 'OPEN' : 'CLOSED' }); })
      .catch(() => { if (current) setResolved({ companyId, state: 'ERROR' }); });
    return () => { current = false; };
  }, [companyId, enabled, reloadKey]);

  const retry = useCallback(() => {
    setResolved({ companyId, state: 'LOADING' });
    setReloadKey((value) => value + 1);
  }, [companyId]);
  const state: SalesRootAvailabilityState = !enabled
    ? 'NOT_NEEDED'
    : resolved.companyId === companyId
      ? resolved.state
      : 'LOADING';
  return { state, retry };
}
