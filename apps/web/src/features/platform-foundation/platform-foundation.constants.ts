import type { PlatformFoundationStatusItem } from './platform-foundation.model';

export const PLATFORM_FOUNDATION_TITLE = 'WatchDog-BMS';

export const PLATFORM_FOUNDATION_SUBTITLE = 'SME Business OS platform foundation';

export const PLATFORM_FOUNDATION_STATUS_ITEMS: PlatformFoundationStatusItem[] = [
  { label: 'Next.js web scaffold', status: 'ready' },
  {
    // Workspace requires a signed-in session; /login routes straight to the user's dashboard.
    label: 'Business workspace shell',
    status: 'ready',
    href: '/login',
    actionLabel: 'Sign in to workspace',
  },
  { label: 'ERP core API boundary', status: 'ready' },
  { label: 'AI Gateway boundary', status: 'ready' },
];
