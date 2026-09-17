'use client';

import { useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// The open panel of a themed field (option list, date grid) renders through a portal
// for the same reason the shared Modal does: an `overflow-*` scroll box clips BOTH
// axes, and a sticky/transformed ancestor traps z-index — so an in-place panel gets
// cut off by the very table it belongs to. Portaled means `position: fixed`, so the
// panel has to follow its trigger by hand: re-measured on scroll (capture phase — the
// scroller is usually the table, not the window) and on resize. It renders above the
// shared Modal's z-[99999] because these fields are used inside modals.

type Props = {
  open: boolean;
  /** Element the panel hangs off; its box decides position (and the width floor when matched). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Exposed so the owner can treat the portaled panel as "inside" for outside-click. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Wanted height: caps the panel and decides whether it opens downwards or flips above. */
  height: number;
  /** Floor, not a cap: the panel starts at the anchor's width and grows to fit long
   *  option labels (capped by maxWidth below) instead of cutting them off. */
  minAnchorWidth?: boolean;
  /** Keep searchable lists aligned while their filtered content changes width. */
  matchAnchorWidth?: boolean;
  className: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'style'>;

// Measurable (laid out, capped like the placed panel) but not yet visible.
const UNPLACED: CSSProperties = { position: 'fixed', top: 0, left: 0, maxWidth: 'calc(100vw - 16px)', visibility: 'hidden' };

export function PopoverPanel({ open, anchorRef, panelRef, height, minAnchorWidth = false, matchAnchorWidth = false, className, children, ...rest }: Props) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Trigger scrolled out of sight: drop the panel rather than leave it floating
      // over unrelated content. Scrolling back fires `place` again and restores it.
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setStyle(null);
        return;
      }
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const panelWidth = matchAnchorWidth ? rect.width : Math.max(panelRef.current?.getBoundingClientRect().width ?? 0, minAnchorWidth ? rect.width : 0);
      const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - panelWidth - 8));
      // Fixed panels cannot be scrolled into view, so a panel that does not fit below
      // hangs off the trigger's top edge instead (pinned by `bottom`, so a short panel
      // still sits snug against the trigger).
      const flip = below < height && above > below;
      setStyle({
        position: 'fixed',
        left,
        maxWidth: 'calc(100vw - 16px)',
        // Never taller than the panel's own cap — an inline maxHeight would otherwise
        // override the component's max-h class and let a long list grow past it.
        maxHeight: Math.max(Math.min(height, flip ? above : below), 96),
        ...(minAnchorWidth ? { minWidth: rect.width } : {}),
        ...(matchAnchorWidth ? { width: rect.width } : {}),
        ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    place();
    const animationFrame = window.requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, height, minAnchorWidth, matchAnchorWidth, anchorRef, panelRef]);

  // Mounted invisible until placed, never withheld: `place` reads the panel's own
  // width to keep it inside the viewport, and a panel that is not in the DOM yet
  // measures 0 — which pins a wide panel to the trigger's left edge and lets it hang
  // off the right of a phone screen until the next scroll re-runs `place`.
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={panelRef} {...rest} style={style ?? UNPLACED} className={className}>{children}</div>,
    document.body,
  );
}
