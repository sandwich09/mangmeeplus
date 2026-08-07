import type { ReactNode } from 'react';

export interface ActionToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}

export function ActionToolbar({ search, filters, actions }: ActionToolbarProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
        {search}
        {filters}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
