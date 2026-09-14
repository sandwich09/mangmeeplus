import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { STRIPE_API_VERSION } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';

export const STRIPE_FETCH = 'STRIPE_FETCH';
// Untrusted provider objects remain inside this adapter/application boundary, never public DTOs.
export type StripeObject = Record<string, any>;
export class StripeRequestError extends Error {
  constructor(readonly outcome: 'REJECTED' | 'UNKNOWN' | 'RETRY', readonly code: string, readonly retryAfterSeconds = 60) { super(`stripe.${code}`); }
}

export function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null;
}

export function safeStripeUrl(value: unknown, kind: 'checkout' | 'portal' | 'document'): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const hosts = kind === 'checkout' ? ['checkout.stripe.com'] : kind === 'portal' ? ['billing.stripe.com'] : ['invoice.stripe.com', 'pay.stripe.com', 'payments.stripe.com'];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.toString() : null;
  } catch { return null; }
}

export function verifyStripeSignature(raw: Buffer, signature: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!signature || !secret || signature.length > 4096 || raw.length > 262144) return false;
  const fields = signature.split(',').map((part) => part.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 't');
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0]?.[1] ?? '')) return false;
  const timestamp = Number(timestamps[0]![1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  return fields.some(([key, value]) => key === 'v1' && typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) && timingSafeEqual(expected, Buffer.from(value, 'hex')));
}

function appendForm(form: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null) { form.append(key, ''); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => appendForm(form, `${key}[${index}]`, item)); return; }
  if (typeof value === 'object') { for (const [child, item] of Object.entries(value)) appendForm(form, `${key}[${child}]`, item); return; }
  form.append(key, String(value));
}

@Injectable()
export class StripeClient {
  constructor(private readonly config: AppConfigService, @Inject(STRIPE_FETCH) private readonly fetcher: typeof fetch) {}

  get livemode(): boolean { return this.config.billingMode === 'live'; }
  get accountId(): string {
    if (!this.config.stripeAccountId) throw new ServiceUnavailableException({ code: 'BILLING_NOT_CONFIGURED', message: 'ระบบชำระเงินยังไม่พร้อม' });
    return this.config.stripeAccountId;
  }
  get enabled(): boolean { return this.config.billingMode !== 'disabled'; }

  async request(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<StripeObject> {
    const secret = this.config.stripeSecretKey;
    if (!this.enabled || !secret || !secret.startsWith(this.livemode ? 'sk_live_' : 'sk_test_') || !this.config.stripeAccountId) {
      throw new StripeRequestError('REJECTED', 'configuration_unavailable');
    }
    if (!/^\/[a-z_]+(?:\/[a-zA-Z0-9_]+)*$/.test(path)) throw new StripeRequestError('REJECTED', 'invalid_resource');
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) appendForm(form, key, value);
    let response: Response;
    try {
      response = await this.fetcher(`https://api.stripe.com/v1${path}${method === 'GET' && form.size ? `?${form}` : ''}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${secret}`, 'Stripe-Version': STRIPE_API_VERSION,
          'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(method !== 'GET' ? { body: form.toString() } : {}),
      });
    } catch { throw new StripeRequestError('UNKNOWN', 'transport_unknown'); }
    let data: StripeObject;
    try { data = await response.json(); } catch { throw new StripeRequestError('UNKNOWN', 'invalid_response'); }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const delay = retry && /^\d+$/.test(retry) ? Math.min(86400, Math.max(1, Number(retry))) : 60;
      const outcome = response.status >= 500 ? 'UNKNOWN' : response.status === 429 ? 'RETRY' : 'REJECTED';
      // Never forward Stripe's body, keys, card data or customer details to application logs.
      throw new StripeRequestError(outcome, response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'request_rejected', delay);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StripeRequestError('UNKNOWN', 'invalid_success');
    if (typeof data.livemode === 'boolean' && data.livemode !== this.livemode) throw new StripeRequestError('UNKNOWN', 'mode_mismatch');
    return data;
  }

  async assertAccount(): Promise<void> {
    const account = await this.request('GET', '/account');
    if (account.id !== this.accountId) throw new StripeRequestError('REJECTED', 'account_mismatch');
  }
  async list(path: string, params: Record<string, unknown>, maxPages = 20): Promise<StripeObject[]> {
    const result: StripeObject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.request('GET', path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(response.data) || typeof response.has_more !== 'boolean') throw new StripeRequestError('UNKNOWN', 'list_invalid');
      result.push(...response.data);
      if (!response.has_more) return result;
      const next = stripeId(response.data.at(-1));
      if (!next || next === cursor) throw new StripeRequestError('UNKNOWN', 'list_cursor_invalid');
      cursor = next;
    }
    throw new StripeRequestError('UNKNOWN', 'list_incomplete');
  }
}
