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
