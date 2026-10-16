'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The action row of a form page (thai-ux-standard §3.3).
 *
 * It rests at the end of the form and stays in view at the bottom of the window while the form is taller than
 * the screen, across the whole content area. The buttons of a form never sit in a card beside the form
 * (owner 2026-10-13: "ยกเลิก บันทึกร่าง ทำไมไปลอยอยู่ข้างๆ").
 *
 * `summary`: what the person checks before pressing (a total, a line that says what is missing, an error);
 * it sits at the left from 640 px and above the buttons on a phone. `children`: one `ActionGroup`.
 * The look is `.mangmee-form-bar` in app/globals.css. Inside a `MangmeeCard` (a short settings form that is one
 * card) the same bar is the card's footer: it keeps the card's edges and does not stick to the window.
 */
export function FormActionBar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  // The pinned bar tells the page how tall it is, so whatever the page brings into view (a field reached by
  // the keyboard, a jump to what is missing) stops above the bar instead of under it, where a press lands on
  // the bar (the substitute wizard's "จ่ายครบ" tick, 2026-10-16). A bar inside a card is not pinned: 0.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--mangmee-form-bar-height', getComputedStyle(element).position === 'sticky' ? `${element.offsetHeight}px` : '0px');
    const watch = new ResizeObserver(sync);
    watch.observe(element);
    sync();
    return () => { watch.disconnect(); root.style.removeProperty('--mangmee-form-bar-height'); };
  }, []);
  return (
    <div ref={bar} data-form-action-bar="" className="mangmee-form-bar mangmee-safe-bottom">
      {summary ? <div className="mangmee-form-bar-summary">{summary}</div> : null}
      <div className="mangmee-form-bar-actions">{children}</div>
    </div>
  );
}
