import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isActiveNavSubItem, isPointerArrival, lineLinkMenuRow, revealScrollDelta, type SidebarSubItemRef } from './app-sidebar.logic';

const shellDir = dirname(fileURLToPath(import.meta.url));

describe('isActiveNavSubItem', () => {
  it('uses the longest matching sibling href', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'expenses.list', href: '/companies/co/expenses' },
      { key: 'expenses.upload', href: '/companies/co/expenses/upload' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/expenses/upload', undefined, subItems[1], subItems), true);
  });

  it('uses the longest matching href across submenu parents', () => {
    const subItems: SidebarSubItemRef[] = [
      { key: 'settings.overview', href: '/companies/co/settings' },
      { key: 'roles.permissions', href: '/companies/co/settings/permissions' },
      { key: 'lineoa', href: '/companies/co/settings/line-oa' },
    ];

    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/line-oa', 'lineoa', subItems[2], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[0], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings/permissions', 'roles', subItems[1], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[0], subItems), true);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[1], subItems), false);
    assert.equal(isActiveNavSubItem('/companies/co/settings', 'settings', subItems[2], subItems), false);
  });
});

describe('revealScrollDelta', () => {
  const root = { top: 100, bottom: 500 };
  it('does not move an active item that is already visible', () => {
    assert.equal(revealScrollDelta(root, { top: 120, bottom: 160 }), 0);
  });
  it('moves only enough to reveal an item above or below the viewport', () => {
    assert.equal(revealScrollDelta(root, { top: 70, bottom: 110 }), -30);
    assert.equal(revealScrollDelta(root, { top: 480, bottom: 540 }), 40);
  });
});

describe('collapsed sidebar layout', () => {
  it('keeps main content fixed while hover expansion overlays it', () => {
    const source = readFileSync(join(shellDir, 'WorkspaceShell.tsx'), 'utf8');
    assert.match(source, /: isExpanded\s*\? 'lg:ml-\[289px\]'/);
    assert.doesNotMatch(source, /isExpanded \|\| isHovered/);
  });
});

describe('collapsed sidebar hover', () => {
  // What the browser reports to the sidebar once its collapse button was pressed with the pointer resting on it
  // (real look, 2026-10-02): the press takes the button and every label out of the page, and the pointer is reported
  // again as one more mouseenter — in Chromium 149 coming from the removed element, in WebKit 26.5 from nowhere.
  const removedElement = { isConnected: false };
  const elementOfThePage = { isConnected: true };

  it('stays collapsed when the collapse button is pressed with the pointer on the sidebar', () => {
    assert.equal(isPointerArrival(removedElement, true), false);
    assert.equal(isPointerArrival(null, true), false);
  });

  it('opens when the pointer has left and comes back', () => {
    // A leave lowers the flag; any entry counts then, also one from outside the window, where the sidebar's edge is.
    assert.equal(isPointerArrival(elementOfThePage, false), true);
    assert.equal(isPointerArrival(null, false), true);
    // WebKit reports no leave when the removed label was all that lay under the pointer: arriving from the page is proof enough.
    assert.equal(isPointerArrival(elementOfThePage, true), true);
  });

  it('closes the same way from the keyboard: by where the pointer rests, never by focus', () => {
    const source = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    // Enter or Space on the focused button is this same click; what counts is whether the pointer is on the sidebar.
    assert.match(source, /closedUnderPointerRef\.current = isExpanded && Boolean\(event\.currentTarget\.closest\('aside'\)\?\.matches\(':hover'\)\);\s+setIsHovered\(false\);\s+toggleSidebar\(\);/);
    assert.match(source, /if \(!isPointerArrival\(event\.nativeEvent\.relatedTarget as Node \| null, closedUnderPointerRef\.current\)\) return;/);
    assert.match(source, /onMouseLeave=\{\(\) => \{\s+closedUnderPointerRef\.current = false;/);
    assert.match(source, /\$\{isExpanded \|\| isMobileOpen \|\| isHovered \? 'w-\[min\(289px,85vw\)\] lg:w-\[289px\]' : 'w-\[86px\]'\}/);
  });
});

describe('workspace account menu placement', () => {
  it('uses the authenticated custom role name rather than the user-menu caption', () => {
    const source = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    assert.ok(source.includes('userRoleNames?.[role]?.trim()'));
    assert.ok(!source.includes("roleLabelKey[role] ?? 'shell.user_menu'"));
  });
  it('keeps account actions in the sidebar footer and out of the header', () => {
    const sidebarSource = readFileSync(join(shellDir, 'AppSidebar.tsx'), 'utf8');
    const headerSource = readFileSync(join(shellDir, 'AppHeader.tsx'), 'utf8');

    assert.match(sidebarSource, /id="sidebar-user-menu"/);
    assert.match(sidebarSource, /shell\.reset_password/);
    // One LINE row, not two: the OAuth start action carries the lineLinkMenuRow state gate.
    assert.match(sidebarSource, /lineLinkMenuRow/);
    assert.match(sidebarSource, /line-login\/start/);
    assert.doesNotMatch(sidebarSource, /issueSelfLineLinkToken/);
    assert.match(sidebarSource, /logoutCurrentSession/);
    assert.doesNotMatch(headerSource, /shell\.user_menu|shell\.reset_password|logoutCurrentSession/);
  });
});

describe('lineLinkMenuRow', () => {
  it('keeps the row disabled while the lazy account-security fetch is in flight', () => {
    // "Unknown" must not read as "not linked": in the fetch window an already-linked user
    // could otherwise start the re-link the owner directive forbids. The row still renders
    // immediately — the menu never blocks on the call — it just is not clickable yet.
    assert.deepEqual(lineLinkMenuRow(null), {
      labelKey: 'shell.line_link.action',
      badgeKey: null,
      disabled: true,
    });
  });

  it('offers the link action with the amber not-linked badge', () => {
    assert.deepEqual(lineLinkMenuRow({ lineLinked: false }), {
      labelKey: 'shell.line_link.action',
      badgeKey: 'shell.line_link.badge_unlinked',
      disabled: false,
    });
  });

  it('renders an already-linked account as a disabled row (owner directive 2026-09-01)', () => {
    // Re-link and unlink stay admin-console actions: an accidental tap here would sever a
    // working identity and burn LINE OA push quota.
    assert.deepEqual(lineLinkMenuRow({ lineLinked: true }), {
      labelKey: 'shell.line_link.linked_title',
      badgeKey: 'shell.line_link.badge_linked',
      disabled: true,
    });
  });
});
