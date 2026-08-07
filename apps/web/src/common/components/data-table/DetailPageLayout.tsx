'use client';
import type { ReactNode } from 'react';
import { CoverLoader } from '../state/CoverLoader';

interface DetailPageLayoutProps {
  header?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  related?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
}

export function DetailPageLayout({
  header,
  summary,
  children,
  related,
  actions,
  loading,
  error,
}: DetailPageLayoutProps) {
  return (
    <div>
      {header}
      {error ? (
        error
      ) : (
        <CoverLoader active={!!loading} scope="section">
          <div className="flex flex-col gap-6">
            {summary}
            {children}
            {related}
          </div>
        </CoverLoader>
      )}
      {actions}
    </div>
  );
}
