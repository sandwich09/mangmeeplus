'use client';
// 10D: header company switcher + branch filter (same-page scope dimension).
// Data comes from the cookie-session BFF (authedApiFetch); errors fall back silently to no selector.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { AlertModal } from '@/common/components/modal';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { roleKeyDisplayName } from '@/features/employee-access/role-picker.logic';
import { branchDisplayName, branchScopeLabel } from './branch-scope-label.logic';
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
  /**
   * A read was refused for the selected branch (spec R9). Resets to all branches, drops the saved
   * selection, refetches the scope, and raises the dialog — the reset is what makes the dialog
   * escapable when an admin revokes a branch mid-session.
   */
  reportBranchForbidden: () => void;
  /** WEB-04: the scope lookup failed. Non-blocking — the shell stays usable, the header offers a retry. */
  scopeFailed: boolean;
  /** Re-runs the scope lookup behind the retry affordance. */
  reloadScope: () => void;
};

const BranchFilterContext = createContext<BranchFilterValue | null>(null);

export function useBranchFilter(): BranchFilterValue | null {
  return useContext(BranchFilterContext);
}

const storageKey = (companyId: string) => `watchdog.branchFilter.${companyId}`;

export function BranchFilterProvider({
  companyId,
  onContextLoaded,
  children,
}: {
  companyId: string;
  onContextLoaded?: (context: Awaited<ReturnType<typeof fetchMyContext>>) => void;
  children: React.ReactNode;
}) {
  const locale = useWorkspaceLocale();
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [locked, setLocked] = useState(false);
  const [branchId, setBranchIdState] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [scopeFailed, setScopeFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBranches([]);
    setLocked(false);
    setScopeFailed(false);
    setBranchIdState(typeof window !== 'undefined' ? (window.localStorage.getItem(storageKey(companyId)) ?? '') : '');
    (async () => {
      try {
        const [all, me] = await Promise.all([fetchActiveBranches(companyId), fetchMyContext(companyId)]);
        if (cancelled) return;
        onContextLoaded?.(me);
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
      } catch (error) {
        // Not signed in / no branch.read permission — header simply shows no selector. Any other
        // failure used to be swallowed too, which read as "this company has no branches" (WEB-04).
        const status = (error as { status?: unknown })?.status;
        if (!cancelled && status !== 401 && status !== 403) setScopeFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, onContextLoaded, reloadToken]);

  const setBranchId = useCallback(
    (id: string) => {
      setBranchIdState(id);
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey(companyId), id);
    },
    [companyId],
  );

  const reportBranchForbidden = useCallback(() => {
    // Drop the saved selection before the refetch: the effect re-reads localStorage on every run.
    if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey(companyId));
    setBranchIdState('');
    setForbidden(true);
    setReloadToken((n) => n + 1);
  }, [companyId]);

  const reloadScope = useCallback(() => setReloadToken((n) => n + 1), []);

  const value = useMemo(
    () => ({ branchId, setBranchId, branches, locked, reportBranchForbidden, scopeFailed, reloadScope }),
    [branchId, setBranchId, branches, locked, reportBranchForbidden, scopeFailed, reloadScope],
  );
  return (
    <BranchFilterContext.Provider value={value}>
      {children}
      {/* One mount for the whole workspace (WorkspaceLayout.tsx), so every page is covered. */}
      <AlertModal
        open={forbidden}
        title={t('error.forbidden', locale)}
        message={t('branch.scope.forbidden_body', locale)}
        onClose={() => setForbidden(false)}
      />
    </BranchFilterContext.Provider>
  );
}

/** The one derived branch-scope label (spec R1) for any surface that shows one. */
export function useBranchScopeLabel(): string | null {
  const filter = useBranchFilter();
  const locale = useWorkspaceLocale();
  return branchScopeLabel(filter, locale);
}

