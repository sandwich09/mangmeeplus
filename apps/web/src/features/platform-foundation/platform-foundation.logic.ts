import {
  PLATFORM_FOUNDATION_SUBTITLE,
  PLATFORM_FOUNDATION_TITLE,
} from './platform-foundation.constants';
import type {
  PlatformFoundationStatusItem,
  PlatformFoundationViewModel,
} from './platform-foundation.model';

export function buildPlatformFoundationViewModel(
  statusItems: PlatformFoundationStatusItem[],
): PlatformFoundationViewModel {
  return {
    title: PLATFORM_FOUNDATION_TITLE,
    subtitle: PLATFORM_FOUNDATION_SUBTITLE,
    statusItems,
  };
}
