export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export type AuthEmailLinkInput = Readonly<{ toEmail: string; rawToken: string; expiresAt: Date }>;
export type AccountClaimEmailInput = AuthEmailLinkInput & Readonly<{
  companyName: string;
}>;

/** Spec §4D: opt-in, per case. No link and no token — this letter closes a request, it opens nothing. */
export type SignupRejectionEmailInput = Readonly<{
  toEmail: string;
  companyName: string;
  /** The admin's own words, when they wrote any. Never the internal review reason. */
  reason?: string;
}>;

export interface AuthMailerPort {
  sendEmailVerification(input: AuthEmailLinkInput): Promise<void>;
  sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void>;
  /**
   * Returns the provider message id, or null when the provider has none. Only the claim email
   * needs it: it is the join key an SES bounce/complaint event uses to find the signup request
   * (spec §4D). The others have no recovery path that could use one.
   */
  sendAccountClaim(input: AccountClaimEmailInput): Promise<string | null>;
  sendSignupRejection(input: SignupRejectionEmailInput): Promise<void>;
}
