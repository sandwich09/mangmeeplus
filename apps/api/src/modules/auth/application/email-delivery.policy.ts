import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Whether this environment can actually deliver an account email (spec §15.4.1 C).
 *
 * `EMAIL_PROVIDER=disabled` — what production runs — selects `DisabledAuthMailerAdapter`, whose
 * every send is a silent no-op. Both verification routes used to answer 202 with an expiry and
 * write a PENDING token nobody could ever spend, so the page promised a letter that was never
 * sent and the account sat in "รอการยืนยัน" forever.
 *
 * A null config means the flag was never wired into this graph (the hand-built specs): report
 * enabled, so a missing provider cannot silently switch a working feature off. In the real module
 * `AppConfigService` is always resolvable.
 */
export function emailDeliveryEnabled(config: { emailProvider: string } | null | undefined): boolean {
  return (config?.emailProvider ?? 'ses') !== 'disabled';
}

/** Refuse before any `EmailVerificationToken` row exists — a token nobody receives is worse than a 422. */
export function assertEmailDeliveryEnabled(config: { emailProvider: string } | null | undefined): void {
  if (emailDeliveryEnabled(config)) return;
  throw new UnprocessableEntityException({
    code: 'email_delivery_unavailable',
    message: 'Email delivery is not enabled in this environment.',
  });
}
