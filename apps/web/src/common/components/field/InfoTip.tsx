'use client';

import { useCallback, useId, useRef, useState, type JSX } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { PopoverPanel } from './PopoverPanel';

export function InfoTip({ label, text }: { label: string; text: string }): JSX.Element {
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  const pointerClickOpen = useRef(false);
  const [open, setOpen] = useState(false);

  useCloseOnOutsideClick(rootRef, useCallback(() => setOpen(false), []), panelRef);

  return (
    <span ref={rootRef} className="inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={panelId}
        aria-expanded={open}
        onPointerDown={() => {
          pointerDown.current = true;
          pointerClickOpen.current = !open;
        }}
        onPointerCancel={() => { pointerDown.current = false; }}
        onClick={() => {
          if (pointerDown.current) setOpen(pointerClickOpen.current);
          else setOpen((current) => !current);
          pointerDown.current = false;
        }}
        onFocus={() => { if (!pointerDown.current) setOpen(true); }}
        onBlur={() => {
          pointerDown.current = false;
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        // The visible dot stays 20px and keeps its border on every screen; the button around
        // it carries the 44px touch target on a phone, and the negative margin keeps that from
        // pushing the label line apart. Same shape as the Toggle in ExpensesWorkspacePanels.
        className="group -m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none focus:ring-2 focus:ring-brand-300 sm:m-0 sm:h-5 sm:w-5"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-xs text-gray-500 transition group-hover:border-brand-300 group-hover:text-brand-700">
          ⓘ
        </span>
      </button>
      <PopoverPanel
        open={open}
        anchorRef={buttonRef}
        panelRef={panelRef}
        height={160}
        id={panelId}
        role="tooltip"
        className="z-[100000] max-w-xs rounded-xl border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-600 shadow-lg"
      >
        {text}
      </PopoverPanel>
    </span>
  );
}
