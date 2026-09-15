import { Inject, Injectable } from '@nestjs/common';
import { SendEmailCommand, type SESClient } from '@aws-sdk/client-ses';
import { AppConfigService } from '../../../common/config/app-config.service';
import type {
  AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort, LineSignupWelcomeEmailInput,
  PackageChangeNoticeEmailInput, SignupRejectionEmailInput, SupportRequestNoticeEmailInput,
} from '../domain/ports/auth-mailer.port';
import { accountClaimLogoUrl } from './account-claim-email.template';
import { renderSignupRejectionEmail } from './signup-rejection-email.template';

import { renderLinkEmail, renderClaimEmail, renderSupportRequestNoticeEmail, httpsUrl, type EmailKind, type RenderedEmail } from './auth-email.templates';

export const SES_EMAIL_CLIENT_TOKEN = 'SES_EMAIL_CLIENT_TOKEN';
type SesEmailClient = Pick<SESClient, 'send'>;
/**
 * SES configuration set that publishes delivery/bounce/complaint events to SNS. Read from the
 * environment rather than `AppConfigService` for the same reason `accountClaimLogoUrl` is: it is a
 * per-environment operational name with a safe absent default, and adding it to the shared config
 * schema would touch a package every app boots. Absent = the send carries no configuration set,
 * exactly the behaviour before this existed.
 */
export function sesConfigurationSet(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SES_CONFIGURATION_SET?.trim() || undefined;
}

@Injectable()
export class SesAuthMailerAdapter implements AuthMailerPort {
  constructor(
    private readonly config: AppConfigService,
    @Inject(SES_EMAIL_CLIENT_TOKEN) private readonly client: SesEmailClient,
  ) {}

  async sendEmailVerification(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'email_verification', renderLinkEmail(input, this.baseUrl(), 'email_verification'));
  }

  async sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'password_reset', renderLinkEmail(input, this.baseUrl(), 'password_reset'));
  }

  async sendAccountClaim(input: AccountClaimEmailInput): Promise<string | null> {
    return this.send(input.toEmail, 'account_claim', renderClaimEmail(input, this.baseUrl()));
  }

  // No `baseUrl()` here on purpose: the rejection letter carries no link, so a missing WEB_BASE_URL
  // must not be the reason an applicant never hears back.
  async sendSignupRejection(input: SignupRejectionEmailInput): Promise<void> {
    await this.send(input.toEmail, 'signup_rejection', renderSignupRejectionEmail({
      companyName: input.companyName,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(accountClaimLogoUrl() ? { logoUrl: accountClaimLogoUrl()! } : {}),
    }));
  }

  /**
   * H-02 hooks, deliberately inert. Not because the plumbing is hard, but because there is nothing
   * truthful to send: the Thai copy for both letters is Owner-owned and neither appears in the
   * spec §7 message table, and a LINE-first shop has no verified address at signup anyway. TODO
   * (Phase 2, when a mail provider is approved): render an Owner-signed template here and send only
   * for a User with `emailVerifiedAt`.
   */
  async sendLineSignupWelcome(_input: LineSignupWelcomeEmailInput): Promise<void> {}

  async sendPackageChangeNotice(_input: PackageChangeNoticeEmailInput): Promise<void> {}

  /**
   * §2.2 delta (Owner 2026-09-05). Unlike the two hooks above, this letter HAS truthful copy and a
   * real address — it goes to our own support mailbox, so no customer consent, verified address or
   * Owner-signed template is in the way. `baseUrl()` is deliberately not called: the action link is
   * built by the caller, which already knows whether it has one.
   */
  async sendSupportRequestNotice(input: SupportRequestNoticeEmailInput): Promise<boolean> {
    await this.send(input.toEmail, 'support_request_notice', renderSupportRequestNoticeEmail(input));
    return true;
  }

  private async send(toEmail: string, kind: EmailKind, rendered: RenderedEmail): Promise<string | null> {
    const fromAddress = this.config.sesFromAddress;
    if (!fromAddress) throw new Error('SES_FROM_ADDRESS is required for SES email delivery.');
    const configurationSet = sesConfigurationSet();
    const result = await this.client.send(new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Charset: 'UTF-8', Data: rendered.subject },
        Body: {
          Text: { Charset: 'UTF-8', Data: rendered.text },
          Html: { Charset: 'UTF-8', Data: rendered.html },
        },
      },
      Tags: [{ Name: 'message_type', Value: kind }],
      // Without this the account has no event destination for the send, so a hard bounce is
      // invisible to the product (spec §4D). Omitted when unset — the pre-existing behaviour.
      ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
    }));
    return result?.MessageId ?? null;
  }

  private baseUrl(): string {
    const baseUrl = this.config.sesWebBaseUrl;
    if (!baseUrl) throw new Error('WEB_BASE_URL is required for SES email delivery.');
    return httpsUrl(baseUrl, 'WEB_BASE_URL');
  }
}
