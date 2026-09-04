import { Injectable } from '@nestjs/common';
import type {
  AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort, LineSignupWelcomeEmailInput,
  PackageChangeNoticeEmailInput, SignupRejectionEmailInput,
} from '../domain/ports/auth-mailer.port';

@Injectable()
export class DisabledAuthMailerAdapter implements AuthMailerPort {
  async sendEmailVerification(_input: AuthEmailLinkInput): Promise<void> {}

  async sendPasswordResetLink(_input: AuthEmailLinkInput): Promise<void> {}

  async sendAccountClaim(_input: AccountClaimEmailInput): Promise<string | null> { return null; }

  async sendSignupRejection(_input: SignupRejectionEmailInput): Promise<void> {}

  async sendLineSignupWelcome(_input: LineSignupWelcomeEmailInput): Promise<void> {}

  async sendPackageChangeNotice(_input: PackageChangeNoticeEmailInput): Promise<void> {}
}
