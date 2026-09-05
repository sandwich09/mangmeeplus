import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type {
  AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort, LineSignupWelcomeEmailInput,
  PackageChangeNoticeEmailInput, SignupRejectionEmailInput, SupportRequestNoticeEmailInput,
} from '../domain/ports/auth-mailer.port';
import { renderAccountClaimEmail } from './account-claim-email.template';
import { renderSignupRejectionEmail } from './signup-rejection-email.template';

@Injectable()
export class LocalConsoleAuthMailerAdapter implements AuthMailerPort {
  constructor(private readonly config: AppConfigService) {}

  async sendEmailVerification(input: AuthEmailLinkInput): Promise<void> {
    console.info('[auth-mailer] email_verification', {
      toEmail: input.toEmail,
      expiresAt: input.expiresAt.toISOString(),
      verificationUrl: this.buildUrl('/verify-email', input.rawToken),
    });
  }

  async sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void> {
    console.info('[auth-mailer] password_reset', {
      toEmail: input.toEmail,
      expiresAt: input.expiresAt.toISOString(),
      resetUrl: this.buildUrl('/reset-password', input.rawToken),
    });
  }

  // Renders the same Owner-locked copy SES sends, so a local run shows the real letter rather
  // than a field dump — the subject and body here and in production come from one module.
  async sendAccountClaim(input: AccountClaimEmailInput): Promise<string | null> {
    const claimUrl = this.buildUrl('/claim-account', input.rawToken);
    const rendered = renderAccountClaimEmail({
      companyName: input.companyName,
      toEmail: input.toEmail,
      expiresAt: input.expiresAt,
      claimUrl,
    });
    console.info('[auth-mailer] account_claim', {
      toEmail: input.toEmail,
      companyName: input.companyName,
      expiresAt: input.expiresAt.toISOString(),
      claimUrl,
      subject: rendered.subject,
      body: rendered.text,
    });
    // No provider, so no message id — the bounce feedback path is SES-only (spec §4D).
    return null;
  }

  async sendSignupRejection(input: SignupRejectionEmailInput): Promise<void> {
    const rendered = renderSignupRejectionEmail({
      companyName: input.companyName,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    console.info('[auth-mailer] signup_rejection', {
      toEmail: input.toEmail,
      companyName: input.companyName,
      subject: rendered.subject,
      body: rendered.text,
    });
  }

  // H-02 hooks. There is no letter to render yet — the Thai copy for both is Owner-owned and not
  // in the spec §7 message table — so a local run just shows that the hook fired and with what.
  async sendLineSignupWelcome(input: LineSignupWelcomeEmailInput): Promise<void> {
    console.info('[auth-mailer] line_signup_welcome', { toEmail: input.toEmail, companyName: input.companyName });
  }

  async sendPackageChangeNotice(input: PackageChangeNoticeEmailInput): Promise<void> {
    console.info('[auth-mailer] package_change_notice', {
      toEmail: input.toEmail, companyName: input.companyName, tierKey: input.tierKey,
    });
  }

  // A console IS the local mailbox: a developer reading this log has been told, so `true` is the
  // honest answer here in a way it is not for the disabled adapter.
  async sendSupportRequestNotice(input: SupportRequestNoticeEmailInput): Promise<boolean> {
    console.info('[auth-mailer] support_request_notice', {
      toEmail: input.toEmail, who: input.who, actionUrl: input.actionUrl,
      ...(input.lastMessageText ? { lastMessageText: input.lastMessageText } : {}),
    });
    return true;
  }

  private buildUrl(pathname: string, token: string): string {
    const baseUrl = this.config.webBaseUrl ?? 'http://localhost:3000';
    const url = new URL(pathname, baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
