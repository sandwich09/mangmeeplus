import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { postmarkConfigurationFacts, type PostmarkConfigurationFacts } from './postmark-configuration';

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

  async inspectConfiguration(): Promise<PostmarkConfigurationFacts> {
    const serverId = this.config.postmarkServerId, stream = this.config.postmarkMessageStream;
    if (!Number.isSafeInteger(serverId) || !serverId || serverId < 1 || typeof stream !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(stream)) {
      throw new PostmarkSendError('CONFIG', 'missing_server_or_stream');
    }
    const expected = { serverId, stream }, server = await this.request('/server');
    const facts = postmarkConfigurationFacts(expected, server, null);
    if (facts.server !== 'MATCHED') return facts;
    return postmarkConfigurationFacts(expected, server, await this.request(`/message-streams/${encodeURIComponent(stream)}`));
  }

  async send(body: Record<string, unknown>, beforeDispatch?: () => Promise<void>): Promise<{ messageId: string; submittedAt: Date }> {
    // ponytail: check each cloud send, including retries; no cached readiness can outlive a config change.
    // Local fake/API-validation harnesses keep their existing transport contract.
    if (!this.config.isLocal) {
      const environment = this.config.deploymentIdentity?.targetEnvironment;
      if (this.config.emailProvider !== 'postmark' || !['uat', 'production'].includes(environment)) {
        throw new PostmarkSendError('CONFIG', 'sending_disabled_or_environment_missing');
      }
      const uat = environment === 'uat';
      const from = uat ? 'developer@mangmeeplus.com' : 'contact@mangmeeplus.com';
      const origin = uat ? 'https://uat.mangmeeplus.com' : 'https://mangmeeplus.com';
      if (this.config.postmarkFromAddress !== from || body.From !== `${this.config.postmarkFromName} <${from}>` ||
          body.MessageStream !== this.config.postmarkMessageStream) {
        throw new PostmarkSendError('CONFIG', 'sender_or_stream_mismatch');
      }
      let web: URL;
      try { web = new URL(this.config.sesWebBaseUrl ?? ''); }
      catch { throw new PostmarkSendError('CONFIG', 'web_origin_mismatch'); }
      if (web.origin !== origin || web.pathname !== '/' || web.search || web.hash || web.username || web.password) {
        throw new PostmarkSendError('CONFIG', 'web_origin_mismatch');
      }
      const recipient = typeof body.To === 'string' ? body.To.trim().toLowerCase() : '';
      if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient) || body.Cc != null || body.Bcc != null) {
        throw new PostmarkSendError('PERMANENT', 'single_recipient_required');
      }
      if (uat && !this.config.postmarkUatAllowedRecipients?.includes(recipient)) {
        throw new PostmarkSendError('CONFIG', 'uat_recipient_not_allowed');
      }
      let facts: PostmarkConfigurationFacts;
      try { facts = await this.inspectConfiguration(); }
      catch { throw new PostmarkSendError('CONFIG', 'readiness_unavailable'); }
      if (facts.server !== 'MATCHED' || facts.stream !== 'MATCHED' || facts.mode !== 'LIVE' ||
          facts.transactional !== true || facts.archived !== false) {
        throw new PostmarkSendError('CONFIG', 'server_or_stream_not_ready');
      }
      if (uat) body = { ...body, Subject: `[UAT] ${typeof body.Subject === 'string' ? body.Subject : ''}` };
    }
    await beforeDispatch?.();
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
