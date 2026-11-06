export type OverlayRect = { top: number; bottom: number; left: number; right: number };
type Bar = OverlayRect & { edge: 'top' | 'bottom' };

/** Only bars crossing this column reserve space; a full-height sidebar is not a bar. */
export function overlayEdges(viewport: OverlayRect, bars: Bar[]): OverlayRect {
  const bounds = { ...viewport };
  for (const bar of bars) {
    if (bar.right <= viewport.left || bar.left >= viewport.right || bar.bottom <= viewport.top || bar.top >= viewport.bottom) continue;
    if (bar.edge === 'top' && bar.bottom < viewport.bottom) bounds.top = Math.max(bounds.top, bar.bottom);
    if (bar.edge === 'bottom' && bar.top > viewport.top) bounds.bottom = Math.min(bounds.bottom, bar.top);
  }
  return bounds;
}

export function placeAnchoredPanel(anchor: OverlayRect, bounds: OverlayRect, height: number, width: number, keepWhole = false) {
  // A sticky bar may cover one edge while the field is still pressable. Open from
  // its visible edge; only close once the field is wholly hidden by the bars.
  if (anchor.bottom <= bounds.top || anchor.top >= bounds.bottom || anchor.right <= bounds.left || anchor.left >= bounds.right) return null;
  const below = bounds.bottom - anchor.bottom - 14, above = anchor.top - bounds.top - 14;
  const side = below >= height || below >= above ? 'below' : 'above';
  const maxHeight = Math.min(height, keepWhole ? bounds.bottom - bounds.top - 16 : side === 'below' ? below : above);
  if (maxHeight < 96) return null;
  const edge = side === 'below' ? anchor.bottom + 6 : anchor.top - 6;
  // A short phone may have room for the whole calendar, but not on either side
  // of its field. Slide it inside the visible area instead of hiding a week.
  const fittedEdge = side === 'below'
    ? Math.max(bounds.top + 8, Math.min(edge, bounds.bottom - maxHeight - 8))
    : Math.min(bounds.bottom - 8, Math.max(edge, bounds.top + maxHeight + 8));
  return { side, edge: keepWhole ? fittedEdge : edge,
    left: Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - width - 8)), maxHeight };
}

/** Measure only while an overlay is open. Computed insets include the shell's CSS variables. */
export function readOverlayBounds(anchor?: HTMLElement | null, panel?: HTMLElement | null): OverlayRect {
  const visual = window.visualViewport;
  const viewport = { top: visual?.offsetTop ?? 0, bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
    left: visual?.offsetLeft ?? 0, right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth) };
  const column = anchor?.getBoundingClientRect() ?? viewport;
  const bars: Bar[] = [];
  const root = anchor?.closest('[role="dialog"],dialog') ?? document.body;
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (element === panel || panel?.contains(element) || element.contains(anchor ?? null) || element.closest('[data-toast-stack]')) continue;
    const css = getComputedStyle(element);
    const modalChrome = element.hasAttribute('data-modal-chrome');
    if ((!modalChrome && !['sticky', 'fixed'].includes(css.position)) || css.visibility === 'hidden' || css.display === 'none') continue;
    const rect = element.getBoundingClientRect();
    // Tall sticky document viewers and sidebars are columns, not chrome bars.
    if (!rect.width || !rect.height || rect.right <= column.left || rect.left >= column.right) continue;
    // Modal action bars use normal flex layout, rather than sticky/fixed.
    if (modalChrome && rect.top >= column.bottom) bars.push({ ...rect.toJSON(), edge: 'bottom' });
    if (!['sticky', 'fixed'].includes(css.position)) continue;
    if (rect.height >= (viewport.bottom - viewport.top) / 2 && rect.width < (viewport.right - viewport.left) * 0.9) continue;
    // A fixed element reports a used px `top` even when only `bottom` pins it (a floating chat button at the
    // bottom right read as a bar across the top, so every list above it closed as it opened — demo 2026-11-06).
    // Which edge it sits on is told by which half of the screen it is in.
    const top = parseFloat(css.top), bottom = parseFloat(css.bottom), middle = (viewport.top + viewport.bottom) / 2;
    if (Number.isFinite(top) && rect.top <= viewport.top + top + 1 && rect.top < middle) bars.push({ ...rect.toJSON(), edge: 'top' });
    if (Number.isFinite(bottom) && rect.bottom >= viewport.bottom - bottom - 1 && rect.bottom > middle) bars.push({ ...rect.toJSON(), edge: 'bottom' });
  }
  const bounds = overlayEdges(viewport, bars);
  // The panel is portaled outside the scrolling sheet; only its trigger must stay inside it.
  return bounds;
}

/** Portaled panels may extend beyond a table; their anchor still has to be visible inside it. */
export function anchorIsClipped(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const css = getComputedStyle(parent), clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && (rect.top < clip.top || rect.bottom > clip.bottom)) return true;
    if (/(auto|scroll|hidden|clip)/.test(css.overflowX) && (rect.right <= clip.left || rect.left >= clip.right)) return true;
  }
  return false;
}
