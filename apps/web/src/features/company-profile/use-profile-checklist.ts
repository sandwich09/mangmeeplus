'use client';

import { COMPANY_PROFILE_CHANGED_EVENT } from '../web-core-workspace/workspace-scope.api';
import { useEffect, useState } from 'react';
import { getAccountProfile, getCompanyIdentity } from './company-profile.api';
import {
  profileChecklist,
  clearChecklistCache,
  readChecklistCache,
  writeChecklistCache,
  type ChecklistItem,
} from './company-profile.logic';

/**
 * The one "what is still missing" read, shared by the three surfaces that show it (§15.4.1 E):
 * the dashboard card, the sidebar ตั้งค่าบริษัท dot and the settings-hub badge. One source, so the
 * three can never disagree, and one 10-minute `sessionStorage` answer cache between them.
 *
 * `null` means "no answer yet" — every caller renders nothing rather than guessing.
 *
 * Deliberately NOT here: the card's 7-day "ไว้ก่อน" dismissal. The Owner asked for an indicator
 * "จนกว่าจะตั้งครบ", so snoozing the card must not switch the dot off.
 */

/**
 * Two consumers mount on the settings page at once (sidebar + hub badge). Without this they would
 * each fire the same pair of GETs, because neither has written the cache yet when the other starts.
 */
const inFlight = new Map<string, Promise<ChecklistItem[]>>();

function loadChecklist(companyId: string, storage: Storage | undefined): Promise<ChecklistItem[]> {
  const existing = inFlight.get(companyId);
  if (existing) return existing;
  const request = Promise.all([getCompanyIdentity(companyId), getAccountProfile()])
    .then(([identity, account]) => {
      const items = profileChecklist({
        readiness: identity.readiness,
        emailVerified: account.emailVerified,
        hasPassword: account.hasPassword,
        emailDeliveryEnabled: account.emailDeliveryEnabled,
      });
      if (inFlight.get(companyId) === request) writeChecklistCache(storage, companyId, items);
      return items;
    })
    .finally(() => { if (inFlight.get(companyId) === request) inFlight.delete(companyId); });
  inFlight.set(companyId, request);
  return request;
}

export function useProfileChecklist(companyId: string, enabled = true): ChecklistItem[] | null {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const storage = typeof window === 'undefined' ? undefined : window.sessionStorage;

    const cached = readChecklistCache(storage, companyId);
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void loadChecklist(companyId, storage)
        .then(next => { if (!cancelled && current === revision) setItems(next); })
        .catch(() => { if (!cancelled && current === revision) setItems(null); });
    };
    if (cached) setItems(cached); else refresh();
    const changed = () => {
      clearChecklistCache(storage, companyId);
      inFlight.delete(companyId); // an older read must not put its pre-save answer back in the cache
      refresh();
    };
    window.addEventListener(COMPANY_PROFILE_CHANGED_EVENT, changed);
    return () => { cancelled = true; window.removeEventListener(COMPANY_PROFILE_CHANGED_EVENT, changed); };
  }, [companyId, enabled]);

  return items;
}
