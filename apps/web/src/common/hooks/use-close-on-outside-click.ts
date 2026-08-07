'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Dismisses a popup when the pointer goes down outside `ref`, or on Escape.
 *
 * Uses `pointerdown` rather than `click` so the menu is already gone before the
 * click lands: pressing another trigger opens that menu instead of having the
 * press swallowed by the one still on screen. The trigger itself must sit
 * inside `ref`, so its own click keeps toggling the menu shut as usual.
 *
 * `extraRef` counts a second subtree as inside. A panel rendered through a
 * portal is outside `ref` in the DOM but part of the same popup, and without
 * this the pointerdown would close it before its own click could land.
 */
export function useCloseOnOutsideClick(ref: RefObject<HTMLElement | null>, close: () => void, extraRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || extraRef?.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, ref]);
}
