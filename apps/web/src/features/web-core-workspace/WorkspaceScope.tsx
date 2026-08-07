'use client';
// 10D: header company switcher + branch filter (same-page scope dimension).
// Data comes from the cookie-session BFF (authedApiFetch); errors fall back silently to no selector.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import {
  fetchActiveBranches,
  fetchMyCompanies,
  fetchMyContext,
  type BranchOption,
  type MyCompany,
} from './workspace-scope.api';

// ---- Branch filter context ----

type BranchFilterValue = {
  /** '' = all branches in scope */
  branchId: string;
  setBranchId: (id: string) => void;
  /** branches the user may pick (already intersected with membership scope) */
  branches: BranchOption[];
  /** true when the user is locked to a single branch (selector hidden) */
  locked: boolean;
};

const BranchFilterContext = createContext<BranchFilterValue | null>(null);

export function useBranchFilter(): BranchFilterValue | null {
  return useContext(BranchFilterContext);
}

const storageKey = (companyId: string) => `watchdog.branchFilter.${companyId}`;

export function BranchFilterProvider({ companyId, children }: { companyId: string; children: React.ReactNode }) {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [locked, setLocked] = useState(false);
  const [branchId, setBranchIdState] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBranches([]);
    setLocked(false);
    setBranchIdState(typeof window !== 'undefined' ? (window.localStorage.getItem(storageKey(companyId)) ?? '') : '');
    (async () => {
      try {
        const [all, me] = await Promise.all([fetchActiveBranches(companyId), fetchMyContext(companyId)]);
        if (cancelled) return;
        const scopeIds = me.scopes?.branchIds;
        const visible = scopeIds ? all.filter((b) => scopeIds.includes(b.id)) : all;
        setBranches(visible);
        if (scopeIds && visible.length === 1) {
          // Branch-restricted to one branch: lock the filter to it.
          setLocked(true);
          setBranchIdState(visible[0]!.id);
        } else {
          // Drop a stale saved selection that is no longer visible.
          setBranchIdState((prev) => (prev && !visible.some((b) => b.id === prev) ? '' : prev));
        }
      } catch {
        // Not signed in / no branch.read permission — header simply shows no selector.
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const setBranchId = useCallback(
    (id: string) => {
      setBranchIdState(id);
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(companyId), id);
    },
    [companyId],
  );

  const value = useMemo(() => ({ branchId, setBranchId, branches, locked }), [branchId, setBranchId, branches, locked]);
  return <BranchFilterContext.Provider value={value}>{children}</BranchFilterContext.Provider>;
}

const branchLabel = (b: BranchOption) => `${b.name}${b.type === 'HEAD_OFFICE' ? ' (สำนักงานใหญ่)' : ''}`;

const BranchIcon = () => (
  <svg className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.75 10.25h14.5M6.25 10.25v8h11.5v-8M7.25 10.25V6.75h9.5v3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 18.25v-4.5h6v4.5M9.5 6.75V5.5h5v1.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function BranchSelector() {
  const filter = useBranchFilter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []));

  // Locked to one branch, or no scope data yet: show the same visual chip without opening a menu.
  if (!filter || filter.locked) {
    return (
      <span className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700">
        <BranchIcon />
        ทุกสาขา (รวม)
        <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </span>
    );
  }

  const current = filter.branches.find((b) => b.id === filter.branchId);
  const label = current ? branchLabel(current) : 'ทุกสาขา (รวม)';

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 hover:border-brand-200 sm:w-auto sm:max-w-[240px]"
        aria-label="เลือกสาขา"
      >
        <span className="shrink-0"><BranchIcon /></span>
        <span className="min-w-0 truncate">{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="fixed right-4 top-[var(--app-header-h)] z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:top-auto sm:right-auto sm:left-0">
          <button
            type="button"
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-25 ${
              filter.branchId === '' ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
            }`}
            onClick={() => { setOpen(false); filter.setBranchId(''); }}
          >
            ทุกสาขา (รวม){filter.branchId === '' ? ' ✓' : ''}
          </button>
          {filter.branches.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-25 ${
                b.id === filter.branchId ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
              }`}
              onClick={() => { setOpen(false); filter.setBranchId(b.id); }}
            >
              {branchLabel(b)}{b.id === filter.branchId ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Company switcher ----

export function CompanySwitcher({ companyId, fallbackName }: { companyId: string; fallbackName: string }) {
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []));

  useEffect(() => {
    let cancelled = false;
    fetchMyCompanies()
      .then((list) => { if (!cancelled) setCompanies(list); })
      .catch(() => { /* signed out / dev session: keep fallback label */ });
    return () => { cancelled = true; };
  }, []);

  const current = companies.find((c) => c.companyId === companyId);
  const label = current?.companyName ?? fallbackName;

  if (companies.length <= 1) {
    return <span className="block max-w-[44vw] truncate text-sm font-semibold text-gray-700 sm:max-w-[240px]">{label}</span>;
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full min-w-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-700 hover:border-brand-200 sm:w-auto sm:max-w-[240px]"
        aria-label="สลับบริษัท"
      >
        <span className="min-w-0 truncate">{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="fixed right-4 top-[var(--app-header-h)] z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:top-auto sm:right-auto sm:left-0">
          {companies.map((c) => (
            <button
              key={c.companyId}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-25 ${
                c.companyId === companyId ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
              }`}
              onClick={() => {
                setOpen(false);
                if (c.companyId !== companyId) window.location.assign(`/companies/${c.companyId}/dashboard`);
              }}
            >
              {c.companyName}
              {c.companyId === companyId ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
