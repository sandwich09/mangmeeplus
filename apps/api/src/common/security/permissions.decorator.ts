import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'watchdog:requiredPermissions';
export const REQUIRED_ANY_PERMISSIONS_KEY = 'watchdog:requiredAnyPermissions';

export function RequirePermissions(...permissions: string[]) {
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}

/** Use only when the use-case contract explicitly permits equivalent authority paths. */
export function RequireAnyPermission(...permissions: string[]) {
  return SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);
}
