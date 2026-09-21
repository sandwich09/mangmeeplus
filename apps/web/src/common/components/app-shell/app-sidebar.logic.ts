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
  const isPathMatch = (path: string) => pathname === path || pathname.startsWith(path + '/');
  return sub.key === activeKey || (isPathMatch(sub.href) && !candidates.some((candidate) => candidate.href.length > sub.href.length && isPathMatch(candidate.href)));
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
