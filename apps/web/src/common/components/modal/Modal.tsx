'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { useDialogFocus } from '@/common/hooks/use-dialog-focus';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';
import { useActionGroupLayout } from '../actions/use-action-group-layout';
import { ActionGroup } from '../actions/ActionGroup';
import { dangerButtonClass, secondaryButtonClass } from '../button/button-classes';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  /**
   * Pass the buttons themselves, the one that backs out first and the one that acts last
   * (`<>{close}{act}</>`). The footer then gives them one width and one order by itself: side by
   * side with the acting button at the right, or stacked with it on top when the names do not fit
   * (thai-ux-standard §2.3, §2.4). A footer whose child is the caller's own wrapper is left as it is.
   */
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bodyClassName?: string;
  bodyScroll?: boolean;
  /** False while the body holds something typed and not yet saved: a stray tap outside must not lose it. The close button and Escape still close. */
  closeOnBackdrop?: boolean;
  /**
   * True while the dialog holds something typed and not yet saved (thai-ux-standard §4.3). Then a
   * press on the backdrop does nothing, and ✕ or Escape first asks in place of the footer:
   * "ยังไม่ได้บันทึกสิ่งที่พิมพ์ไว้" with `พิมพ์ต่อ` · `ปิดโดยไม่บันทึก`. Only the second calls `onClose`.
   * Leave it out and the dialog closes as it always has.
   */
  dirty?: boolean;
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
  dirty = false,
  printSurface = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // `asking`: the person pressed ✕ or Escape with unsaved typing, and the footer shows the question.
  const [asking, setAsking] = useState(false);
  const askingNow = dirty && asking;
  const keepTypingRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const footerLayout = useActionGroupLayout(footerRef, { onlyButtons: true, active: open && Boolean(footer) && !askingNow });
  const footerGrouped = footerLayout === 'row' || footerLayout === 'stack';
  // Unique per instance: two modals can coexist (e.g. detail + full-screen preview siblings).
  const titleId = useId();
  useBodyScrollLock(open);
  useDialogFocus(open, dialogRef);

  // The print rules key off a body class because the overlay portals to <body>: hiding every
  // sibling of the surface is only expressible from the body level (see globals.css @media print).
  useEffect(() => {
    if (!open || !printSurface) return;
    document.body.classList.add('modal-print-active');
    return () => document.body.classList.remove('modal-print-active');
  }, [open, printSurface]);



  // The question goes away when there is nothing left to lose (saved, or the dialog closed).
  useEffect(() => {
    if (!open || !dirty) setAsking(false);
  }, [open, dirty]);

  // The safe button takes the focus: Enter keeps typing, never discards.
  useEffect(() => {
    if (asking) keepTypingRef.current?.focus();
  }, [asking]);

  // Portal to body: a `position: sticky` or transformed ancestor creates a stacking
  // context that would trap the backdrop below the app chrome regardless of z-index.
  if (!open || typeof document === 'undefined') return null;

  // ✕ and Escape: with unsaved typing they ask first; pressed again while asking they keep the typing.
  const requestClose = !dirty ? onClose : () => setAsking((already) => !already);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      requestClose();
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
    <div className={`fixed inset-0 z-[99999] flex items-end justify-center bg-gray-900/40 p-0 sm:items-center sm:p-4${printSurface ? ' modal-print-surface' : ''}`} onMouseDown={closeOnBackdrop && !dirty ? onClose : (event) => event.preventDefault() /* the focus stays in the dialog, so Escape still closes it */}>
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
            onClick={requestClose}
            aria-label={closeLabel}
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
          >
            <span aria-hidden className="text-lg leading-none">✕</span>
          </button>
        </div>
        {/* min-h-0 + overflow: on short viewports the body scrolls, header/footer stay reachable */}
        <div data-modal-body className={`min-h-0 flex-1 overscroll-contain ${bodyScroll ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'} ${bodyClassName ?? 'px-4 py-3 sm:px-5 sm:py-4'}`}>{children}</div>
        {askingNow && (
          <div data-modal-chrome data-modal-unsaved className="flex-shrink-0 border-t border-gray-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
            <p role="alert" className="mb-3 text-sm font-semibold text-gray-900">ยังไม่ได้บันทึกสิ่งที่พิมพ์ไว้</p>
            <ActionGroup>
              <button ref={keepTypingRef} type="button" className={secondaryButtonClass} onClick={() => setAsking(false)}>พิมพ์ต่อ</button>
              <button type="button" className={dangerButtonClass} onClick={() => { setAsking(false); onClose(); }}>ปิดโดยไม่บันทึก</button>
            </ActionGroup>
          </div>
        )}
        {footer && !askingNow && (
          // Plain buttons are grouped by the shared rule and clear the phone's home indicator here;
          // a caller's own wrapper keeps the old free row (and its own safe-area padding).
          <div data-modal-chrome className={`flex-shrink-0 border-t border-gray-200 px-4 py-3 sm:px-5 sm:py-4${footerGrouped ? ' pb-[calc(0.75rem+env(safe-area-inset-bottom))]' : ''}`}>
            <div
              ref={footerRef}
              data-modal-footer
              data-layout={footerGrouped ? footerLayout : undefined}
              className={footerGrouped ? 'mangmee-actions' : 'flex flex-wrap items-center justify-end gap-2'}
            >
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
