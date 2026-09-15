import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { EmailDeliveryService } from '../application/email-delivery.service';
import type { AuthMailerPort, AuthEmailLinkInput, AccountClaimEmailInput, SignupRejectionEmailInput, SupportRequestNoticeEmailInput, LineSignupWelcomeEmailInput, PackageChangeNoticeEmailInput } from '../domain/ports/auth-mailer.port';
import { renderLinkEmail, renderClaimEmail, renderSupportRequestNoticeEmail, httpsUrl, type EmailKind, type RenderedEmail } from './auth-email.templates';
import { renderSignupRejectionEmail } from './signup-rejection-email.template';
import { PostmarkSendError } from './postmark.client';

@Injectable()
export class PostmarkAuthMailerAdapter implements AuthMailerPort {
  readonly provider = 'postmark' as const;
  constructor(private readonly config: AppConfigService, private readonly delivery: EmailDeliveryService, private readonly prisma: PrismaService) {}

  private baseUrl(): string {
    if (!this.config.sesWebBaseUrl) throw new PostmarkSendError('CONFIG', 'missing_web_origin');
    return httpsUrl(this.config.sesWebBaseUrl, 'WEB_BASE_URL');
  }

  private async send(toEmail: string, purpose: EmailKind, content: RenderedEmail, input?: AuthEmailLinkInput): Promise<string> {
    const attempt = input?.sendAttemptId
      ? await this.prisma.client.emailSendAttempt.findUnique({ where: { id: input.sendAttemptId } })
      : await this.delivery.prepare({ purpose, recipient: toEmail, deadlineAt: input?.expiresAt });
    if (!attempt || attempt.recipient !== toEmail.trim().toLowerCase() || attempt.purpose !== purpose ||
        attempt.providerServerId !== this.config.postmarkServerId || attempt.stream !== this.config.postmarkMessageStream) {
      throw new PostmarkSendError('PERMANENT', 'attempt_binding_mismatch');
    }
    return this.delivery.send(attempt, content);
  }

  async sendEmailVerification(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'email_verification', renderLinkEmail(input, this.baseUrl(), 'email_verification'), input);
  }
  async sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'password_reset', renderLinkEmail(input, this.baseUrl(), 'password_reset'), input);
  }
  async sendAccountClaim(input: AccountClaimEmailInput): Promise<string> {
    return this.send(input.toEmail, 'account_claim', renderClaimEmail(input, this.baseUrl()), input);
  }
  async sendSignupRejection(input: SignupRejectionEmailInput): Promise<void> {
    await this.send(input.toEmail, 'signup_rejection', renderSignupRejectionEmail(input));
  }
  async sendSupportRequestNotice(input: SupportRequestNoticeEmailInput): Promise<boolean> {
    await this.send(input.toEmail, 'support_request_notice', renderSupportRequestNoticeEmail(input));
    return true;
  }
  // Existing opt-in notice contracts have no approved copy/verified recipient at signup.
  async sendLineSignupWelcome(_input: LineSignupWelcomeEmailInput): Promise<void> {}
  async sendPackageChangeNotice(_input: PackageChangeNoticeEmailInput): Promise<void> {}
}
