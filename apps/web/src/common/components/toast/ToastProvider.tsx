'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { subscribeToastBus, type ToastEvent } from '@/common/feedback/toast-bus';
import { Toast } from './Toast';
import { readOverlayBounds } from '@/common/functions/overlay-geometry';
import { addToast, removeToast, toastDuration, visibleToasts, toastStackStyle } from './toast.logic';
import type { ToastItem } from './toast.model';
import { ToastContext, toastErrorMessage, type ToastContextValue } from './use-toast';

/** Phones keep feedback above the measured bottom action bar; wide screens keep it
 * below the top stack, centred on the shell content column. */
function useToastPlacement(showing: boolean) {
  const [style, setStyle] = useState<ReturnType<typeof toastStackStyle>>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!showing) return;
    const read = () => {
      const bar = document.querySelector('[data-app-top-bar]')?.getBoundingClientRect();
      const next = toastStackStyle(window.innerWidth, window.innerHeight, readOverlayBounds(), bar);
      setStyle(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    let frame = 0;
    const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(read); };
    read();
    const observer = new ResizeObserver(schedule);
    document.querySelectorAll('[data-app-top-bar], [data-form-action-bar], [data-modal-footer]').forEach(element => observer.observe(element));
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect(); window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [showing]);
  return style;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const itemsRef = useRef<ToastItem[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastNowRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    const next = removeToast(itemsRef.current, id);
    if (next === itemsRef.current) return;
    itemsRef.current = next;
    setItems(next);
  }, []);

  const show = useCallback((input: ToastEvent) => {
    const now = Math.max(Date.now(), lastNowRef.current + 1);
    lastNowRef.current = now;
    const current = itemsRef.current;
    const next = addToast(current, input, now);
    if (next === current) return;

    for (const item of current) {
      if (!next.some((candidate) => candidate.id === item.id)) {
        const timer = timersRef.current.get(item.id);
        if (timer) clearTimeout(timer);
        timersRef.current.delete(item.id);
      }
    }

    itemsRef.current = next;
    setItems(next);
    timersRef.current.set(now, setTimeout(() => dismiss(now), toastDuration(input.tone)));
  }, [dismiss]);

  useEffect(() => {
    const unsubscribe = subscribeToastBus(show);
    return () => {
      unsubscribe();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, [show]);

  const value = useMemo<ToastContextValue>(() => ({
    success: (message, action) => show({ tone: 'success', message, ...(action ? { action } : {}) }),
    warning: (message, action) => show({ tone: 'warning', message, ...(action ? { action } : {}) }),
    error: (input) => show({ tone: 'error', message: toastErrorMessage(input) }),
  }), [show]);

  const placement = useToastPlacement(items.length > 0);

  const stack = items.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div
          data-toast-stack
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100000] flex flex-col items-center gap-2 px-4"
          // Measured before paint, including the phone action bar.
          style={placement}
        >
          {visibleToasts(items).map((item) => <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
        </div>,
        document.body,
      )
    : null;

  return <ToastContext.Provider value={value}>{children}{stack}</ToastContext.Provider>;
}
