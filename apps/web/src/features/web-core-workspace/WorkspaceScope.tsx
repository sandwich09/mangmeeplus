'use client';
// 10D: header company switcher + branch filter (same-page scope dimension).
// Data comes from the cookie-session BFF (authedApiFetch); errors fall back silently to no selector.
import { requestInAppNavigation } from '@/common/components/unsaved-navigation/request-navigation';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { planTermStateLabel } from '@watchdog-bms/contracts';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { AlertModal } from '@/common/components/modal';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { roleDisplayName } from '@/features/employee-access/role-picker.logic';
import { branchDisplayName, branchScopeLabel, branchStorageKeys } from './branch-scope-label.logic';
import { companySwitcherTarget } from './web-core-workspace.logic';
import {
  COMPANY_PROFILE_CHANGED_EVENT,
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
  /**
   * The branch this person last chose on this device ('' = none yet). A new record offers it first while the filter
   * says "all branches", so the branch is not asked again on every visit. Kept in browser storage per shop and person.
   */
  lastChosenBranchId: string;
};

const BranchFilterContext = createContext<BranchFilterValue | null>(null);

export function useBranchFilter(): BranchFilterValue | null {
  return useContext(BranchFilterContext);
}


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
  const [userId, setUserId] = useState('');
  const [lastChosenBranchId, setLastChosenBranchId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBranches([]);
    setLocked(false);
    setScopeFailed(false);
    setBranchIdState('');
    setUserId('');
    setLastChosenBranchId('');
    (async () => {
      try {
        const [all, me] = await Promise.all([fetchActiveBranches(companyId), fetchMyContext(companyId)]);
        if (cancelled) return;
        onContextLoaded?.(me);
        const scopeIds = me.scopes?.branchIds;
        const visible = scopeIds ? all.filter((b) => scopeIds.includes(b.id)) : all;
        setBranches(visible);
        setUserId(me.userId);
        // A remembered branch the person can no longer use is not offered.
        const keys = branchStorageKeys(companyId, me.userId);
        const remembered = window.localStorage.getItem(keys.lastChosen) ?? '';
        const selected = window.localStorage.getItem(keys.filter) ?? '';
        setLastChosenBranchId(visible.some((b) => b.id === remembered) ? remembered : '');
        if (scopeIds && visible.length === 1) {
          // Branch-restricted to one branch: lock the filter to it.
          setLocked(true);
          setBranchIdState(visible[0]!.id);
        } else {
          // Drop a stale saved selection that is no longer visible.
          setBranchIdState(visible.some((b) => b.id === selected) ? selected : '');
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
      if (typeof window === 'undefined' || !userId) return;
      const keys = branchStorageKeys(companyId, userId);
      window.localStorage.setItem(keys.filter, id);
      // A real branch (not "all") is also remembered as this person's last choice, for the next new record.
      if (id && userId) {
        setLastChosenBranchId(id);
        window.localStorage.setItem(keys.lastChosen, id);
      }
    },
    [companyId, userId],
  );

  const reportBranchForbidden = useCallback(() => {
    // Drop the saved selection before the refetch: the effect re-reads localStorage on every run.
    if (typeof window !== 'undefined' && userId) window.localStorage.removeItem(branchStorageKeys(companyId, userId).filter);
    setBranchIdState('');
    setForbidden(true);
    setReloadToken((n) => n + 1);
  }, [companyId, userId]);

  const reloadScope = useCallback(() => setReloadToken((n) => n + 1), []);

  // A shop with one branch draws no picker (BranchSelector), so nothing on screen could turn a saved or deep-linked
  // branch filter back to "all": its scope is always all branches.
  const scopedBranchId = !locked && branches.length === 1 ? '' : branchId;
  const value = useMemo(
    () => ({ branchId: scopedBranchId, setBranchId, branches, locked, reportBranchForbidden, scopeFailed, reloadScope, lastChosenBranchId }),
    [scopedBranchId, setBranchId, branches, locked, reportBranchForbidden, scopeFailed, reloadScope, lastChosenBranchId],
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
        data-scope-retry=""
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

  // A shop with one branch has nothing to choose: "all branches" and its one branch show the same data, so the
  // picker is not drawn (the scope stays "all", exactly as before). A person restricted to one branch keeps the label below.
  if (!filter.locked && filter.branches.length <= 1) return null;

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
    <div ref={rootRef} className="relative min-w-0 max-w-full flex-1 sm:flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full min-w-0 max-w-full overflow-hidden items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 hover:border-brand-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto sm:max-w-[360px]"
        aria-label="เลือกสาขา"
      >
        {/* No picture on a phone: its 24 px are what keeps "Room45 Eyes Lashes · สยาม" whole (the end of a branch
            name is the part that tells two branches apart, and an ellipsis ate it). */}
        <span className="shrink-0 max-sm:hidden"><BranchIcon /></span>
        <span className="min-w-0 flex-1 truncate text-left text-sm" title={label}>{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        // A phone: a sheet across the screen right under the top bar (it used to hang from the right edge, away from its
        // button). From 640 px: under the button.
        <div className="fixed inset-x-4 top-[var(--app-header-h)] z-50 mt-2 max-h-[calc(100dvh-var(--app-header-h)-1rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 sm:w-64">
          {/* What the choice does, said once: it filters what the pages show. */}
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-gray-500">แสดงข้อมูลของ</p>
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

export function CompanySwitcher({ companyId, fallbackName, currentFreeExpenseDrafts = false }: { companyId: string; fallbackName: string; currentFreeExpenseDrafts?: boolean }) {
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

  useEffect(() => {
    const refresh = () => setReloadToken((value) => value + 1);
    window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(COMPANY_PROFILE_CHANGED_EVENT, refresh);
  }, []);

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
        data-scope-retry=""
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
      // A phone: a small caption over the branch picker (one 68 px top bar), the full line when it stands alone.
      <span className={`block max-w-full truncate text-sm font-semibold text-gray-700 max-sm:[&:not(:only-child)]:text-xs max-sm:[&:not(:only-child)]:leading-4 sm:max-w-[240px] ${current ? '' : 'animate-pulse text-gray-400'}`}>
        {label}
      </span>
    );
  }

  return (
    <div ref={rootRef} data-company-switch="" className="relative min-w-0 max-w-full flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full min-w-0 max-w-full overflow-hidden items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-700 hover:border-brand-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:w-auto sm:max-w-[240px]"
        aria-label="เปลี่ยนร้าน"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-x-4 top-[var(--app-header-h)] z-50 mt-2 max-h-[calc(100dvh-var(--app-header-h)-1rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-[var(--shadow-theme-md)] sm:absolute sm:inset-x-auto sm:top-auto sm:left-0 sm:w-72">
          {companies.map((c) => (
            <button
              key={c.companyId}
              className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm break-words hover:bg-brand-25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                c.companyId === companyId ? 'font-semibold text-brand-700' : 'font-medium text-gray-700'
              }`}
              onClick={() => {
                setOpen(false);
                const target = companySwitcherTarget({ companyId: c.companyId, currentCompanyId: companyId, currentFreeExpenseDrafts, freeExpenseDrafts: c.freeExpenseDrafts, expired: c.expired, canManagePlan: c.canManagePlan, currentPath: pathname ?? '' });
                if (target) requestInAppNavigation(() => window.location.assign(target));
              }}
            >
              {c.companyName}
              {c.roles.length > 0 ? (
                <span className="mt-0.5 block text-xs font-normal text-gray-400">
                  {c.roles.map((key) => roleDisplayName(c.roleNames?.[key] ? { key, name: c.roleNames[key], isSystem: false } : key)).join(' · ')}
                </span>
              ) : null}
              {c.expired ? (
                <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                  {planTermStateLabel(c.planState === 'NO_PACKAGE' ? 'NO_PACKAGE' : 'EXPIRED')}
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
