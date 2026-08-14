'use client';

import Link from 'next/link';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useEffect, useState } from 'react';
import { listPartners } from './system-partners.api';
import type { PartnerCompanySummaryDto, LineContextHealth } from './system-partners.api';

// -- status badge

type PartnerStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED';

const STATUS_LABEL: Record<PartnerStatus, string> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
  ARCHIVED: 'Archived',
  SUSPENDED: 'Suspended',
};

const STATUS_CLASS: Record<PartnerStatus, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  DISABLED: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  ARCHIVED: 'bg-gray-100 text-gray-500 border-gray-200',
  SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
};

function StatusBadge({ status }: { status: PartnerStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.ARCHIVED}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const LINE_HEALTH_CLASS: Record<LineContextHealth, string> = {
  LINKED: 'bg-green-50 text-green-700',
  UNLINKED: 'bg-gray-100 text-gray-500',
  NEEDS_COMPANY_SELECTION: 'bg-yellow-50 text-yellow-700',
  UNKNOWN: 'bg-gray-100 text-gray-400',
};

const LINE_HEALTH_LABEL: Record<LineContextHealth, string> = {
  LINKED: 'Linked',
  UNLINKED: 'Unlinked',
  NEEDS_COMPANY_SELECTION: 'Select Co.',
  UNKNOWN: 'Unknown',
};

function LineContextBadge({ health }: { health: LineContextHealth }) {
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-xs font-medium ${LINE_HEALTH_CLASS[health] ?? LINE_HEALTH_CLASS.UNKNOWN}`}>
      {LINE_HEALTH_LABEL[health] ?? health}
    </span>
  );
}

function formatDate(iso?: string): string {
  return formatThaiDate(iso);
}

// -- skeleton row
function SkeletonRow() {
  return (
    <tr>
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export default function PartnerListPage() {
  const [items, setItems] = useState<PartnerCompanySummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 20;

  const load = async (p: number, status: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listPartners({ page: p, pageSize, status: status || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) {
        setError('Access denied. You do not have permission to view the partner list.');
      } else {
        setError(apiErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(page, statusFilter);
  }, [page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* No BackLink: this is the /system section root. '/' redirects to /login, so a back link
            here would sign-post the admin straight out of the console. SystemHeader carries the
            cross-section nav instead. */}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Partner Companies</h1>
            <p className="text-sm text-gray-500 mt-0.5">Platform admin view — metadata only</p>
          </div>
          <Link
            href="/system/company-onboardings/new"
            className="mangmee-btn mangmee-btn-primary"
          >
            Onboard New Partner
          </Link>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <ThemedSelect
            className="mangmee-input max-w-56"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
            <option value="ARCHIVED">Archived</option>
          </ThemedSelect>
          <span className="text-sm text-gray-400">{total} partner{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => void load(page, statusFilter)}
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        {!error && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm text-left">
                <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name / Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Activated / Disabled</th>
                    <th className="px-4 py-3">Features</th>
                    <th className="px-4 py-3">AI Model</th>
                    <th className="px-4 py-3">LINE Health</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {loading ? (
                    [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                        No partners found.
                      </td>
                    </tr>
                  ) : (
                    items.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{p.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.status as PartnerStatus} />
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {p.activatedAt ? formatDate(p.activatedAt) : ''}
                          {p.disabledAt ? <span className="text-yellow-600"> / {formatDate(p.disabledAt)}</span> : ''}
                          {!p.activatedAt && !p.disabledAt ? '—' : ''}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{p.enabledFeatureKeys.length}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {p.configuredModelId ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <LineContextBadge health={p.lineContextHealth} />
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/system/partners/${p.id}`}
                            className="text-brand-700 hover:text-brand-800 text-xs font-medium"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && !loading && (
              <div className="flex flex-wrap items-center justify-between border-t border-gray-200 px-4 py-3">
                <span className="text-xs text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
