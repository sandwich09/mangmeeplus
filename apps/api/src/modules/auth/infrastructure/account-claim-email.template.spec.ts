import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CLAIM_SUBJECT,
  accountClaimLogoUrl,
  renderAccountClaimEmail,
} from './account-claim-email.template';

const INPUT = {
  companyName: 'ร้านมั่งมี',
  toEmail: 'somchai@example.com',
  expiresAt: new Date('2026-09-03T10:00:00.000Z'),
  claimUrl: 'https://app.mangmeeplus.com/claim-account?token=abc123',
  lineOaAddUrl: 'https://lin.ee/mangmee',
};

describe('account claim email copy', () => {
  it('uses the Owner-locked subject', () => {
    assert.equal(ACCOUNT_CLAIM_SUBJECT, 'ยินดีต้อนรับสู่มั่งมีพลัส (MangmeePlus) – ข้อมูลสำหรับเข้าใช้งานระบบ');
    assert.equal(renderAccountClaimEmail(INPUT).subject, ACCOUNT_CLAIM_SUBJECT);
  });

  it('never prints a plus sign in customer-facing copy', () => {
    // Owner rule: write "และ". A '+' that creeps in through a benefit line or a phone number is
    // exactly the kind of thing nobody notices in review, so it is asserted instead.
    const { subject, text, html } = renderAccountClaimEmail(INPUT);
    assert.equal(subject.includes('+'), false);
    assert.equal(text.includes('+'), false);
    // The URLs are the only place a '+' could legitimately appear; none of ours carry one.
    assert.equal(html.includes('+'), false);
  });

  it('carries no password value and no personal QR', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    const body = `${text}\n${html}`;
    // No QR of any kind: the only credential in this email is the one claim link (LINE-ONBOARD-01).
    assert.equal(body.includes('QR'), false);
    // "รหัสผ่าน:" may appear exactly once, and only to say the applicant chooses it themselves.
    // Anything else after that label would be a password value in an inbox.
    const labels = text.match(/รหัสผ่าน:\s*\S+/g) ?? [];
    assert.equal(labels.length, 1);
    assert.ok(labels[0]!.startsWith('รหัสผ่าน: ท่านเป็นผู้กำหนดด้วยตนเอง'));
    // The temporary-password phrase appears only inside its own denial.
    assert.equal((text.match(/รหัสผ่านชั่วคราว/g) ?? []).length, 1);
    assert.ok(text.includes('ระบบไม่มีการส่งรหัสผ่านชั่วคราวทางอีเมล'));
  });

  it('contains every Owner-required section', () => {
    const { text } = renderAccountClaimEmail(INPUT);
    for (const section of [
      'เรียน คุณลูกค้าคนพิเศษ',
      'ขอขอบพระคุณ',
      'ได้รับการอนุมัติแล้ว',
      '[ เข้าสู่ระบบ ]',
      '[ บัญชีสำหรับเข้าใช้งานร้าน ร้านมั่งมี ]',
      '[ หมายเหตุ ]',
      '[ เชื่อมบัญชี LINE ]',
      '[ สิทธิพิเศษสำหรับท่าน ]',
      'ขอแสดงความนับถือ',
      'บริษัท มั่งมียั่งยืน จำกัด',
      'โทร. 098-256-5628',
      'เว็บไซต์ https://official.mangmeeplus.com',
      'ให้ธุรกิจของคุณ มั่งมี ไปด้วยกัน',
      'contact@mangmeeplus.com',
      'ไม่ใช่รหัสผ่านของ LINE',
    ]) {
      assert.ok(text.includes(section), `missing section: ${section}`);
    }
  });

  it('renders the Owner-picked signature: bold legal name and a short site label', () => {
    const { html } = renderAccountClaimEmail(INPUT);
    assert.ok(html.includes('<strong style="color:#17352b">บริษัท มั่งมียั่งยืน จำกัด</strong>'));
    assert.ok(html.includes('>official.mangmeeplus.com</a>'));
    assert.ok(!html.includes('>https://official.mangmeeplus.com</a>'));
  });

  it('states the 72h single-use rule with a Thai-formatted expiry', () => {
    const { text } = renderAccountClaimEmail(INPUT);
    assert.ok(text.includes('ใช้ได้ครั้งเดียว'));
    assert.ok(text.includes('72 ชั่วโมง'));
    // Bangkok time, Thai locale — 10:00 UTC is 17:00 in Bangkok.
    assert.match(text, /หมดอายุ .*17:00 น\./);
  });

  it('lists the PRO trial entitlements the Owner locked', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    assert.ok(text.includes('แพ็กเกจ PRO ทดลองใช้ฟรี 30 วัน'));
    for (const benefit of ['5 สาขา', 'พนักงาน 10 คน', 'อ่านสลิปอัตโนมัติ 100 ใบ/เดือน', 'บันทึกค่าใช้จ่ายและใบเสร็จครบวงจร']) {
      assert.ok(text.includes(benefit), `missing benefit: ${benefit}`);
      assert.ok(html.includes(benefit), `missing benefit in html: ${benefit}`);
    }
  });

  it('offers the claim link as both a button and a copyable URL', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    assert.ok(html.includes('ตั้งรหัสผ่านและเข้าสู่ระบบ'));
    assert.ok(html.includes('หากปุ่มเปิดไม่ได้'));
    assert.equal(html.split(INPUT.claimUrl).length - 1, 2, 'link appears as href and as fallback text');
    assert.ok(text.includes(INPUT.claimUrl));
  });

  it('drops the add-friend line rather than failing when no OA link is configured', () => {
    const { text, html } = renderAccountClaimEmail({ ...INPUT, lineOaAddUrl: '' });
    // The section survives — the in-app LINE step still happens — but the dead link does not.
    assert.ok(text.includes('[ เชื่อมบัญชี LINE ]'));
    assert.equal(text.includes('เพิ่มเพื่อน LINE มั่งมีพลัส:'), false);
    assert.equal(html.includes('เพิ่มเพื่อน LINE มั่งมีพลัส'), false);
  });

  it('escapes a company name that contains markup', () => {
    const { html } = renderAccountClaimEmail({ ...INPUT, companyName: 'ร้าน <script>alert(1)</script>' });
    assert.equal(html.includes('<script>'), false);
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('includes the masthead only when an HTTPS logo is configured', () => {
    assert.equal(accountClaimLogoUrl({} as NodeJS.ProcessEnv), undefined);
    assert.equal(accountClaimLogoUrl({ EMAIL_LOGO_URL: '  ' } as NodeJS.ProcessEnv), undefined);
    // A plaintext or malformed URL is ignored rather than thrown — the email still goes out.
    assert.equal(accountClaimLogoUrl({ EMAIL_LOGO_URL: 'http://cdn/logo.png' } as NodeJS.ProcessEnv), undefined);
    assert.equal(accountClaimLogoUrl({ EMAIL_LOGO_URL: 'not a url' } as NodeJS.ProcessEnv), undefined);
    assert.equal(
      accountClaimLogoUrl({ EMAIL_LOGO_URL: 'https://cdn.example.com/logo.png' } as NodeJS.ProcessEnv),
      'https://cdn.example.com/logo.png',
    );

    assert.equal(renderAccountClaimEmail(INPUT).html.includes('<img'), false);
    assert.ok(renderAccountClaimEmail({ ...INPUT, logoUrl: 'https://cdn.example.com/logo.png' }).html.includes('<img'));
  });
});
