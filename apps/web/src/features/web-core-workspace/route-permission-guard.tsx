import type { ReactNode } from 'react';
import type { WebSession } from '@/common/models/web-session.model';
import { ForbiddenState } from '@/common/components/state';
import { canSeeRoute } from './route-permissions';

export function requireRoutePermission(
  session: Pick<WebSession, 'permissions'> & Partial<Pick<WebSession, 'roles' | 'availablePermissions'>> | null,
  path: string,
): ReactNode | null {
  // The whole page when it shows, so its title is the page's one heading.
  return canSeeRoute(path, session?.permissions ?? []) ? null : <ForbiddenState titleAs="h1" packageAvailable={session?.availablePermissions ? canSeeRoute(path, session.availablePermissions) : undefined} isOwner={session?.roles?.includes('OWNER')} />;
}
