'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { decideActionLayout, type ActionLayout } from './action-group.logic';

/** `custom`: the children are not plain buttons (a caller's own wrapper), so the group is left as the caller laid it out. */
export type MeasuredActionLayout = ActionLayout | 'custom';

const BUTTONS = 'button, a, [role="button"]';
const WIDE = '(min-width: 40rem)';
const MIN_COLUMN_WIDE = 128; // 8rem, the same floor as `.mangmee-actions` in globals.css

/**
 * Measures a group of buttons and answers how to lay it out (see `decideActionLayout`).
 * Before the first measurement (server render, tests) it answers `undefined` and the CSS default applies.
 * `onlyButtons`: answer `custom` unless every direct child is a button or a link (the dialog footer uses this).
 * `active`: false while the group is not on the page (a closed dialog).
 */
export function useActionGroupLayout(ref: RefObject<HTMLElement | null>, { onlyButtons = false, active = true }: { onlyButtons?: boolean; active?: boolean } = {}): MeasuredActionLayout | undefined {
  const [layout, setLayout] = useState<MeasuredActionLayout>();
  const seen = useRef<{ group: HTMLElement | null; names: string }>({ group: null, names: '' });

  const measure = () => {
    const group = ref.current;
    if (!group) return;
    if (onlyButtons && (group.children.length === 0 || !Array.from(group.children).every((child) => child.matches(BUTTONS)))) {
      setLayout('custom');
      return;
    }
    // Read the room and each name's one-line width in one pass; the attribute is gone before paint.
    group.setAttribute('data-action-measure', '');
    const available = group.clientWidth;
    const naturals = Array.from(group.children)
      .map((child) => child.getBoundingClientRect().width)
      .filter((width) => width > 0) // a child hidden at this width takes no column
      .map(Math.ceil);
    const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
    group.removeAttribute('data-action-measure');
    if (available === 0) return; // not shown yet; the observer measures again when it is
    const wide = window.matchMedia(WIDE).matches;
    setLayout(decideActionLayout({ available, naturals, gap, minColumn: wide ? MIN_COLUMN_WIDE : 0, maxColumns: wide ? Infinity : 3 }));
  };
  // Measure again only when the buttons or their names changed.
  const measureIfChanged = () => {
    const group = ref.current;
    if (!group) return;
    const names = `${group.children.length}|${group.textContent}`;
    if (group === seen.current.group && names === seen.current.names) return;
    seen.current = { group, names };
    measure();
  };
  const latest = useRef({ measure, measureIfChanged });
  latest.current = { measure, measureIfChanged };

  // After every render of the owner, before paint.
  useLayoutEffect(() => {
    if (active) latest.current.measureIfChanged();
  });

  // What changes without a render of the owner: a child that renames itself ("กำลังบันทึก…"),
  // the window, the dialog, the font arriving.
  useEffect(() => {
    const group = ref.current;
    if (!group || !active) return;
    const again = () => latest.current.measure();
    const frame = group.parentElement ?? group;
    let width = frame.clientWidth;
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (frame.clientWidth === width) return;
      width = frame.clientWidth;
      again();
    });
    resized?.observe(frame);
    const renamed = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => latest.current.measureIfChanged());
    renamed?.observe(group, { childList: true, characterData: true, subtree: true });
    const media = window.matchMedia(WIDE);
    media.addEventListener('change', again);
    void document.fonts?.ready.then(again);
    return () => {
      resized?.disconnect();
      renamed?.disconnect();
      media.removeEventListener('change', again);
    };
  }, [ref, active]);

  return layout;
}
