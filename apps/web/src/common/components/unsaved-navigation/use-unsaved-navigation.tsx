'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../modal';
import { primaryButtonClass, secondaryButtonClass } from '../button/button-classes';
import { CoverLoader } from '../state';
import { t } from '@/common/i18n/workspace-i18n.logic';
import styles from './unsaved-navigation.module.css';
import { UNSAVED_NAVIGATION_EVENT } from './request-navigation';

type Options = { title?: string; description?: string; dirty: boolean; canSave: boolean; saving: boolean; error: string | null; onSave: () => Promise<boolean> };

/** Guards ordinary same-tab links, Back, and closing the tab. Programmatic callers use requestNavigation. */
export function useUnsavedNavigation(options: Options) {
  const router = useRouter();
  const latest = useRef(options);
  latest.current = options;
  const allowed = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const allowNavigation = () => { allowed.current = true; };
  const requestNavigation = (navigate: () => void) => {
    if (!latest.current.dirty || allowed.current) navigate();
    else { pending.current = navigate; setOpen(true); }
  };

  useEffect(() => {
    if (!options.dirty) return;
    allowed.current = false;
    const click = (event: MouseEvent) => {
      if (allowed.current || !latest.current.dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const href = new URL(anchor.href, window.location.href);
      if (href.origin !== window.location.origin || href.pathname === window.location.pathname && href.search === window.location.search) return;
      event.preventDefault(); event.stopImmediatePropagation();
      requestNavigation(() => router.push(href.pathname + href.search + href.hash));
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (allowed.current || !latest.current.dirty) return;
      event.preventDefault(); event.returnValue = '';
    };
    // A same-URL history entry lets Back be refused before Next changes the displayed page.
    // Keep Next's state intact; this is history only, never a route reload.
    const originalState = window.history.state;
    if (originalState?.unsavedNavigation !== window.location.href) {
      window.history.pushState({ ...originalState, unsavedNavigation: window.location.href }, '', window.location.href);
    }
    let restoring = false;
    const back = (event: PopStateEvent) => {
      if (allowed.current || !latest.current.dirty) return;
      event.stopImmediatePropagation();
      if (restoring) { restoring = false; return; }
      restoring = true;
      window.history.forward();
      requestNavigation(() => window.history.go(-2));
    };
    const directNavigation = (event: Event) => {
      if (allowed.current || !latest.current.dirty) return;
      event.preventDefault(); requestNavigation((event as CustomEvent<() => void>).detail);
    };
    window.addEventListener(UNSAVED_NAVIGATION_EVENT, directNavigation);
    document.addEventListener('click', click, true);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', back, true);
    return () => {
      window.removeEventListener(UNSAVED_NAVIGATION_EVENT, directNavigation);
      document.removeEventListener('click', click, true);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('popstate', back, true);
    };
    // Handlers read current values from latest; typing must not add history entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.dirty, router]);

  const finishLeave = () => {
    allowNavigation(); setOpen(false);
    const navigate = pending.current; pending.current = null; navigate?.();
  };
  const saveAndLeave = async () => {
    if (!latest.current.canSave || latest.current.saving) return;
    if (await latest.current.onSave()) finishLeave();
  };
  const stay = () => { if (!options.saving) { pending.current = null; setOpen(false); } };
  const dialog = (
    <Modal open={open} title={options.title ?? t('common.unsaved.title', 'th')} onClose={stay} closeOnBackdrop={false}
      closeLabel={t('common.unsaved.stay', 'th')} size="sm"
      // Plain buttons, back-out first: the Modal footer gives them one width, puts the acting one on top
      // when they stack, and clears the phone's home indicator (env(safe-area-inset-bottom)).
      footer={<>
        <button type="button" className={secondaryButtonClass} disabled={options.saving} onClick={stay}>{t('common.unsaved.stay', 'th')}</button>
        <button type="button" className={secondaryButtonClass} disabled={options.saving} onClick={() => { if (!latest.current.saving) finishLeave(); }}>{t('common.unsaved.discard', 'th')}</button>
        {options.canSave && <button type="button" className={primaryButtonClass} disabled={options.saving} onClick={() => void saveAndLeave()}>{t('common.unsaved.save_leave', 'th')}</button>}
      </>}>
      <CoverLoader active={options.saving} scope="modal" label={t('common.loading', 'th')}>
        <p>{options.description ?? t('common.unsaved.description', 'th')}</p>
        {options.error && <p role="alert" className={styles.error}>{options.error}</p>}
      </CoverLoader>
    </Modal>
  );
  return { allowNavigation, requestNavigation, dialog };
}
