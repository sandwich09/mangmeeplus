import { ApiError } from '../models/api-error.model';
import { mapResponseToApiError } from './api-error.logic';
import { readCookieValue } from './authed-fetch';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/auth-cookies.constants';

const MUTATING_METHOD = /^(POST|PUT|PATCH|DELETE)$/i;

export type HttpClientConfig = {
  baseUrl: string;
  getToken?: () => string | null | undefined;
  defaultHeaders?: Record<string, string>;
};

export type RequestOptions = {
  companyId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

export class HttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  private buildHeaders(method: string, opts?: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
    };
    const token = this.config.getToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts?.companyId) headers['X-Company-Id'] = opts.companyId;
    if (opts?.requestId) headers['X-Request-Id'] = opts.requestId;
    // Double-submit CSRF: cookie-authenticated mutations through the BFF need the echo header.
    if (MUTATING_METHOD.test(method) && typeof document !== 'undefined') {
      const csrf = readCookieValue(document.cookie, CSRF_COOKIE);
      if (csrf) headers[CSRF_HEADER] = csrf;
    }
    return headers;
  }

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  async post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  async patch<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, opts);
  }

  async delete<T = void>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  private async request<T>(method: string, path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(method, opts),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'include',
        signal: opts?.signal,
      });
    } catch (cause) {
      throw new ApiError({ kind: 'network_error', message: 'Network request failed.', cause });
    }

    if (!response.ok) {
      throw await mapResponseToApiError(response);
    }

    // 204 No Content
    if (response.status === 204) return undefined as T;

    try {
      return await response.json() as T;
    } catch (cause) {
      throw new ApiError({
        kind: 'server_error',
        code: 'invalid_response',
        message: 'Invalid API response.',
        statusCode: response.status,
        cause,
      });
    }
  }
}

// ponytail: factory keeps token source abstracted from caller; cookie vs localStorage is feature-layer decision
export function createWebApiClient(baseUrl: string, getToken: () => string | null): HttpClient {
  return new HttpClient({ baseUrl, getToken });
}
