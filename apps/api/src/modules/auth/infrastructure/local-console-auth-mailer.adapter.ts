import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort } from '../domain/ports/auth-mailer.port';

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

  async sendAccountClaim(input: AccountClaimEmailInput): Promise<void> {
    console.info('[auth-mailer] account_claim', {
      toEmail: input.toEmail,
      companyName: input.companyName,
      expiresAt: input.expiresAt.toISOString(),
      claimUrl: this.buildUrl('/claim-account', input.rawToken),
      lineOaAddUrl: input.lineOaAddUrl,
    });
  }

  private buildUrl(pathname: string, token: string): string {
    const baseUrl = this.config.webBaseUrl ?? 'http://localhost:3000';
    const url = new URL(pathname, baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
