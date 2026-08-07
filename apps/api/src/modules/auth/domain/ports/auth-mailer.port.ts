export const AUTH_MAILER_TOKEN = 'AUTH_MAILER_TOKEN';

export interface AuthMailerPort {
  sendEmailVerification(input: { toEmail: string; rawToken: string; expiresAt: Date }): Promise<void>;
  sendPasswordResetLink(input: { toEmail: string; rawToken: string; expiresAt: Date }): Promise<void>;
}
