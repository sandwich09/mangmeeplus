'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bodyClassName?: string;
  bodyScroll?: boolean;
  /** False while the body holds something typed and not yet saved: a stray tap outside must not lose it. The close button and Escape still close. */
  closeOnBackdrop?: boolean;
  /** Document-preview modals: Ctrl+P prints ONLY this modal's body, once. Without it the fixed
   *  overlay is repeated by the browser on every printed page (the "same form twice in one
   *  printout" bug) with the app page showing through behind it. */
  printSurface?: boolean;
}

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-[min(1180px,96vw)]',
};

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  closeLabel = 'ปิด',
  size = 'md',
  bodyClassName,
  bodyScroll = true,
  closeOnBackdrop = true,
  printSurface = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Unique per instance: two modals can coexist (e.g. detail + full-screen preview siblings).
  const titleId = useId();
  useBodyScrollLock(open);

  // The print rules key off a body class because the overlay portals to <body>: hiding every
  // sibling of the surface is only expressible from the body level (see globals.css @media print).
  useEffect(() => {
    if (!open || !printSurface) return;
    document.body.classList.add('modal-print-active');
    return () => document.body.classList.remove('modal-print-active');
  }, [open, printSurface]);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    return () => previousActiveElement?.focus();
  }, [open]);

  // Portal to body: a `position: sticky` or transformed ancestor creates a stacking
  // context that would trap the backdrop below the app chrome regardless of z-index.
  if (!open || typeof document === 'undefined') return null;

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`fixed inset-0 z-[99999] flex items-end justify-center bg-gray-900/40 p-0 sm:items-center sm:p-4${printSurface ? ' modal-print-surface' : ''}`} onMouseDown={closeOnBackdrop ? onClose : (event) => event.preventDefault() /* the focus stays in the dialog, so Escape still closes it */}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
        data-modal-panel
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col ${sizeClass[size]} rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-lg`}
      >
        <div data-modal-chrome className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-5 sm:py-4">
          {/* div, not h2: title accepts rich ReactNode (block elements are invalid inside a heading) */}
          <div id={titleId} className="min-w-0 flex-1 text-base font-semibold text-gray-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
          >
            <span aria-hidden className="text-lg leading-none">✕</span>
          </button>
        </div>
        {/* min-h-0 + overflow: on short viewports the body scrolls, header/footer stay reachable */}
        <div data-modal-body className={`min-h-0 flex-1 overscroll-contain ${bodyScroll ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'} ${bodyClassName ?? 'px-4 py-3 sm:px-5 sm:py-4'}`}>{children}</div>
        {footer && <div data-modal-chrome className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 gap-y-2 border-t border-gray-200 px-4 py-3 sm:px-5 sm:py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
