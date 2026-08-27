export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export type AuthEmailLinkInput = Readonly<{ toEmail: string; rawToken: string; expiresAt: Date }>;
export type AccountClaimEmailInput = AuthEmailLinkInput & Readonly<{
  companyName: string;
  lineOaAddUrl: string;
}>;

export interface AuthMailerPort {
  sendEmailVerification(input: AuthEmailLinkInput): Promise<void>;
  sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void>;
  sendAccountClaim(input: AccountClaimEmailInput): Promise<void>;
}
