// Pure sidebar nav logic, kept out of AppSidebar.tsx so specs can import it
// without pulling the component's SVG imports into the node test runner.
export type SidebarSubItemRef = { key: string; href: string };

// activeKey resolves to the most specific module, which may be a sub-item ('lineoa') or nothing
// at all for sub-items with no module, so match the route too.
// Across all submenu routes, only the longest matching href is active.
export function isActiveNavSubItem(
  pathname: string,
  activeKey: string | undefined,
  sub: SidebarSubItemRef,
  candidates: ReadonlyArray<SidebarSubItemRef>,
): boolean {
  // The route names a row outright (its own module, or the row a page without one is opened from): only that row.
  // Without this the settings overview, whose address is a prefix of every settings page, lit up beside it.
  if (candidates.some((candidate) => candidate.key === activeKey)) return sub.key === activeKey;
  const isPathMatch = (path: string) => pathname === path || pathname.startsWith(path + '/');
  return isPathMatch(sub.href) && !candidates.some((candidate) => candidate.href.length > sub.href.length && isPathMatch(candidate.href));
}

/** Smallest scroll needed to reveal an item; 0 keeps an already-visible menu perfectly still. */
export function revealScrollDelta(
  root: { top: number; bottom: number },
  item: { top: number; bottom: number },
): number {
  if (item.top < root.top) return item.top - root.top;
  if (item.bottom > root.bottom) return item.bottom - root.bottom;
  return 0;
}

/**
 * Whether a mouseenter is the pointer arriving on the sidebar, which is what opens the collapsed one over the page.
 *
 * Pressing the collapse button takes the button and every label out of the page while the pointer still rests there.
 * The browser then reports that pointer again and React hands the sidebar one more mouseenter, which used to reopen
 * it on the spot: the press looked as if it did nothing. So after a press made with the pointer on the sidebar
 * (`closedUnderPointer`) only an entry from an element still in the page counts, until the pointer leaves or so
 * arrives. `cameFrom` is the native event's relatedTarget: the removed element in Chromium, nothing in WebKit.
 * ponytail: nothing is also what a pointer coming in from outside the window brings, so when the browser reports no
 * leave (WebKit, when a removed label was all that lay under the pointer) one such entry is ignored; follow the
 * pointer's position instead if that ever matters.
 */
export function isPointerArrival(cameFrom: { isConnected?: boolean } | null, closedUnderPointer: boolean): boolean {
  return !closedUnderPointer || cameFrom?.isConnected === true;
}

/**
 * Self-service LINE link menu row (line-self-link spec §3, owner directive 2026-09-01).
 * `null` = the lazy account-security fetch has not landed yet: the row renders immediately (the
 * menu never blocks on a network call) but stays DISABLED, because "unknown" must not be treated
 * as "not linked" — in that window an already-linked user could otherwise start a re-link, which
 * is exactly the accidental tap the owner directive forbids. Once state lands, a not-linked user
 * gets the enabled row (~a fetch round-trip later); a linked user keeps the disabled row —
 * re-link and unlink stay admin-console actions.
 */
export type LineLinkMenuRow = {
  labelKey: 'shell.line_link.action' | 'shell.line_link.linked_title';
  badgeKey: 'shell.line_link.badge_unlinked' | 'shell.line_link.badge_linked' | null;
  disabled: boolean;
};

export function lineLinkMenuRow(security: { lineLinked: boolean } | null): LineLinkMenuRow {
  if (!security) return { labelKey: 'shell.line_link.action', badgeKey: null, disabled: true };
  return security.lineLinked
    ? { labelKey: 'shell.line_link.linked_title', badgeKey: 'shell.line_link.badge_linked', disabled: true }
    : { labelKey: 'shell.line_link.action', badgeKey: 'shell.line_link.badge_unlinked', disabled: false };
}
