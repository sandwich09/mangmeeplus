import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE_KEY = 'watchdog:isPublicRoute';

export function Public() {
  return SetMetadata(IS_PUBLIC_ROUTE_KEY, true);
}
