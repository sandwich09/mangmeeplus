import { PLATFORM_FOUNDATION_STATUS_ITEMS } from './platform-foundation.constants';
import type { PlatformFoundationStatusItem } from './platform-foundation.model';

export async function getPlatformFoundationStatus(): Promise<PlatformFoundationStatusItem[]> {
  return PLATFORM_FOUNDATION_STATUS_ITEMS;
}
