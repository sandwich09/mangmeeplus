import type { DictionaryKey, SupportedLocale } from './workspace-dictionary';
import { t } from './workspace-i18n.logic';

type ErrorOverrides = Partial<Record<number | 'network' | 'fallback', DictionaryKey>> & {
  // Map a stable API error `code` (e.g. a 409 conflict field) to a specific message.
  conflictCodes?: Record<string, DictionaryKey>;
};

/** HTTP status off either error shape the app throws: `{ status }` from authedApiFetch, `{ statusCode }` from ApiError. */
export function statusOf(error: unknown): number | undefined {
  const candidate = error as { statusCode?: unknown; status?: unknown } | null | undefined;
  if (typeof candidate?.statusCode === 'number') return candidate.statusCode;
  if (typeof candidate?.status === 'number') return candidate.status;
  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (error as { kind?: unknown } | null | undefined)?.kind === 'network';
}

// Bilingual error text: HTTP status → dictionary key, with per-screen overrides
// (e.g. 401 on the login screen means "wrong password", not "session expired").
// The upstream English API message is intentionally NOT shown to end users.
export function localizedErrorMessage(
  error: unknown,
  locale: SupportedLocale,
  overrides: ErrorOverrides = {},
): string {
  const status = statusOf(error);
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && overrides.conflictCodes?.[code]) return t(overrides.conflictCodes[code], locale);
  if (status !== undefined && overrides[status]) return t(overrides[status], locale);
  if (status === 401) return t('error.session_expired', locale);
  if (status === 403) return t('error.forbidden', locale);
  if (status === 409) return t('error.conflict', locale);
  if (status === 429) return t('error.rate_limited', locale);
  if (status === 400 || status === 422) return t('error.validation', locale);
  if (status !== undefined && status >= 500) return t('error.server', locale);
  if (isNetworkError(error)) return t(overrides.network ?? 'error.network', locale);
  return t(overrides.fallback ?? 'error.server', locale);
}

export function formatMessage(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
