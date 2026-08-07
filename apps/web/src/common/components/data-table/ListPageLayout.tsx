'use client';
import type { ReactNode } from 'react';
import { CoverLoader } from '../state/CoverLoader';

interface ListPageLayoutProps {
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  pagination?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  className?: string;
}

export function ListPageLayout({
  header,
  toolbar,
  children,
  pagination,
  empty,
  loading,
  error,
  className,
}: ListPageLayoutProps) {
  return (
    <div className={className}>
      {header}
      {toolbar}
      <div className="mangmee-card relative overflow-hidden">
        {error ? (
          error
        ) : (
          <CoverLoader active={!!loading} scope="section">
            {!loading && empty ? empty : children}
            {pagination && <div className="border-t border-gray-200 px-4">{pagination}</div>}
          </CoverLoader>
        )}
      </div>
    </div>
  );
}
