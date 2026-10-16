import type React from 'react';
import type { MangmeeTone } from '@/common/components/mangmee';

export type NavGroup = 'main' | 'operate' | 'finance' | 'growth' | 'admin';
/** A sidebar row's heading: a module group, or the guide's own "help" heading (the guide is not a module). */
export type NavItemGroup = NavGroup | 'help';

export type ModuleStatus = 'ready' | 'planned' | 'disabled';

export type WorkspaceModule = {
  key: string;
  labelKey: string;
  buildHref: (companyId: string) => string;
  iconKey: string;
  navGroup: NavGroup;
  requiredAnyPermissions: string[];
  requiredAllPermissions?: string[];
  status: ModuleStatus;
  statusReasonKey?: string;
  deepLinkTargets: string[];
};

export type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  /** `badgeLabel`: a short word on the row that needs the person, e.g. "ยังไม่ครบ" on the shop details row. */
  subItems?: { key: string; label: string; href: string; icon?: React.ReactNode; tone?: MangmeeTone; badgeCount?: number; badgeLabel?: string }[];
  disabled?: boolean;
  /** §15.4.1 E: an unfinished company setup, shown as one dot until the checklist is complete. */
  attention?: boolean;
  group: NavItemGroup;
};
