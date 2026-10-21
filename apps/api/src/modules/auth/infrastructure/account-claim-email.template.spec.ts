import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CLAIM_SUBJECT,
  accountClaimLogoUrl,
  renderAccountClaimEmail,
} from './account-claim-email.template';
import {
  SIGNUP_REJECTION_SUBJECT,
  renderSignupRejectionEmail,
} from './signup-rejection-email.template';

const INPUT = {
  companyName: 'ร้านมั่งมี',
  toEmail: 'somchai@example.com',
  expiresAt: new Date('2026-09-03T10:00:00.000Z'),
  claimUrl: 'https://app.mangmeeplus.com/claim-account?token=abc123',
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
      'ขอแสดงความนับถือ',
      'บริษัท มั่งมียั่งยืน จำกัด',
      'โทร. 098-256-5628',
      'เว็บไซต์ https://mangmeeplus.com',
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
    assert.ok(html.includes('>mangmeeplus.com</a>'));
    assert.ok(!html.includes('>https://mangmeeplus.com</a>'));
  });

  it('splits the opening line and closes it with ด้านล่างนี้ (Owner 2026-08-31)', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    assert.ok(text.includes('ตามขั้นตอนด้านล่างนี้'));
    assert.ok(html.includes('(MangmeePlus)<br>'), 'approval sentence starts on its own line');
    assert.ok(html.includes('ตามขั้นตอนด้านล่างนี้'));
  });

  it('places the logo inside the signature between the website line and the tagline', () => {
    const { html } = renderAccountClaimEmail({ ...INPUT, logoUrl: 'https://cdn.example.com/logo.png' });
    const site = html.indexOf('mangmeeplus.com</a>');
    const logo = html.indexOf('<img');
    const tagline = html.indexOf('ให้ธุรกิจของคุณ มั่งมี ไปด้วยกัน');
    assert.ok(site > -1 && logo > -1 && tagline > -1);
    assert.ok(site < logo && logo < tagline, 'order must be website -> logo -> tagline');
    assert.equal((html.match(/<img/g) ?? []).length, 1, 'no top masthead remains');
  });

  it('renders the account heading black with a green shop name; other headings stay green', () => {
    const { html } = renderAccountClaimEmail(INPUT);
    assert.ok(html.includes('color:#17352b">บัญชีสำหรับเข้าใช้งานร้าน <span style="color:#13795b">ร้านมั่งมี</span></h2>'));
    assert.ok(html.includes('color:#13795b">เข้าสู่ระบบ</h2>'));
    assert.ok(html.includes('color:#13795b">หมายเหตุ</h2>'));
  });

  it('states the 72h single-use rule with a Thai-formatted expiry', () => {
    const { text } = renderAccountClaimEmail(INPUT);
    assert.ok(text.includes('ใช้ได้ครั้งเดียว'));
    assert.ok(text.includes('72 ชั่วโมง'));
    // Bangkok time, Thai locale — 10:00 UTC is 17:00 in Bangkok.
    assert.match(text, /หมดอายุ .*17:00 น\./);
  });

  it('carries neither the trial-benefits block nor the LINE invitation (Owner order 2026-08-31)', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    const body = `${text}\n${html}`;
    // Package terms and the LINE step are communicated in-app, never by email. Guard both blocks
    // against quietly coming back.
    for (const banned of ['สิทธิพิเศษ', 'ทดลองใช้ฟรี', 'เชื่อมบัญชี LINE', 'เพิ่มเพื่อน LINE']) {
      assert.equal(body.includes(banned), false, `banned copy present: ${banned}`);
    }
  });

  it('offers the claim link as both a button and a copyable URL', () => {
    const { text, html } = renderAccountClaimEmail(INPUT);
    assert.ok(html.includes('ตั้งรหัสผ่านและเข้าสู่ระบบ'));
    assert.ok(html.includes('หากปุ่มเปิดไม่ได้'));
    assert.equal(html.split(INPUT.claimUrl).length - 1, 2, 'link appears as href and as fallback text');
    assert.ok(text.includes(INPUT.claimUrl));
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

/**
 * The rejection notice is the other letter this flow can send, and it shares this file's rules and
 * signature block. Covered here rather than in a file of its own because `apps/api/package.json`'s
 * test list is explicit — an unregistered spec would silently never run.
 */
describe('signup rejection email copy', () => {
  const REJECT = { companyName: 'ร้านมั่งมี' };

  it('uses the Owner-locked subject', () => {
    assert.equal(SIGNUP_REJECTION_SUBJECT, 'ผลการพิจารณาคำขอสมัครใช้งานมั่งมีพลัส (MangmeePlus)');
    assert.equal(renderSignupRejectionEmail(REJECT).subject, SIGNUP_REJECTION_SUBJECT);
  });

  it('never prints a plus sign in customer-facing copy', () => {
    const { subject, text, html } = renderSignupRejectionEmail({ ...REJECT, reason: 'ข้อมูลไม่ครบ' });
    assert.equal(subject.includes('+'), false);
    assert.equal(text.includes('+'), false);
    assert.equal(html.includes('+'), false);
  });

  it('thanks the applicant, states the outcome, and invites a conversation', () => {
    const { text } = renderSignupRejectionEmail(REJECT);
    for (const section of [
      'เรียน ผู้สมัครใช้งานระบบมั่งมีพลัส',
      'ขอขอบพระคุณ',
      'ร้านมั่งมี',
      '[ ผลการพิจารณา ]',
      'ยังไม่ได้รับการอนุมัติในรอบนี้',
      '[ หากต้องการพูดคุยเพิ่มเติม ]',
      'โทร. 098-256-5628',
      'contact@mangmeeplus.com',
      'ขอแสดงความนับถือ',
    ]) {
      assert.ok(text.includes(section), `missing section: ${section}`);
    }
  });

  it('includes the admin paragraph only when one was written', () => {
    const withReason = renderSignupRejectionEmail({ ...REJECT, reason: 'เอกสารทะเบียนยังไม่ครบ' });
    assert.ok(withReason.text.includes('[ ข้อมูลเพิ่มเติมจากทีมงาน ]'));
    assert.ok(withReason.text.includes('เอกสารทะเบียนยังไม่ครบ'));
    assert.ok(withReason.html.includes('เอกสารทะเบียนยังไม่ครบ'));

    for (const reason of [undefined, '', '   ', '\n\n']) {
      const bare = renderSignupRejectionEmail({ ...REJECT, ...(reason === undefined ? {} : { reason }) });
      assert.equal(bare.text.includes('ข้อมูลเพิ่มเติมจากทีมงาน'), false, `reason=${JSON.stringify(reason)}`);
      assert.equal(bare.html.includes('ข้อมูลเพิ่มเติมจากทีมงาน'), false, `reason=${JSON.stringify(reason)}`);
    }
  });

  it('keeps a multi-line reason as separate paragraphs', () => {
    const { text, html } = renderSignupRejectionEmail({ ...REJECT, reason: 'บรรทัดหนึ่ง\n\nบรรทัดสอง' });
    assert.ok(text.includes('บรรทัดหนึ่ง\nบรรทัดสอง'));
    assert.equal((html.match(/บรรทัด/g) ?? []).length, 2);
  });

  it('renders the same signature block as the claim email', () => {
    const { html, text } = renderSignupRejectionEmail(REJECT);
    assert.ok(html.includes('<strong style="color:#17352b">บริษัท มั่งมียั่งยืน จำกัด</strong>'));
    assert.ok(html.includes('>mangmeeplus.com</a>'));
    assert.ok(!html.includes('>https://mangmeeplus.com</a>'));
    assert.ok(text.includes('เว็บไซต์ https://mangmeeplus.com'));
    assert.ok(text.includes('ให้ธุรกิจของคุณ มั่งมี ไปด้วยกัน'));
  });

  it('carries no link, no token and no password — it closes a request, it opens nothing', () => {
    const { text, html } = renderSignupRejectionEmail({ ...REJECT, reason: 'ข้อมูลไม่ครบ' });
    const body = `${text}\n${html}`;
    assert.equal(/claim-account|reset-password|token=/.test(body), false);
    assert.equal(body.includes('รหัสผ่าน'), false);
    assert.equal(body.includes('QR'), false);
  });

  it('escapes markup in the company name and in the admin paragraph', () => {
    const { html } = renderSignupRejectionEmail({
      companyName: 'ร้าน <script>alert(1)</script>',
      reason: '<img onerror=x>',
    });
    assert.equal(html.includes('<script>'), false);
    assert.equal(html.includes('<img onerror'), false);
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('shows the masthead only when an HTTPS logo is configured', () => {
    assert.equal(renderSignupRejectionEmail(REJECT).html.includes('<img'), false);
    assert.ok(renderSignupRejectionEmail({ ...REJECT, logoUrl: 'https://cdn.example.com/logo.png' }).html.includes('<img'));
  });
});
