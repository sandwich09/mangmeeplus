'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { subscribeToastBus, type ToastEvent } from '@/common/feedback/toast-bus';
import { Toast } from './Toast';
import { addToast, removeToast, toastDuration, visibleToasts } from './toast.logic';
import type { ToastItem } from './toast.model';
import { ToastContext, toastErrorMessage, type ToastContextValue } from './use-toast';

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
    success: (message) => show({ tone: 'success', message }),
    warning: (message) => show({ tone: 'warning', message }),
    error: (input) => show({ tone: 'error', message: toastErrorMessage(input) }),
  }), [show]);

  const stack = items.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100000] flex flex-col items-center gap-2 px-4">
          {visibleToasts(items).map((item) => <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
        </div>,
        document.body,
      )
    : null;

  return <ToastContext.Provider value={value}>{children}{stack}</ToastContext.Provider>;
}
