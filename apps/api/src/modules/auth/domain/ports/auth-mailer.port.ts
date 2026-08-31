export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export type AuthEmailLinkInput = Readonly<{ toEmail: string; rawToken: string; expiresAt: Date }>;
export type AccountClaimEmailInput = AuthEmailLinkInput & Readonly<{
  companyName: string;
  lineOaAddUrl: string;
}>;

export interface AuthMailerPort {
  sendEmailVerification(input: AuthEmailLinkInput): Promise<void>;
  sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void>;
  /**
   * Returns the provider message id, or null when the provider has none. Only the claim email
   * needs it: it is the join key an SES bounce/complaint event uses to find the signup request
   * (spec §4D). The other two have no recovery path that could use one.
   */
  sendAccountClaim(input: AccountClaimEmailInput): Promise<string | null>;
}
