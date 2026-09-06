import type React from 'react';
import type { MangmeeTone } from '@/common/components/mangmee';

export type NavGroup = 'main' | 'operate' | 'finance' | 'growth' | 'admin';

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
  subItems?: { key: string; label: string; href: string; icon?: React.ReactNode; tone?: MangmeeTone; badgeCount?: number }[];
  disabled?: boolean;
  /** §15.4.1 E: an unfinished company setup, shown as one dot until the checklist is complete. */
  attention?: boolean;
  group: NavGroup;
};
