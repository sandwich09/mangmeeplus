export type MangmeeTone =
  | 'brand'
  | 'line'
  | 'rose'
  | 'sky'
  | 'cyan'
  | 'amber'
  | 'lime'
  | 'teal'
  | 'indigo'
  | 'purple'
  | 'slate'
  | 'danger';

export type MangmeeNavGroup = 'operate' | 'finance' | 'growth' | 'admin' | string;

export const mangmeeMenuToneByKey: Partial<Record<string, MangmeeTone>> = {
  dashboard: 'brand',
  inbox: 'line',
  sales: 'rose',
  customers: 'sky',
  booking: 'cyan',
  crmreport: 'purple',
  broadcast: 'danger',
  inventory: 'lime',
  accounting: 'amber',
  expenses: 'amber',
  journal: 'lime',
  salesdoc: 'line',
  tax: 'teal',
  procurement: 'rose',
  'accounts-payable': 'indigo',
  reimbursements: 'amber',
  banking: 'brand',
  crm: 'sky',
  reports: 'indigo',
  closing: 'slate',
  workflow: 'teal',
  'ai-suggestions': 'cyan',
  roles: 'line',
  poapproval: 'purple',
  discount: 'purple',
  notifications: 'rose',
  settings: 'slate',
};

export const mangmeeMenuToneByGroup: Record<string, MangmeeTone> = {
  main: 'brand',
  operate: 'brand',
  finance: 'amber',
  admin: 'slate',
};

export const mangmeeToneClass = {
  brand: {
    icon: 'mangmee-icon-tone-brand',
    badge: 'mangmee-badge-brand',
  },
  line: {
    icon: 'mangmee-icon-tone-line',
    badge: 'mangmee-badge-line',
  },
  rose: {
    icon: 'mangmee-icon-tone-rose',
    badge: 'mangmee-badge-rose',
  },
  sky: {
    icon: 'mangmee-icon-tone-sky',
    badge: 'mangmee-badge-sky',
  },
  cyan: {
    icon: 'mangmee-icon-tone-cyan',
    badge: 'mangmee-badge-cyan',
  },
  amber: {
    icon: 'mangmee-icon-tone-amber',
    badge: 'mangmee-badge-amber',
  },
  lime: {
    icon: 'mangmee-icon-tone-lime',
    badge: 'mangmee-badge-lime',
  },
  teal: {
    icon: 'mangmee-icon-tone-teal',
    badge: 'mangmee-badge-teal',
  },
  indigo: {
    icon: 'mangmee-icon-tone-indigo',
    badge: 'mangmee-badge-indigo',
  },
  purple: {
    icon: 'mangmee-icon-tone-purple',
    badge: 'mangmee-badge-purple',
  },
  slate: {
    icon: 'mangmee-icon-tone-slate',
    badge: 'mangmee-badge-slate',
  },
  danger: {
    icon: 'mangmee-icon-tone-danger',
    badge: 'mangmee-badge-danger',
  },
} satisfies Record<MangmeeTone, { icon: string; badge: string }>;

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function getMangmeeMenuTone(key: string, group?: MangmeeNavGroup): MangmeeTone {
  return mangmeeMenuToneByKey[key] ?? (group ? mangmeeMenuToneByGroup[group] : undefined) ?? 'brand';
}

/**
 * Employee display names are stored as `${คำนำหน้า}${ชื่อ นามสกุล}` with no separator, so the shell
 * would otherwise greet someone by a title they may have since corrected. The title is a profile
 * field, not part of who the person is, and the shell's copy of it goes stale on its own — the
 * session name comes from the global User row, which a rename cannot always update.
 *
 * นางสาว is tested before นาง because it starts with it. Without a separator this is a heuristic:
 * a first name that itself begins with a title (e.g. นายก) loses those characters. That is the same
 * trade the edit form already makes when it reads a stored name back into the title chips.
 */
export function stripThaiTitlePrefix(label?: string | null): string {
  const normalized = (label ?? '').trim();
  const stripped = normalized.replace(/^(นางสาว|นาง|นาย)/, '').trim();
  // Never blank out a name that is nothing but a title.
  return stripped || normalized;
}

export function getInitials(label?: string | null, fallback = '?') {
  const normalized = (label ?? '').trim();
  if (!normalized) return fallback;
  const words = normalized.replace(/^คุณ/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}` || fallback;
  return normalized.slice(0, 2);
}
