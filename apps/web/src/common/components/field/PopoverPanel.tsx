'use client';

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { anchorIsClipped, placeAnchoredPanel, readOverlayBounds } from '@/common/functions/overlay-geometry';

// The open panel of a themed field (option list, date grid) renders through a portal
// for the same reason the shared Modal does: an `overflow-*` scroll box clips BOTH
// axes, and a sticky/transformed ancestor traps z-index — so an in-place panel gets
// cut off by the very table it belongs to. Portaled means `position: fixed`, so the
// panel has to follow its trigger by hand: re-measured on scroll (capture phase — the
// scroller is usually the table, not the window) and on resize. It renders above the
// shared Modal's z-[99999] because these fields are used inside modals.

type Props = {
  open: boolean;
  onClose: () => void;
  /** Element the panel hangs off; its box decides position (and the width floor when matched). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Exposed so the owner can treat the portaled panel as "inside" for outside-click. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Wanted height: caps the panel and decides whether it opens downwards or flips above. */
  height: number;
  /** Keep an entire calendar visible even when it has to overlap its trigger. */
  keepWhole?: boolean;
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

export function PopoverPanel({ open, onClose, anchorRef, panelRef, height, keepWhole = false, minAnchorWidth = false, matchAnchorWidth = false, className, children, ...rest }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = matchAnchorWidth ? rect.width : Math.max(panelRef.current?.getBoundingClientRect().width ?? 0, minAnchorWidth ? rect.width : 0);
      const placement = anchorRef.current && !anchorIsClipped(anchorRef.current) ? placeAnchoredPanel(rect, readOverlayBounds(anchorRef.current, panelRef.current), height, panelWidth, keepWhole) : null;
      if (!placement) { setStyle(null); closeRef.current(); return; }
      setStyle({
        position: 'fixed',
        left: placement.left,
        maxWidth: 'calc(100vw - 16px)',
        // Never taller than the panel's own cap — an inline maxHeight would otherwise
        // override the component's max-h class and let a long list grow past it.
        maxHeight: placement.maxHeight,
        ...(minAnchorWidth ? { minWidth: rect.width } : {}),
        ...(matchAnchorWidth ? { width: rect.width } : {}),
        ...(placement.side === 'above' ? { bottom: window.innerHeight - placement.edge } : { top: placement.edge }),
      });
    };
    place();
    let animationFrame = 0;
    const schedule = () => { window.cancelAnimationFrame(animationFrame); animationFrame = window.requestAnimationFrame(place); };
    schedule();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [open, height, keepWhole, minAnchorWidth, matchAnchorWidth, anchorRef, panelRef]);

  // Mounted invisible until placed, never withheld: `place` reads the panel's own
  // width to keep it inside the viewport, and a panel that is not in the DOM yet
  // measures 0 — which pins a wide panel to the trigger's left edge and lets it hang
  // off the right of a phone screen until the next scroll re-runs `place`.
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={panelRef} {...rest} style={style ?? UNPLACED} className={className}>{children}</div>,
    anchorRef.current?.closest<HTMLElement>('[popover], dialog') ?? document.body,
  );
}
