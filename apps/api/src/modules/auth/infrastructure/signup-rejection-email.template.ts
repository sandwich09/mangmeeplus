/**
 * Spec §4D: rejecting an application is silent by default — the address is still unproven, so an
 * unsolicited notice would make the platform a spam cannon. An admin may opt in per case, and this
 * is the letter that goes out then.
 *
 * Same structure, section helper and signature block as `account-claim-email.template.ts`; the two
 * are the only mail an applicant can ever receive, and they must read as one voice.
 *
 * Owner rules, asserted in the spec rather than left to convention:
 *   1. No plus-sign character anywhere in user-facing copy — write "และ".
 *   2. The internal review reason is never disclosed; only the admin's own paragraph, when written.
 */

import type { RenderedEmail } from './account-claim-email.template';

export type SignupRejectionCopyInput = Readonly<{
  companyName: string;
  /** Admin-written, optional, plain text. Omitted entirely when the admin left it blank. */
  reason?: string;
  /** Optional masthead, only ever an HTTPS URL. See `accountClaimLogoUrl()`. */
  logoUrl?: string;
}>;

export const SIGNUP_REJECTION_SUBJECT = 'ผลการพิจารณาคำขอสมัครใช้งานมั่งมีพลัส (MangmeePlus)';

const SUPPORT_EMAIL = 'contact@mangmeeplus.com';
const COMPANY_LEGAL_NAME = 'บริษัท มั่งมียั่งยืน จำกัด';
const COMPANY_PHONE = 'โทร. 098-256-5628';
const COMPANY_SITE = 'https://mangmeeplus.com';
const COMPANY_SITE_LABEL = 'mangmeeplus.com';
const COMPANY_TAGLINE = 'ให้ธุรกิจของคุณ มั่งมี ไปด้วยกัน';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** Collapses the admin's free text to plain paragraphs; blank input means "no reason section". */
function reasonParagraphs(reason: string | undefined): string[] {
  return (reason ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function renderSignupRejectionEmail(input: SignupRejectionCopyInput): RenderedEmail {
  const reason = reasonParagraphs(input.reason);

  const text = [
    'เรียน ผู้สมัครใช้งานระบบมั่งมีพลัส',
    '',
    `ขอขอบพระคุณที่ท่านให้ความสนใจและสมัครใช้งานระบบมั่งมีพลัส (MangmeePlus) ในนามของ ${input.companyName}`,
    '',
    '[ ผลการพิจารณา ]',
    'ขณะนี้คำขอของท่านยังไม่ได้รับการอนุมัติในรอบนี้',
    ...(reason.length ? ['', '[ ข้อมูลเพิ่มเติมจากทีมงาน ]', ...reason] : []),
    '',
    '[ หากต้องการพูดคุยเพิ่มเติม ]',
    `ทีมงานยินดีให้คำแนะนำ ติดต่อได้ที่ ${COMPANY_PHONE} หรืออีเมล ${SUPPORT_EMAIL}`,
    '',
    'ขอแสดงความนับถือ',
    COMPANY_LEGAL_NAME,
    COMPANY_PHONE,
    `เว็บไซต์ ${COMPANY_SITE}`,
    COMPANY_TAGLINE,
  ].join('\n');

  return { subject: SIGNUP_REJECTION_SUBJECT, text, html: renderHtml(input, reason) };
}

function renderHtml(input: SignupRejectionCopyInput, reason: readonly string[]): string {
  const masthead = input.logoUrl
    ? `<p style="margin:0 0 20px"><img src="${escapeHtml(input.logoUrl)}" alt="มั่งมีพลัส" height="40" style="height:40px;max-width:100%;border:0"></p>`
    : '';

  return `<!doctype html><html lang="th"><body style="margin:0;background:#f4f7f5;color:#17352b;font-family:Arial,sans-serif">`
    + `<main style="max-width:600px;margin:0 auto;padding:32px 20px">`
    + `<section style="background:#fff;border-radius:16px;padding:28px;font-size:17px;line-height:1.7">`
    + masthead
    + `<p style="margin:0 0 16px">เรียน ผู้สมัครใช้งานระบบมั่งมีพลัส</p>`
    + `<p style="margin:0 0 16px">ขอขอบพระคุณที่ท่านให้ความสนใจและสมัครใช้งานระบบมั่งมีพลัส (MangmeePlus) `
    + `ในนามของ ${escapeHtml(input.companyName)}</p>`
    + section('ผลการพิจารณา')
    + `<p style="margin:0 0 20px">ขณะนี้คำขอของท่านยังไม่ได้รับการอนุมัติในรอบนี้</p>`
    + (reason.length
      ? section('ข้อมูลเพิ่มเติมจากทีมงาน')
        + reason.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join('')
      : '')
    + section('หากต้องการพูดคุยเพิ่มเติม')
    + `<p style="margin:0 0 20px">ทีมงานยินดีให้คำแนะนำ ติดต่อได้ที่ ${COMPANY_PHONE} หรืออีเมล `
    + `<a href="mailto:${SUPPORT_EMAIL}" style="color:#13795b">${SUPPORT_EMAIL}</a></p>`
    + `<p style="margin:24px 0 0;color:#53665f;font-size:15px">ขอแสดงความนับถือ<br><strong style="color:#17352b">${COMPANY_LEGAL_NAME}</strong><br>${COMPANY_PHONE}<br>`
    + `เว็บไซต์ <a href="${COMPANY_SITE}" style="color:#13795b;font-weight:700;text-decoration:none">${COMPANY_SITE_LABEL}</a><br>${COMPANY_TAGLINE}</p>`
    + `</section></main></body></html>`;
}

function section(title: string): string {
  return `<h2 style="font-size:18px;margin:0 0 10px;color:#13795b">${escapeHtml(title)}</h2>`;
}
