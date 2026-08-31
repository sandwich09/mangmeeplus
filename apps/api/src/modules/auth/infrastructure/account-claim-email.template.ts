/**
 * Owner-locked copy for the single Flow B email (P10 §4D: this flow sends exactly one email, and
 * only to an applicant an admin already approved). Shared by the SES and local-console adapters so
 * the two can never drift — the console adapter prints this same text in local development.
 *
 * Two Owner rules are enforced by `account-claim-email.template.spec.ts` rather than by convention:
 *   1. No plus-sign character anywhere in user-facing copy — write "และ" instead.
 *   2. No password, no temporary password and no personal QR/token beyond the one claim link.
 */

export type RenderedEmail = Readonly<{ subject: string; text: string; html: string }>;

export type AccountClaimCopyInput = Readonly<{
  companyName: string;
  toEmail: string;
  expiresAt: Date;
  /** Fully-built claim URL. The caller owns URL policy (SES demands HTTPS; local console does not). */
  claimUrl: string;
  /** Optional masthead image, only ever an HTTPS URL. See `accountClaimLogoUrl()`. */
  logoUrl?: string;
}>;

export const ACCOUNT_CLAIM_SUBJECT =
  'ยินดีต้อนรับสู่มั่งมีพลัส (MangmeePlus) – ข้อมูลสำหรับเข้าใช้งานระบบ';

const CLAIM_TTL_HOURS_LABEL = '72 ชั่วโมง';
const SUPPORT_EMAIL = 'contact@mangmeeplus.com';
const COMPANY_LEGAL_NAME = 'บริษัท มั่งมียั่งยืน จำกัด';
const COMPANY_PHONE = 'โทร. 098-256-5628';
const COMPANY_SITE = 'https://official.mangmeeplus.com';
const COMPANY_SITE_LABEL = 'official.mangmeeplus.com';
const COMPANY_TAGLINE = 'ให้ธุรกิจของคุณ มั่งมี ไปด้วยกัน';

// Owner order 2026-08-31: the trial-benefits block and the LINE-invitation block were removed from
// this letter on purpose — package terms and the LINE step are communicated in-app, never by email.
// Do not re-add either section here.

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

/**
 * Optional brand masthead. Read from the environment rather than `AppConfigService` on purpose:
 * it is presentation-only, has a safe empty default, and adding it to the shared config schema
 * would touch a package every app boots. A non-HTTPS or malformed value is ignored, not thrown —
 * a broken logo must never block an approved applicant's only email.
 */
export function accountClaimLogoUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.EMAIL_LOGO_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function renderAccountClaimEmail(input: AccountClaimCopyInput): RenderedEmail {
  const expires = formatExpiry(input.expiresAt);

  const text = [
    'เรียน คุณลูกค้าคนพิเศษ',
    '',
    'ขอขอบพระคุณที่ท่านให้ความไว้วางใจสมัครใช้งานระบบมั่งมีพลัส (MangmeePlus)',
    'ขณะนี้คำขอเปิดใช้งานของท่านได้รับการอนุมัติแล้ว ท่านสามารถเริ่มต้นใช้งานได้ทันทีตามขั้นตอนด้านล่างนี้',
    '',
    '[ เข้าสู่ระบบ ]',
    'ตั้งรหัสผ่านและเข้าสู่ระบบที่ลิงก์นี้:',
    input.claimUrl,
    '',
    `[ บัญชีสำหรับเข้าใช้งานร้าน ${input.companyName} ]`,
    `อีเมลผู้ใช้งาน: ${input.toEmail}`,
    'รหัสผ่าน: ท่านเป็นผู้กำหนดด้วยตนเองในขั้นตอนตั้งรหัสผ่าน ระบบไม่มีการส่งรหัสผ่านชั่วคราวทางอีเมล',
    '',
    '[ หมายเหตุ ]',
    `ลิงก์นี้ใช้ได้ครั้งเดียว และมีอายุ ${CLAIM_TTL_HOURS_LABEL} (หมดอายุ ${expires} น.)`,
    'รหัสผ่านนี้ใช้สำหรับเข้าเว็บมั่งมีพลัส ไม่ใช่รหัสผ่านของ LINE',
    `หากมีข้อสงสัย ติดต่อ ${SUPPORT_EMAIL}`,
    '',
    'ขอแสดงความนับถือ',
    COMPANY_LEGAL_NAME,
    COMPANY_PHONE,
    `เว็บไซต์ ${COMPANY_SITE}`,
    COMPANY_TAGLINE,
  ].join('\n');

  return { subject: ACCOUNT_CLAIM_SUBJECT, text, html: renderHtml(input, expires) };
}

