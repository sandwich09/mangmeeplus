'use client';

import React from 'react';

export type CoverLoaderScope = 'page' | 'section' | 'table' | 'form' | 'modal' | 'workspace';

export interface CoverLoaderProps {
  active: boolean;
  scope?: CoverLoaderScope;
  label?: string;
  children?: React.ReactNode;
}

// ponytail: scope→class map, no abstraction needed beyond this
const scopeClass: Record<CoverLoaderScope, string> = {
  workspace: 'fixed inset-0 z-[9999]',
  page: 'absolute inset-0 z-10',
  section: 'absolute inset-0 z-10',
  table: 'absolute inset-0 z-10',
  form: 'absolute inset-0 z-10',
  modal: 'absolute inset-0 rounded-lg z-10',
};

function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col items-center justify-center gap-3">
      <span className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-brand-600 animate-spin" />
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  );
}

export function CoverLoader({ active, scope = 'section', label, children }: CoverLoaderProps) {
  if (!active) return <>{children}</>;

  const overlay = (
    <div className={`${scopeClass[scope]} bg-white/80 flex items-center justify-center`}>
      <Spinner label={label} />
    </div>
  );

  if (!children) return overlay;

  return (
    <div className="relative">
      {children}
      {overlay}
    </div>
  );
}
