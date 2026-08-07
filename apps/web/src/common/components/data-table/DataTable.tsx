'use client';

import type { ReactNode } from 'react';
import { CoverLoader } from '../state/CoverLoader';
import { EmptyState } from '../state/EmptyState';

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
};

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  emptyState?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading,
  emptyState,
}: DataTableProps<T>) {
  return (
    <CoverLoader active={!!loading} scope="table">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={`px-4 py-3 ${column.className ?? ''}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
            {rows.map((row) => (
              <tr key={getRowKey(row)} className="hover:bg-gray-50">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (emptyState ?? <EmptyState />)}
      </div>
    </CoverLoader>
  );
}
