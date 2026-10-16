'use client';

import { useEffect, useRef, type RefObject } from 'react';

let lastControl: HTMLElement | null = null;
const controls = 'button,a[href],input,textarea,select,summary,[tabindex]';

/** A temporarily disabled launcher can lose activeElement while its preview loads.
 * Remember pointer presses too: touch browsers do not always focus buttons. */
export function dialogOpener(active: HTMLElement | null, recent: HTMLElement | null): HTMLElement | null {
  if (recent?.isConnected) return recent;
  return active?.isConnected && active.tagName !== 'BODY' && active.tagName !== 'HTML' ? active : null;
}

export function restoreDialogFocus(opener: HTMLElement | null) {
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

export function useDialogFocus(open: boolean, dialogRef: RefObject<HTMLElement | null>) {
  const wasOpen = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  // Capture BEFORE React commits a child's autoFocus. An effect sees that child as
  // the previous focus and attempts to restore focus to a node it has just removed.
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    opener.current = dialogOpener(document.activeElement as HTMLElement | null, lastControl);
  }
  wasOpen.current = open;

  useEffect(() => {
    if (typeof document === 'undefined') return; // a render without a page (tests) has nothing to listen to
    const remember = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>(controls) : null;
      if (element) lastControl = element;
    };
    document.addEventListener('pointerdown', remember, true);
    document.addEventListener('focusin', remember, true);
    return () => {
      document.removeEventListener('pointerdown', remember, true);
      document.removeEventListener('focusin', remember, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const target = opener.current;
    dialogRef.current?.focus({ preventScroll: true });
    return () => restoreDialogFocus(target);
  }, [open, dialogRef]);
}
