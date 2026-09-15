import type { AccountClaimEmailInput, AuthEmailLinkInput, SupportRequestNoticeEmailInput } from '../domain/ports/auth-mailer.port';
import { accountClaimLogoUrl, renderAccountClaimEmail } from './account-claim-email.template';

export type EmailKind = 'email_verification' | 'password_reset' | 'account_claim' | 'signup_rejection'
  | 'support_request_notice';
export type RenderedEmail = Readonly<{ subject: string; text: string; html: string }>;
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

function link(baseUrl: string, pathname: string, token: string, signupRequestId?: string): string {
  const url = new URL(pathname, baseUrl);
  // Active email proofs stay out of HTTP request URLs; legacy mail stays readable.
  if (pathname === '/claim-account' || pathname === '/verify-email' || pathname === '/reset-password') url.hash = new URLSearchParams({ token }).toString();
  else url.searchParams.set('token', token);
  // R12: the claim page's non-secret recovery reference.
  if (signupRequestId) url.searchParams.set('r', signupRequestId);
  return url.toString();
}

export function httpsUrl(value: string, field: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${field} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return url.toString();
}

export function renderBillingStatusEmail(companyName: string, href: string): RenderedEmail {
  const title = 'อัปเดตแพ็กเกจมั่งมี', paragraphs = [`บริษัท ${companyName} มีการอัปเดตแพ็กเกจ`,
    'เปิดหน้าบริษัทเพื่อตรวจสอบสิทธิ์ วันต่ออายุ และเอกสารการชำระเงินจาก Stripe'];
  return { subject: title, text: `${title}\n\n${paragraphs.join('\n')}\n\n${href}`,
    html: layout(title, paragraphs, 'ดูแพ็กเกจและประวัติการชำระเงิน', href) };
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

export function renderLinkEmail(input: AuthEmailLinkInput, baseUrl: string, kind: Exclude<EmailKind, 'account_claim'>): RenderedEmail {
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

/** Internal letter, so Thai plain copy and the existing `layout` — no new template module. */
export function renderSupportRequestNoticeEmail(input: SupportRequestNoticeEmailInput): RenderedEmail {
  const title = 'ลูกค้าขอคุยกับเจ้าหน้าที่';
  const paragraphs = [
    `ผู้ขอ: ${input.who}`,
    ...(input.lastMessageText ? [`ข้อความล่าสุด: ${input.lastMessageText}`] : []),
    'เปิดหน้าคำขอในระบบเพื่อดูรายละเอียดและตอบกลับได้เลยค่ะ',
  ];
  return {
    subject: `[มั่งมี Plus] ${title}: ${input.who}`,
    text: `${title}\n\n${paragraphs.join('\n')}\n\nเปิดลิงก์: ${input.actionUrl}`,
    html: layout(title, paragraphs, 'เปิดคำขอ', input.actionUrl),
  };
}

export function renderClaimEmail(input: AccountClaimEmailInput, baseUrl: string): RenderedEmail {
  return renderAccountClaimEmail({
    companyName: input.companyName,
    toEmail: input.toEmail,
    expiresAt: input.expiresAt,
    claimUrl: link(baseUrl, '/claim-account', input.rawToken, input.signupRequestId),
    ...(accountClaimLogoUrl() ? { logoUrl: accountClaimLogoUrl()! } : {}),
  });
}
