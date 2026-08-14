import { ApiError } from '../models/api-error.model';

// Map HTTP response to ApiError
export async function mapResponseToApiError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> | null;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = null;
  }

  const requestId =
    response.headers.get('x-request-id') ??
    (typeof body?.requestId === 'string' ? body.requestId : undefined);
  const message =
    (typeof body?.message === 'string' ? body.message : undefined) ??
    (typeof body?.error === 'string' ? body.error : undefined) ??
    response.statusText ??
    'Unknown error';
  const code = typeof body?.code === 'string' ? body.code : undefined;

  if (response.status === 401) {
    return new ApiError({ kind: 'unauthorized', message, statusCode: 401, requestId, code });
  }
  if (response.status === 403) {
    return new ApiError({ kind: 'forbidden', message, statusCode: 403, requestId, code });
  }
  if (response.status === 404) {
    return new ApiError({ kind: 'not_found', message: 'Resource not found.', statusCode: 404, requestId, code });
  }
  if (response.status === 429) {
    return new ApiError({ kind: 'rate_limited', message, statusCode: 429, requestId, code });
  }
  if (response.status === 422 || response.status === 400) {
    // Parse NestJS validation error format: { message: string[], error: string }
    const fieldErrors = Array.isArray(body?.message)
      ? (body.message as string[]).map((m) => ({ field: 'unknown', message: m }))
      : Array.isArray(body?.errors)
        ? (body.errors as { field: string; message: string }[])
        : [];
    // `code` matters here for the same reason it does on the fallback branch below: a 400 can carry
    // a stable rule name (e.g. `password_reuse`) that the screen maps to its own message, and this
    // branch also replaces `message`, so dropping `code` left the caller with nothing to branch on.
    return new ApiError({ kind: 'validation', message: 'Validation failed.', statusCode: response.status, requestId, fieldErrors, code });
  }
  if (response.status >= 500) {
    return new ApiError({ kind: 'server_error', message, statusCode: response.status, requestId, code });
  }
  // `code` is carried through here too. 409 lands on this branch, and a conflict is exactly the
  // case where the server's machine-readable code matters most — `localizedErrorMessage` already
  // looks for `conflictCodes[code]`, but every 409 arrived with `code` stripped, so no caller could
  // ever branch on one.
  return new ApiError({ kind: 'unknown', message, statusCode: response.status, requestId, code });
}

// Determine PermissionState from permissions arrays
export function resolvePermissionState(
  requiredAnyPermissions: string[],
  requiredWritePermissions: string[],
  userPermissions: string[],
  isSignedIn: boolean,
) {
  if (!isSignedIn) return 'signed_out';
  if (requiredAnyPermissions.length === 0) return 'allowed';
  const canRead = requiredAnyPermissions.some((p) => userPermissions.includes(p));
  if (!canRead) return 'forbidden';
  if (requiredWritePermissions.length === 0) return 'allowed';
  const canWrite = requiredWritePermissions.some((p) => userPermissions.includes(p));
  return canWrite ? 'allowed' : 'readonly';
}
