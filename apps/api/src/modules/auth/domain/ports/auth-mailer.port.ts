export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export type AuthEmailLinkInput = Readonly<{ toEmail: string; rawToken: string; expiresAt: Date }>;
export type AccountClaimEmailInput = AuthEmailLinkInput & Readonly<{
  companyName: string;
  /**
   * R12: rides in the claim URL beside the token, so a link that turns out to be spent or expired
   * still knows which `/signup/status/:id` page to offer its holder — without it the only exit
   * from that dead end was a login the applicant has no password for. Not a secret: the public
   * status endpoint answers a coarse state and nothing about the applicant (spec §3).
   */
  signupRequestId?: string;
}>;

/** Spec §4D: opt-in, per case. No link and no token — this letter closes a request, it opens nothing. */
export type SignupRejectionEmailInput = Readonly<{
  toEmail: string;
  companyName: string;
  /** The admin's own words, when they wrote any. Never the internal review reason. */
  reason?: string;
}>;

/**
 * P10-L §15.3 (H-02). A LINE-first shop has NO address at signup, so both of these are letters the
 * product cannot send yet — they exist as a port seam so the day an address arrives (through the
 * "in case you lose LINE" prompt or the profile page) and a provider is ready, only the adapters
 * change. Every adapter treats them as no-ops today; see each one for why.
 */
export type LineSignupWelcomeEmailInput = Readonly<{ toEmail: string; companyName: string }>;
export type PackageChangeNoticeEmailInput = Readonly<{
  toEmail: string;
  companyName: string;
  tierKey: string;
}>;

/**
 * line-support-request-spec-th §2.2 delta (Owner 2026-09-05). The one letter in this port addressed
 * to US rather than to a customer: operators are not LINE-linked, so the support mailbox is how a
 * waiting customer reaches a person at all. No customer address, no token, no LINE id — a shop
 * name, one line of what they said, and the /system link an operator opens.
 */
export type SupportRequestNoticeEmailInput = Readonly<{
  toEmail: string;
  /** Shop name, or the "ยังไม่ได้เปิดร้าน" label with the applied-for name. Already display-safe. */
  who: string;
  /** ≤200 chars of what the customer last typed, when the assistant kept any. */
  lastMessageText?: string;
  /** Absolute link to the page the operator answers from. */
  actionUrl: string;
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
  sendLineSignupWelcome(input: LineSignupWelcomeEmailInput): Promise<void>;
  sendPackageChangeNotice(input: PackageChangeNoticeEmailInput): Promise<void>;
  /**
   * `true` only when a provider actually accepted the letter. An adapter with no provider answers
   * `false` rather than pretending — this boolean is half of the "nobody was told" alarm, so a
   * polite no-op here would silence exactly the condition it exists to catch.
   */
  sendSupportRequestNotice(input: SupportRequestNoticeEmailInput): Promise<boolean>;
}
