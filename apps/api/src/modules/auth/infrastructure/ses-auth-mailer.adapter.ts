import { Inject, Injectable } from '@nestjs/common';
import { SendEmailCommand, type SESClient } from '@aws-sdk/client-ses';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { AccountClaimEmailInput, AuthEmailLinkInput, AuthMailerPort } from '../domain/ports/auth-mailer.port';

export const SES_EMAIL_CLIENT_TOKEN = 'SES_EMAIL_CLIENT_TOKEN';
type SesEmailClient = Pick<SESClient, 'send'>;
type EmailKind = 'email_verification' | 'password_reset' | 'account_claim';
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

function renderClaimEmail(input: AccountClaimEmailInput, baseUrl: string): RenderedEmail {
  const actionUrl = link(baseUrl, '/claim-account', input.rawToken);
  const lineOaAddUrl = lineOaUrl(input.lineOaAddUrl);
  const expires = formatExpiry(input.expiresAt);
  const paragraphs = [
    `อีเมลที่ใช้สมัคร: ${input.toEmail}`,
    `กิจการ: ${input.companyName}`,
    `ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุ ${expires} น.`,
    'ขั้นตอนนี้ใช้ยืนยันอีเมลและตั้งรหัสผ่าน Mangmee — ไม่ใช่รหัสผ่านของ LINE',
  ];
  const oa = `หลังตั้งรหัสสำเร็จ คุณสามารถเพิ่มเพื่อน LINE มั่งมีได้ที่ ${lineOaAddUrl}`;
  return {
    subject: 'ยืนยันอีเมลและตั้งรหัสผ่าน Mangmee',
    text: `ยืนยันอีเมลและตั้งรหัสผ่าน Mangmee\n\n${paragraphs.join('\n')}\n\nเปิดลิงก์: ${actionUrl}\n\n${oa}`,
    html: layout('ยืนยันอีเมลและตั้งรหัสผ่าน Mangmee', paragraphs, 'ยืนยันอีเมลและตั้งรหัส', actionUrl, {
      label: 'เพิ่มเพื่อน LINE มั่งมีหลังตั้งรหัสสำเร็จ', url: lineOaAddUrl,
    }),
  };
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

  async sendAccountClaim(input: AccountClaimEmailInput): Promise<void> {
    await this.send(input.toEmail, 'account_claim', renderClaimEmail(input, this.baseUrl()));
  }

  private async send(toEmail: string, kind: EmailKind, rendered: RenderedEmail): Promise<void> {
    const fromAddress = this.config.sesFromAddress;
    if (!fromAddress) throw new Error('SES_FROM_ADDRESS is required for SES email delivery.');
    await this.client.send(new SendEmailCommand({
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
    }));
  }

  private baseUrl(): string {
    const baseUrl = this.config.sesWebBaseUrl;
    if (!baseUrl) throw new Error('WEB_BASE_URL is required for SES email delivery.');
    return httpsUrl(baseUrl, 'WEB_BASE_URL');
  }
}
