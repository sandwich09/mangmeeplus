import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';

export const POSTMARK_FETCH = 'POSTMARK_FETCH';
export type MailFailureKind = 'CONFIG' | 'PERMANENT' | 'SUPPRESSED' | 'RETRY' | 'UNKNOWN';

export class PostmarkSendError extends Error {
  constructor(readonly kind: MailFailureKind, readonly code: string, readonly retryAfterSeconds = 60) {
    super(`postmark.${code}`);
  }
}

export function postmarkFailure(status: number, code: number, retryAfter: string | null): PostmarkSendError {
  const delay = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(86400, Math.max(60, Number(retryAfter))) : 60;
  if (status === 401 || code === 10) return new PostmarkSendError('CONFIG', 'authentication');
  if (code === 406) return new PostmarkSendError('SUPPRESSED', 'inactive_recipient');
  if ([412, 413, 1235, 1236].includes(code)) return new PostmarkSendError('CONFIG', 'account_or_stream');
  if (status === 429) return new PostmarkSendError('RETRY', 'rate_limited', delay);
  if (status >= 500) return new PostmarkSendError('UNKNOWN', 'provider_unavailable');
  return new PostmarkSendError('PERMANENT', 'request_rejected');
}

export function validPostmarkMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class PostmarkClient {
  constructor(private readonly config: AppConfigService, @Inject(POSTMARK_FETCH) private readonly fetcher: typeof fetch) {}

  private async request(path: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
    const token = this.config.postmarkServerToken;
    if (!token || (token === 'POSTMARK_API_TEST' && !this.config.isLocal)) {
      throw new PostmarkSendError('CONFIG', 'missing_server_token');
    }
    let response: Response;
    try {
      response = await this.fetcher(`https://api.postmarkapp.com${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'X-Postmark-Server-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new PostmarkSendError('UNKNOWN', 'transport_unknown'); }
    let data: Record<string, any>;
    try { data = await response.json(); } catch {
      if (response.status !== 200) throw postmarkFailure(response.status, 0, response.headers.get('retry-after'));
      throw new PostmarkSendError('UNKNOWN', 'invalid_response');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PostmarkSendError('UNKNOWN', 'invalid_response');
    if (response.status !== 200 || (typeof data.ErrorCode === 'number' && data.ErrorCode !== 0)) {
      throw postmarkFailure(response.status, data.ErrorCode, response.headers.get('retry-after'));
    }
    return data;
  }

  async send(body: Record<string, unknown>): Promise<{ messageId: string; submittedAt: Date }> {
    const result = await this.request('/email', body);
    if (result.ErrorCode !== 0 || !validPostmarkMessageId(result.MessageID) ||
        typeof result.SubmittedAt !== 'string' || !Number.isFinite(Date.parse(result.SubmittedAt))) {
      throw new PostmarkSendError('UNKNOWN', 'invalid_success');
    }
    return { messageId: result.MessageID, submittedAt: new Date(result.SubmittedAt) };
  }

  async findAttempt(attemptId: string, stream: string): Promise<Record<string, any>[]> {
    const query = new URLSearchParams({ count: '100', offset: '0', messagestream: stream, metadata_sendAttemptId: attemptId });
    const result = await this.request(`/messages/outbound?${query}`);
    if (!Array.isArray(result.Messages) || !Number.isSafeInteger(result.TotalCount) || result.TotalCount < 0 ||
        result.TotalCount > 100 || result.Messages.length !== result.TotalCount) {
      throw new PostmarkSendError('UNKNOWN', 'lookup_incomplete');
    }
    return result.Messages;
  }
}
