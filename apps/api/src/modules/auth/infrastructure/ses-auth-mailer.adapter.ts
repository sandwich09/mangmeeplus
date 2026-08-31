import { Inject, Injectable } from '@nestjs/common';
import { SendEmailCommand, type SESClient } from '@aws-sdk/client-ses';
import { AppConfigService } from '../../../common/config/app-config.service';
import type {
  AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort, SignupRejectionEmailInput,
} from '../domain/ports/auth-mailer.port';
import { accountClaimLogoUrl, renderAccountClaimEmail } from './account-claim-email.template';
import { renderSignupRejectionEmail } from './signup-rejection-email.template';

export const SES_EMAIL_CLIENT_TOKEN = 'SES_EMAIL_CLIENT_TOKEN';
type SesEmailClient = Pick<SESClient, 'send'>;
type EmailKind = 'email_verification' | 'password_reset' | 'account_claim' | 'signup_rejection';
type RenderedEmail = Readonly<{ subject: string; text: string; html: string }>;
type SecondaryAction = Readonly<{ label: string; url: string }>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function formatExpiry(value: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(value);
}

function link(baseUrl: string, pathname: string, token: string): string {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function httpsUrl(value: string, field: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${field} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return url.toString();
}

function lineOaUrl(value: string): string {
  const normalized = httpsUrl(value, 'lineOaAddUrl');
  const hostname = new URL(normalized).hostname.toLowerCase();
  if (hostname !== 'lin.ee' && hostname !== 'line.me' && !hostname.endsWith('.line.me')) {
    throw new Error('lineOaAddUrl must use an official LINE host.');
  }
  return normalized;
}

function layout(
  title: string,
  paragraphs: readonly string[],
  actionLabel: string,
  actionUrl: string,
  secondary?: SecondaryAction,
): string {
  const safeParagraphs = paragraphs.map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`).join('');
  const secondaryHtml = secondary
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(secondary.url)}" style="color:#13795b;font-size:17px;font-weight:700">${escapeHtml(secondary.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="th"><body style="margin:0;background:#f4f7f5;color:#17352b;font-family:Arial,sans-serif"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border-radius:16px;padding:28px"><h1 style="font-size:24px;line-height:1.4;margin:0 0 20px">${escapeHtml(title)}</h1><div style="font-size:18px;line-height:1.7">${safeParagraphs}<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#13795b;color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:14px 22px;border-radius:10px">${escapeHtml(actionLabel)}</a></p><p style="margin:0;color:#53665f;font-size:15px">หากปุ่มเปิดไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br><span style="word-break:break-all">${escapeHtml(actionUrl)}</span></p>${secondaryHtml}</div></section></main></body></html>`;
}

function renderLinkEmail(input: AuthEmailLinkInput, baseUrl: string, kind: Exclude<EmailKind, 'account_claim'>): RenderedEmail {
  const expires = formatExpiry(input.expiresAt);
  if (kind === 'email_verification') {
    const actionUrl = link(baseUrl, '/verify-email', input.rawToken);
    const paragraphs = [`อีเมลที่ต้องการยืนยัน: ${input.toEmail}`, `ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุ ${expires} น.`];
    return {
      subject: 'ยืนยันอีเมลสำหรับบัญชี Mangmee',
      text: `ยืนยันอีเมลสำหรับบัญชี Mangmee\n\n${paragraphs.join('\n')}\n\nเปิดลิงก์: ${actionUrl}`,
      html: layout('ยืนยันอีเมลสำหรับบัญชี Mangmee', paragraphs, 'ยืนยันอีเมล', actionUrl),
    };
  }
  const actionUrl = link(baseUrl, '/reset-password', input.rawToken);
  const paragraphs = [`บัญชี: ${input.toEmail}`, `ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุ ${expires} น.`, 'หากคุณไม่ได้ขอเปลี่ยนรหัสผ่าน ไม่ต้องดำเนินการใด ๆ'];
  return {
    subject: 'ตั้งรหัสผ่าน Mangmee ใหม่',
    text: `ตั้งรหัสผ่าน Mangmee ใหม่\n\n${paragraphs.join('\n')}\n\nเปิดลิงก์: ${actionUrl}`,
    html: layout('ตั้งรหัสผ่าน Mangmee ใหม่', paragraphs, 'ตั้งรหัสผ่านใหม่', actionUrl),
  };
}

/**
 * SES configuration set that publishes delivery/bounce/complaint events to SNS. Read from the
 * environment rather than `AppConfigService` for the same reason `accountClaimLogoUrl` is: it is a
 * per-environment operational name with a safe absent default, and adding it to the shared config
 * schema would touch a package every app boots. Absent = the send carries no configuration set,
 * exactly the behaviour before this existed.
 */
export function sesConfigurationSet(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SES_CONFIGURATION_SET?.trim() || undefined;
}

function renderClaimEmail(input: AccountClaimEmailInput, baseUrl: string): RenderedEmail {
  return renderAccountClaimEmail({
    companyName: input.companyName,
    toEmail: input.toEmail,
    expiresAt: input.expiresAt,
    claimUrl: link(baseUrl, '/claim-account', input.rawToken),
    // An unset OA link drops the add-friend line rather than failing the send (see the template).
    lineOaAddUrl: input.lineOaAddUrl ? lineOaUrl(input.lineOaAddUrl) : '',
    ...(accountClaimLogoUrl() ? { logoUrl: accountClaimLogoUrl()! } : {}),
  });
}

@Injectable()
export class SesAuthMailerAdapter implements AuthMailerPort {
  constructor(
    private readonly config: AppConfigService,
    @Inject(SES_EMAIL_CLIENT_TOKEN) private readonly client: SesEmailClient,
  ) {}

  async sendEmailVerification(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'email_verification', renderLinkEmail(input, this.baseUrl(), 'email_verification'));
  }

  async sendPasswordResetLink(input: AuthEmailLinkInput): Promise<void> {
    await this.send(input.toEmail, 'password_reset', renderLinkEmail(input, this.baseUrl(), 'password_reset'));
  }

  async sendAccountClaim(input: AccountClaimEmailInput): Promise<string | null> {
    return this.send(input.toEmail, 'account_claim', renderClaimEmail(input, this.baseUrl()));
  }

  // No `baseUrl()` here on purpose: the rejection letter carries no link, so a missing WEB_BASE_URL
  // must not be the reason an applicant never hears back.
  async sendSignupRejection(input: SignupRejectionEmailInput): Promise<void> {
    await this.send(input.toEmail, 'signup_rejection', renderSignupRejectionEmail({
      companyName: input.companyName,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(accountClaimLogoUrl() ? { logoUrl: accountClaimLogoUrl()! } : {}),
    }));
  }

  private async send(toEmail: string, kind: EmailKind, rendered: RenderedEmail): Promise<string | null> {
    const fromAddress = this.config.sesFromAddress;
    if (!fromAddress) throw new Error('SES_FROM_ADDRESS is required for SES email delivery.');
    const configurationSet = sesConfigurationSet();
    const result = await this.client.send(new SendEmailCommand({
      Source: fromAddress,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: { Charset: 'UTF-8', Data: rendered.subject },
        Body: {
          Text: { Charset: 'UTF-8', Data: rendered.text },
          Html: { Charset: 'UTF-8', Data: rendered.html },
        },
      },
      Tags: [{ Name: 'message_type', Value: kind }],
      // Without this the account has no event destination for the send, so a hard bounce is
      // invisible to the product (spec §4D). Omitted when unset — the pre-existing behaviour.
      ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
    }));
    return result?.MessageId ?? null;
  }

  private baseUrl(): string {
    const baseUrl = this.config.sesWebBaseUrl;
    if (!baseUrl) throw new Error('WEB_BASE_URL is required for SES email delivery.');
    return httpsUrl(baseUrl, 'WEB_BASE_URL');
  }
}