const BranchIcon = () => (
  <svg className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.75 10.25h14.5M6.25 10.25v8h11.5v-8M7.25 10.25V6.75h9.5v3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 18.25v-4.5h6v4.5M9.5 6.75V5.5h5v1.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function BranchSelector() {
  const filter = useBranchFilter();
  const locale = useWorkspaceLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []));

  const label = branchScopeLabel(filter, locale);

  // WEB-04: a failed lookup is not "no branches". Say so and offer the retry, before spec R3's
  // silence — which only covers a resolved context with nothing to name.
  // `min-h-11`, not `h-11`: the header stacks the scope controls in a column below `sm`, and
  // `flex-1` there sets `flex-basis: 0%` on the block axis, which outranks a fixed `height` and
  // collapsed this button to its 20px line box. A minimum survives the flex base size.
  if (filter?.scopeFailed) {
    return (
      <button
        type="button"
        onClick={filter.reloadScope}
        aria-label={t('shell.scope.load_failed', locale)}
        title={t('shell.scope.load_failed', locale)}
        className="flex min-h-11 min-w-11 flex-1 items-center gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 text-sm font-semibold text-warning-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:flex-none"
      >
        <span className="shrink-0"><BranchIcon /></span>
        <span className="sm:hidden">{t('client_notice.retry', locale)}</span>
        <span className="hidden min-w-0 truncate sm:block">{t('shell.scope.load_failed', locale)}</span>
      </button>
    );
  }

  // Context unresolved, lookup failed, or no branch to name: render nothing (spec R3).
  if (!filter || !label) return null;

  // Restricted to one branch: name that branch, non-interactive. No chevron — nothing opens.
  if (filter.locked) {
    return (
      <span className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700">
        <BranchIcon />
        {label}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full min-w-11 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 hover:border-brand-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto sm:max-w-[240px]"
        aria-label="เลือกสาขา"
      >
        <span className="shrink-0"><BranchIcon /></span>
        <span className="min-w-0 break-words text-left text-xs sm:text-sm" title={label}>{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="fixed right-4 top-[var(--app-header-h)] z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--app-header-h)-1rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:top-auto sm:right-auto sm:left-0">
          <button
            type="button"
            className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm break-words hover:bg-brand-25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
              filter.branchId === '' ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
            }`}
            onClick={() => { setOpen(false); filter.setBranchId(''); }}
          >
            {t('branch.scope.all', locale)}{filter.branchId === '' ? ' ✓' : ''}
          </button>
          {filter.branches.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm break-words hover:bg-brand-25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                b.id === filter.branchId ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
              }`}
              onClick={() => { setOpen(false); filter.setBranchId(b.id); }}
            >
              {branchDisplayName(b, locale)}{b.id === filter.branchId ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Company switcher ----

export function CompanySwitcher({ companyId, fallbackName }: { companyId: string; fallbackName: string }) {
  const pathname = usePathname();
  const locale = useWorkspaceLocale();
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [settled, setSettled] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []));

  useEffect(() => {
    let cancelled = false;
    setSettled(false);
    fetchMyCompanies()
      .then((list) => { if (!cancelled) setCompanies(list); })
      .catch(() => { /* surfaced below as the retry affordance, no longer swallowed */ })
      .finally(() => { if (!cancelled) setSettled(true); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const current = companies.find((c) => c.companyId === companyId);
  const label = current?.companyName ?? fallbackName;

  // WEB-04: the lookup is over and the name is still unknown — failed request or a list that does
  // not contain this company. Offer the retry instead of leaving the loading label up forever.
  // `min-h-11` for the same reason as BranchSelector's retry: `flex-1` in the mobile column
  // makes a fixed `height` inert.
  if (settled && !current) {
    return (
      <button
        type="button"
        onClick={() => setReloadToken((n) => n + 1)}
        aria-label={t('shell.scope.load_failed', locale)}
        title={t('shell.scope.load_failed', locale)}
        className="block min-h-11 min-w-11 max-w-[44vw] flex-1 truncate rounded-lg px-1 text-sm font-semibold text-warning-700 underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:max-w-[240px] sm:flex-none"
      >
        <span className="sm:hidden">{t('client_notice.retry', locale)}</span>
        <span className="hidden sm:inline">{t('shell.scope.load_failed', locale)}</span>
      </button>
    );
  }

  if (companies.length <= 1) {
    // No company resolved yet: a pulsing placeholder, never a raw identifier.
    return (
      <span className={`block max-w-[44vw] truncate text-sm font-semibold text-gray-700 sm:max-w-[240px] ${current ? '' : 'animate-pulse text-gray-400'}`}>
        {label}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full min-w-11 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-700 hover:border-brand-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto sm:max-w-[240px]"
        aria-label="สลับบริษัท"
      >
        <span className="min-w-0 truncate">{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="fixed right-4 top-[var(--app-header-h)] z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--app-header-h)-1rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:top-auto sm:right-auto sm:left-0">
          {companies.map((c) => (
            <button
              key={c.companyId}
              className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm break-words hover:bg-brand-25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                c.companyId === companyId ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
              }`}
              onClick={() => {
                setOpen(false);
                // An expired shop routes to its renewal page — its business routes refuse anyway.
                if (c.expired) {
                  window.location.assign(`/companies/${c.companyId}/renew`);
                  return;
                }
                if (c.companyId !== companyId) {
                  const destination = /^\/companies\/[^/]+\/billing(?:\/|$)/.test(pathname) && c.canManagePlan ? 'billing' : 'dashboard';
                  window.location.assign(`/companies/${c.companyId}/${destination}`);
                }
              }}
            >
              {c.companyName}
              {c.roles.length > 0 ? (
                <span className="mt-0.5 block text-xs font-normal text-gray-400">
                  {c.roles.map(roleKeyDisplayName).join(' · ')}
                </span>
              ) : null}
              {c.expired ? (
                <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                  หมดอายุ
                </span>
              ) : null}
              {c.companyId === companyId ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
