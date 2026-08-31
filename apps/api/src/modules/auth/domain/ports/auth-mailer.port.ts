export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export type AuthEmailLinkInput = Readonly<{ toEmail: string; rawToken: string; expiresAt: Date }>;
export type AccountClaimEmailInput = AuthEmailLinkInput & Readonly<{
  companyName: string;
  lineOaAddUrl: string;
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
  sendAccountClaim(input: AccountClaimEmailInput): Promise<void>;
  sendSignupRejection(input: SignupRejectionEmailInput): Promise<void>;
}
