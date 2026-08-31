import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type {
  AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort, SignupRejectionEmailInput,
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
      lineOaAddUrl: input.lineOaAddUrl,
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

  private buildUrl(pathname: string, token: string): string {
    const baseUrl = this.config.webBaseUrl ?? 'http://localhost:3000';
    const url = new URL(pathname, baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
