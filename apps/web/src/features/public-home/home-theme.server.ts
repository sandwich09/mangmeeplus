import { resolveHomeEvent, type HomeEvent } from '@watchdog-bms/contracts';
import { internalApiV1Base } from '../../common/api/internal-api-base';

/** Shared server theme for the homepage and seasonal activity routes. No browser storage or cross-request cache. */
export async function homeThemeForRequest(
  params: Record<string, string | string[] | undefined>,
  environment: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ event: HomeEvent; preview: boolean }> {
  if (environment === 'development' && params.preview === 'events') {
    return { event: resolveHomeEvent(params.event), preview: true };
  }
  let event: HomeEvent = 'default';
  try {
    const response = await fetcher(`${internalApiV1Base()}/public/home-theme`, {
      cache: 'no-store', signal: AbortSignal.timeout(1500),
    });
    if (response.ok) {
      const data: unknown = await response.json();
      event = resolveHomeEvent(data && typeof data === 'object' && 'event' in data ? data.event : undefined);
    }
  } catch {
    // Decoration must never prevent the original homepage from loading.
  }
  return { event, preview: false };
}
