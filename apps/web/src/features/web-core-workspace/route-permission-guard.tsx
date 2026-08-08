import type { ReactNode } from 'react';
import type { WebSession } from '@/common/models/web-session.model';
import { ForbiddenState } from '@/common/components/state';
import { canSeeRoute } from './route-permissions';

export function requireRoutePermission(
  session: Pick<WebSession, 'permissions'> | null,
  path: string,
): ReactNode | null {
  return canSeeRoute(path, session?.permissions ?? []) ? null : <ForbiddenState />;
}
