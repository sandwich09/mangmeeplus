'use client';

import { useEffect, useRef } from 'react';
import { isDisbursementCommandInFlight } from './disbursement-vouchers.api';

export function useDisbursementVoucherRefresh(enabled: boolean, blocked: boolean, reload: (canApply?: () => boolean) => Promise<void>) {
  const lastRead = useRef(0);
  const reading = useRef(false);
  useEffect(() => {
    let active = true;
    // Portalled child dialogs and busy slip/payment controls also protect work in progress.
    const idle = () => active && enabled && !blocked && document.visibilityState === 'visible'
      && !isDisbursementCommandInFlight() && !document.querySelector('[role="dialog"], [aria-busy="true"]');
    const refresh = () => {
      if (!idle() || reading.current || Date.now() - lastRead.current < 5000) return;
      lastRead.current = Date.now(); reading.current = true;
      void reload(idle).catch(() => {}).finally(() => { reading.current = false; });
    };
    const reopen = (event: MouseEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = new URL(anchor.href, window.location.href);
      if (href.origin === window.location.origin && href.pathname === window.location.pathname) refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('click', reopen, true);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('click', reopen, true);
    };
  }, [enabled, blocked, reload]);
}
