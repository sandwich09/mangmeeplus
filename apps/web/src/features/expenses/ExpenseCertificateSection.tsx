'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '@/common/i18n/workspace-i18n.logic';

export function ExpenseCertificateSection({ children }: { children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash !== '#wht-certificate' && new URLSearchParams(window.location.search).get('section') !== 'wht-certificate') return;
    const frame = window.requestAnimationFrame(() => {
      section.current?.scrollIntoView({ block: 'start' });
      section.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <section id="wht-certificate" ref={section} tabIndex={-1} className="w-full scroll-mt-24 space-y-2 rounded-xl border border-gray-200 p-3 outline-none">
    <h3 className="text-sm font-semibold">{t('expenses.disbursement.certificate_section', 'th')}</h3>
    {children}
  </section>;
}