function renderHtml(input: AccountClaimCopyInput, expires: string): string {
  const claimUrl = escapeHtml(input.claimUrl);
  // Owner 2026-08-31: the logo lives INSIDE the signature block — between the website line and the
  // tagline — not as a top masthead.
  const signatureLogo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="มั่งมีพลัส" height="40" style="display:block;height:40px;max-width:100%;border:0;margin:10px 0">`
    : '';
  return `<!doctype html><html lang="th"><body style="margin:0;background:#f4f7f5;color:#17352b;font-family:Arial,sans-serif">`
    + `<main style="max-width:600px;margin:0 auto;padding:32px 20px">`
    + `<section style="background:#fff;border-radius:16px;padding:28px;font-size:17px;line-height:1.7">`
    + `<p style="margin:0 0 16px">เรียน คุณลูกค้าคนพิเศษ</p>`
    + `<p style="margin:0 0 16px">ขอขอบพระคุณที่ท่านให้ความไว้วางใจสมัครใช้งานระบบมั่งมีพลัส (MangmeePlus)<br>`
    + `ขณะนี้คำขอเปิดใช้งานของท่านได้รับการอนุมัติแล้ว ท่านสามารถเริ่มต้นใช้งานได้ทันทีตามขั้นตอนด้านล่างนี้</p>`
    + section('เข้าสู่ระบบ')
    + `<p style="margin:0 0 16px"><a href="${claimUrl}" style="display:inline-block;background:#13795b;color:#fff;text-decoration:none;font-size:18px;font-weight:700;padding:14px 22px;border-radius:10px">ตั้งรหัสผ่านและเข้าสู่ระบบ</a></p>`
    + `<p style="margin:0 0 20px;color:#53665f;font-size:15px">หากปุ่มเปิดไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br><span style="word-break:break-all">${claimUrl}</span></p>`
    // Owner 2026-08-31: label bold black, the shop name itself green.
    + `<h2 style="font-size:18px;margin:0 0 10px;color:#17352b">บัญชีสำหรับเข้าใช้งานร้าน <span style="color:#13795b">${escapeHtml(input.companyName)}</span></h2>`
    + `<p style="margin:0 0 8px">อีเมลผู้ใช้งาน: ${escapeHtml(input.toEmail)}</p>`
    + `<p style="margin:0 0 20px">รหัสผ่าน: ท่านเป็นผู้กำหนดด้วยตนเองในขั้นตอนตั้งรหัสผ่าน ระบบไม่มีการส่งรหัสผ่านชั่วคราวทางอีเมล</p>`
    + section('หมายเหตุ')
    + `<ul style="margin:0 0 20px;padding-left:20px">`
    + `<li style="margin:0 0 6px">ลิงก์นี้ใช้ได้ครั้งเดียว และมีอายุ ${CLAIM_TTL_HOURS_LABEL} (หมดอายุ ${escapeHtml(expires)} น.)</li>`
    + `<li style="margin:0 0 6px">รหัสผ่านนี้ใช้สำหรับเข้าเว็บมั่งมีพลัส ไม่ใช่รหัสผ่านของ LINE</li>`
    + `<li style="margin:0 0 6px">หากมีข้อสงสัย ติดต่อ <a href="mailto:${SUPPORT_EMAIL}" style="color:#13795b">${SUPPORT_EMAIL}</a></li>`
    + `</ul>`
    + `<p style="margin:24px 0 0;color:#53665f;font-size:15px">ขอแสดงความนับถือ<br><strong style="color:#17352b">${COMPANY_LEGAL_NAME}</strong><br>${COMPANY_PHONE}<br>`
    + `เว็บไซต์ <a href="${COMPANY_SITE}" style="color:#13795b;font-weight:700;text-decoration:none">${COMPANY_SITE_LABEL}</a></p>`
    + signatureLogo
    + `<p style="margin:0;color:#53665f;font-size:15px">${COMPANY_TAGLINE}</p>`
    + `</section></main></body></html>`;
}

function section(title: string): string {
  return `<h2 style="font-size:18px;margin:0 0 10px;color:#13795b">${escapeHtml(title)}</h2>`;
}
