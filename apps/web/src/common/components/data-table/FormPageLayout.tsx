'use client';
import type { ReactNode } from 'react';
import { CoverLoader } from '../state/CoverLoader';

interface FormPageLayoutProps {
  header?: ReactNode;
  children: ReactNode;
  validationSummary?: ReactNode;
  actions: ReactNode;
  loading?: boolean;
}

export function FormPageLayout({
  header,
  children,
  validationSummary,
  actions,
  loading,
}: FormPageLayoutProps) {
  return (
    <div>
      {header}
      {validationSummary}
      <CoverLoader active={!!loading} scope="form">
        <div className="flex flex-col gap-6">
          {children}
          <div className="flex items-center gap-3">
            {actions}
          </div>
        </div>
      </CoverLoader>
    </div>
  );
}
