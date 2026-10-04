import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { reimbursementPayoutRoundStatus, THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import { buildReimbursementGuide } from './reimbursement-guide.content';
import { buildSubstituteReceiptGuide } from './substitute-receipt-guide.content';
import { buildExpensesGuide } from './expenses-guide.content';
import { buildTaxGuide } from './tax-guide.content';
import { buildReportsGuide } from './reports-guide.content';
import type { UserGuide } from './user-guide.model';

/** Every shortcut a reader is offered, parent action included. */
function links(guide: UserGuide): string[] {
  return [
    ...(guide.primaryLink ? [guide.primaryLink.href] : []),
    ...guide.sections.flatMap((section) =>
      section.blocks.flatMap((block) => (block.kind === 'items'
        ? block.items.flatMap((item) => (item.link ? [item.link.href] : []))
        : []))),
  ];
}

const OWNER = [
  'reimbursement.read_own', 'reimbursement.create', 'reimbursement.approve',
  'reimbursement.finance_review', 'reimbursement.policy.manage',
  'expense.read', 'expense.review', 'expense.confirm', 'company.setup.manage',
  'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'expense.evidence.read',
  'tax.period.read', 'report.catalog.read',
];

describe('user guide shortcuts', () => {
  it('sends each role shortcut to the tab that role actually works in', () => {
    const guide = buildReimbursementGuide('co', OWNER, ['OWNER']);
    const hrefs = links(guide);

    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=mine'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=approvals'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=finance'));
    assert.ok(hrefs.includes('/companies/co/reimbursements?tab=policy'));
  });

  // The staff account is the one that used to be offered ตั้งค่านโยบาย and land on คำขอของฉัน.
  it('offers a staff reader only the tab their session can open', () => {
    const guide = buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']);
    const hrefs = links(guide);

    assert.deepEqual(hrefs, [
      '/companies/co/reimbursements',
      '/companies/co/reimbursements?tab=mine',
      '/companies/co/reimbursements/new',
      // Whoever can file a claim sets where it is paid back (the page asks for the same right).
      '/companies/co/reimbursements/payout-account',
    ]);
    assert.ok(!hrefs.some((href) => href.includes('tab=policy')));
  });

  // Role names are descriptive only: a custom role with the exact permission must receive the
  // same guide shortcut as OWNER/ADMIN, matching the real hub and API guard.
  it('offers the policy tab to any role that holds policy.manage', () => {
    const guide = buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.policy.manage'], ['FINANCE']);
    assert.ok(links(guide).some((href) => href.includes('tab=policy')));
  });

  it('drops every shortcut when the session holds no reimbursement permission', () => {
    const guide = buildReimbursementGuide('co', [], []);
    assert.deepEqual(links(guide), []);
    // The manual itself still renders in full — only the buttons go away.
    assert.equal(guide.sections.length, 21);
  });

  it('gates the substitute-receipt shortcuts on the same keys as the sidebar', () => {
    const owner = links(buildSubstituteReceiptGuide('co', OWNER));
    assert.ok(owner.includes('/companies/co/expenses/substitute-receipts'));
    assert.ok(owner.includes('/companies/co/expenses'));
    assert.ok(owner.includes('/companies/co/settings/substitute-receipt'));

    const reader = links(buildSubstituteReceiptGuide('co', ['expense.read_own']));
    assert.ok(!reader.some((href) => href.includes('/settings/substitute-receipt')));
    assert.equal(buildSubstituteReceiptGuide('co', []).sections.length, 12);
  });

  it('gates the expenses shortcuts on the same keys as the expenses submenu', () => {
    const owner = links(buildExpensesGuide('co', OWNER));
    assert.ok(owner.includes('/companies/co/expenses/upload'));
    assert.ok(owner.includes('/companies/co/expenses/manual'));
    assert.ok(owner.includes('/companies/co/expenses/categories'));
    assert.ok(owner.includes('/companies/co/expenses/evidence'));

    // A staff reader sees the manual in full but is only offered the list they can open.
    const staff = links(buildExpensesGuide('co', ['expense.read_own']));
    assert.deepEqual([...new Set(staff)], ['/companies/co/expenses']);
    assert.equal(buildExpensesGuide('co', []).sections.length, 10);
  });

  it('drops the tax and reports shortcuts for a session without those permissions', () => {
    assert.ok(links(buildTaxGuide('co', OWNER)).includes('/companies/co/tax'));
    assert.deepEqual(links(buildTaxGuide('co', [])), []);
    assert.equal(buildTaxGuide('co', []).sections.length, 6);

    assert.ok(links(buildReportsGuide('co', OWNER)).includes('/companies/co/reports'));
    assert.deepEqual(links(buildReportsGuide('co', [])), []);
    assert.equal(buildReportsGuide('co', []).sections.length, 6);
  });
});

/** Every sentence a reader of the guide is shown. */
function sentences(guide: UserGuide): string[] {
  return [guide.title, guide.eyebrow, guide.description, guide.primaryLink?.label ?? '', ...guide.sections.flatMap((section) => [section.title, section.summary ?? '', ...section.blocks.flatMap((block) => {
    switch (block.kind) {
      case 'items': return block.items.flatMap((item) => [item.title, item.detail, item.link?.label ?? '']);
      case 'steps': return block.steps.flatMap((step) => [step.title, step.detail]);
      case 'table': return [...block.headers, ...block.rows.flat()];
      case 'note': return [block.title, block.detail];
      case 'faq': return block.items.flatMap((item) => [item.question, item.answer]);
    }
  })])];
}

describe('the reimbursement guide reads as the product does', () => {
  const guide = buildReimbursementGuide('co', OWNER, ['OWNER']);
  const read = sentences(guide);

  // approved-product-help.ts (ai-gateway) links the LINE assistant's two claim cards to these sections.
  it('keeps the sections the assistant links to', () => {
    for (const id of ['quick-start', 'tabs']) assert.ok(guide.sections.some((section) => section.id === id), id);
  });

  // The guide's own rule: words in “ ” are on a screen, letter for letter, because readers scan the screen for them.
  it('quotes in “ ” only words the product itself shows', () => {
    const root = join(__dirname, '../../../../..');
    const feature = join(__dirname, '../reimbursements');
    // A comment is not a screen.
    const source = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const claimScreens = readdirSync(feature).filter((name) => /\.tsx?$/.test(name) && !name.includes('.spec.'))
      .map((name) => source(join(feature, name))).join('\n');
    const shown = [claimScreens, ...[
      join(__dirname, '../../common/api/api-error-message.ts'),
      join(__dirname, '../../common/i18n/workspace-dictionary.ts'),
      join(__dirname, '../web-core-workspace/web-core-workspace.logic.ts'),
      join(root, 'packages/contracts/src/reimbursements.ts'),
      // The printed claim form, and the names of the choices on the role page.
      join(root, 'apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts'),
      join(root, 'apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts'),
    ].map(source)].join('\n');
    // A whole label, not letters cut out of a longer Thai phrase: "บันทึกร่าง" is not the button "บันทึกร่างคำขอเบิก".
    const thai = /[฀-๿]/;
    const isShown = (quote: string) => {
      for (let at = shown.indexOf(quote); at !== -1; at = shown.indexOf(quote, at + 1)) {
        if (!thai.test(shown[at - 1] ?? '') && !thai.test(shown[at + quote.length] ?? '')) return true;
      }
      return false;
    };
    const quotes = [...new Set(read.flatMap((text) => [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]!)))];
    assert.ok(quotes.length > 50, 'the guide quotes the screens it describes');
    assert.deepEqual(quotes.filter((quote) => !isShown(quote)), []);
    // The words of a payout round are quoted as the screens say them now: by what the claim holds and by what was answered.
    for (const label of ['รอผู้เบิกเพิ่มบัญชีรับเงิน', 'รอผู้เบิกเลือกวิธีรับเงินคืน', 'รออนุมัติบัญชีรับเงินเดิม', 'รออนุมัติการรับเป็นเงินสด', 'สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่',
      'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง', 'บันทึกวิธีรับเงินคืน', 'สำเนาก่อนส่งกลับ', 'เพิ่มบัญชีรับเงินให้ใบนี้ แล้วให้ผู้อนุมัติตรวจบัญชีนั้น']) {
      assert.ok(quotes.includes(label), label);
    }
    for (const gone of ['สิ่งที่เปลี่ยน: บัญชีรับเงินคืน', 'สำเนาก่อนแก้บัญชีรับเงิน', 'ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน', 'รับเงินคืนทาง: อยู่ระหว่างแก้ไขบัญชีรับเงิน']) {
      assert.equal(quotes.includes(gone), false, gone);
    }
    // The notice to a requester when someone answered a round for them is quoted by the words of its title: what was done
    // (the row's own words of that answer) and "ในใบเบิกของคุณ". The title itself is put together with the person's name.
    for (const titleWord of ['แก้บัญชีรับเงิน', 'ยืนยันบัญชีเดิม', 'เปลี่ยนวิธีรับเงินคืน', 'ในใบเบิกของคุณ']) assert.ok(quotes.includes(titleWord), titleWord);
    const answeredForYou = read.find((text) => text.includes('“ในใบเบิกของคุณ”'))!;
    for (const titleWord of ['“แก้บัญชีรับเงิน”', '“ยืนยันบัญชีเดิม”', '“เปลี่ยนวิธีรับเงินคืน”']) assert.ok(answeredForYou.includes(titleWord), titleWord);
    // A PromptPay number is quoted as the screens call it, beside the words of a bank account.
    for (const label of ['แสดงเบอร์พร้อมเพย์', 'คัดลอกเบอร์พร้อมเพย์', 'ซ่อนเบอร์พร้อมเพย์', 'คุณไม่มีสิทธิ์ดูเบอร์พร้อมเพย์เต็มของใบนี้', 'แสดงเลขบัญชี', 'คัดลอกเลขบัญชี', 'ซ่อนเลขบัญชี']) {
      assert.ok(quotes.includes(label), label);
    }
    // A payment by another method is said of what the claim states, as the screens say it: nobody is named as having asked.
    for (const label of ['เหตุผลที่จ่ายต่างจากที่ระบุในใบ', 'จ่ายต่างจากที่ระบุในใบ', 'วิธีจ่ายต่างจากที่ระบุในใบ กรุณาระบุเหตุผล']) assert.ok(quotes.includes(label), label);
    for (const text of read) assert.doesNotMatch(text, /ที่ผู้เบิกขอ|ผู้เบิกขอรับ/u, text);
  });

  // A round is not only "a wrong account, replaced by another": the status table names each thing a claim in a round waits for.
  it('lists every status a claim in a payout round shows, as its badge says it', () => {
    const statuses = guide.sections.find((section) => section.id === 'status')!.blocks.flatMap((block) => (block.kind === 'table' ? block.rows.map((row) => row[0]) : []));
    for (const answer of [undefined, 'NEW_ACCOUNT', 'SAME_ACCOUNT', 'CASH_INSTEAD', 'ACCOUNT_INSTEAD', 'SAME_CASH', 'FIRST_ACCOUNT', 'FIRST_CASH'] as const) {
      for (const payoutMethod of answer ? [undefined] : ['BANK_TRANSFER', 'CASH', undefined]) {
        const label = reimbursementPayoutRoundStatus({ payoutCorrectionPhase: answer ? 'AWAITING_APPROVAL' : 'AWAITING_REQUESTER', payoutMethod, payoutCorrectionAnswer: answer })!;
        assert.ok(statuses.includes(label), label);
      }
    }
    // No sentence of the guide says the old words of one case for every case.
    for (const text of read) assert.doesNotMatch(text, /ผู้อนุมัติชุดเดิม|อยู่ระหว่างแก้บัญชี|อยู่ระหว่างแก้ไขบัญชี|หลังอนุมัติบัญชีใหม่/u, text);
  });

  // The page itself, as a reader on a phone opens it: every section is folded until it is opened, and a table is a
  // stack of cards below sm. The lines of the final wording pass are on it, in the words the screens use.
  it('shows on the page what the notice of an answer given for you says, and the buttons of a PromptPay number', () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    // The page reaches the icon set; this runner has no SVG loader.
    require.extensions['.svg'] = (module) => { module.exports = () => null; };
    const { UserGuidePage } = require('./UserGuidePage') as typeof import('./UserGuidePage');
    const reactRuntime = require('react') as typeof React;
    const realUseState = reactRuntime.useState;
    const open = ['approve', 'pay', 'account-number', 'account-fix', 'notify', 'faq'];
    // The page's one state is the list of open sections: it starts empty.
    Reflect.set(reactRuntime, 'useState', (initial: unknown) => {
      const [value, set] = (realUseState as (initial: unknown) => [unknown, unknown])(initial);
      return [Array.isArray(initial) && initial.length === 0 ? open : value, set];
    });
    const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test' };
    const page = () => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(UserGuidePage, { guide })));
    let html: string;
    try { html = page(); } finally { Reflect.set(reactRuntime, 'useState', realUseState); }
    const texts = html.replace(/<[^>]*>/gu, '\n').split('\n').map((text) => text.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').trim()).filter(Boolean);
    const ANSWERED_FOR_YOU = 'หัวข้อบอกชื่อคนที่ทำและสิ่งที่ทำ เช่น “แก้บัญชีรับเงิน” “ยืนยันบัญชีเดิม” หรือ “เปลี่ยนวิธีรับเงินคืน” ตามด้วย “ในใบเบิกของคุณ” และเลขที่คำขอ เนื้อความบอกธนาคารและ 4 ตัวท้ายของบัญชี หรือบอกว่ารับเป็นเงินสด และให้เปิดคำขอเพื่อตรวจ';
    // Once in the phone's card and once in the table from sm up: the same sentence.
    assert.equal(texts.filter((text) => text === ANSWERED_FOR_YOU).length, 2);
    // On a phone the sentence is in a card that wraps: no table, no horizontal scroll.
    assert.match(html, new RegExp(`<ul class="flex flex-col gap-2 sm:hidden">[\\s\\S]*?<p class="text-sm leading-6 break-words text-gray-600">${ANSWERED_FOR_YOU}</p>`, 'u'));
    for (const said of ['กด “แสดงเลขบัญชี” หรือ “แสดงเบอร์พร้อมเพย์” เพื่อดูเลขเต็ม', 'ปุ่มคือ “แสดงเบอร์พร้อมเพย์” กับ “คัดลอกเบอร์พร้อมเพย์”', 'บัญชีพร้อมเพย์ใช้ปุ่ม “แสดงเบอร์พร้อมเพย์” และ “ซ่อนเบอร์พร้อมเพย์”',
      'ข้อแรกคือเบอร์พร้อมเพย์ไม่ถูกต้อง', 'ประวัติการจ่ายจะขึ้นป้าย “จ่ายต่างจากที่ระบุในใบ”', 'เมื่อเลือกวิธีรับเงินคืนแล้ว คำขอกลับไปพร้อมจ่ายทันที', 'จะไม่มีแจ้งเตือนถึงผู้เบิก']) {
      assert.ok(texts.some((text) => text.includes(said)), said);
    }
    // Folded, the page shows none of it: a reader opens the section they need.
    assert.equal(page().includes('ในใบเบิกของคุณ'), false);
  });

  // Owner rule: readers are shop staff on a phone. A file type, a file size and the app's own name are all that stays in Latin letters.
  it('is written in plain Thai, with money as "1,234.50 บาท"', () => {
    const latin = [...new Set(read.flatMap((text) => text.match(/[A-Za-z][A-Za-z0-9_.-]*/g) ?? []))];
    assert.deepEqual(latin.filter((word) => !['PDF', 'MB', 'LINE'].includes(word)), []);
    const amounts = read.flatMap((text) => text.match(/\d[\d,.]* บาท/g) ?? []);
    assert.deepEqual(amounts.filter((amount) => !/^\d{1,3}(,\d{3})*\.\d{2} บาท$/.test(amount)), []);
  });
});

it('guide role tables name finance and the read-only auditor as the role picker does', () => {
  const common = ['ฝ่ายบัญชี, ฝ่ายการเงิน, ผู้จัดการ, เจ้าของกิจการ', 'ฝ่ายบัญชี, ฝ่ายการเงิน, เจ้าของกิจการ'];
  const values = (guide: UserGuide) => guide.sections.flatMap((section) => section.blocks.flatMap((block) => block.kind === 'table' ? block.rows.flat() : []));
  assert.ok(values(buildExpensesGuide('co')).includes(common[0]!));
  assert.ok(values(buildReportsGuide('co')).includes(common[0]!));
  assert.ok(values(buildReportsGuide('co')).includes('ฝ่ายบัญชี, ผู้ตรวจสอบ (ดูอย่างเดียว)'));
  assert.ok(values(buildTaxGuide('co')).includes(common[1]!));
  assert.ok(values(buildExpensesGuide('co')).includes('ฝ่ายบัญชีและฝ่ายการเงิน'));
});

it('the claim guide names every standard role as the role picker does', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;
  const guide = buildReimbursementGuide('co');
  const read = sentences(guide);
  const rows = (id: string) => guide.sections.find((section) => section.id === id)!.blocks.flatMap((block) => (block.kind === 'table' ? block.rows : []));
  const holders = (item: string) => rows('permissions').find((row) => row[1] === item)?.[2];
  assert.equal(holders('อนุมัติการเบิก'), `${roles.OWNER} ${roles.ADMIN} ${roles.MANAGER}`);
  assert.equal(holders('ตรวจสอบการเบิก'), `${roles.OWNER} ${roles.ACCOUNTANT}`);
  assert.equal(holders('ตรวจ/จ่ายการเบิก'), `${roles.OWNER} ${roles.FINANCE}`);
  assert.equal(holders('ตั้งนโยบายการเบิก'), `${roles.OWNER} ${roles.ADMIN}`);
  assert.equal(holders('สิทธิ์แก้ไขข้อมูลพนักงาน'), `${roles.OWNER} ${roles.ADMIN} และ${roles.MANAGER}กับ${roles.HR}ในสาขาที่ตนดูแล`);
  assert.equal(rows('tabs').find((row) => row[0] === 'ตั้งค่านโยบาย')?.[1], `${roles.OWNER} และ${roles.ADMIN}`);
  // Default roles can record payment; self-approval is governed by the company switch for all roles.
  const approvers = `${roles.OWNER} ${roles.ADMIN} และ${roles.MANAGER}`;
  for (const part of ['ทำได้อยู่แล้ว บทบาทที่บริษัทสร้างเอง']) {
    assert.ok(read.find((sentence) => sentence.includes(part))?.includes(approvers), part);
  }
  // A role is never called by a word outside the one list ("เจ้าของบัญชี" is the account's owner, not a role).
  for (const text of read) assert.doesNotMatch(text, /แอดมิน|เจ้าของ(?!กิจการ|บัญชี)/u, text);
});

// The claim policy is changed by whoever holds reimbursement.policy.manage: the owner and the company admin by default.
it('the claim guide never says the owner alone changes the claim policy', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;
  const guide = buildReimbursementGuide('co');
  const read = sentences(guide);
  for (const text of read) assert.doesNotMatch(text, new RegExp(`${roles.OWNER}เปิด`, 'u'), text);
  assert.equal(guide.sections.find((section) => section.id === 'policy')!.title, `ตั้งค่านโยบายของบริษัท (สำหรับ${roles.OWNER}และ${roles.ADMIN})`);
  assert.equal(guide.sections.find((section) => section.id === 'finance')!.summary, 'มีเมื่อบริษัทเปิด “ตรวจการเงินก่อนจ่าย” เท่านั้น');
  // What a switch does is said of the company; whom to ask names both holders.
  for (const said of [
    'งานตรวจการเงินมีต่อเมื่อบริษัทเปิด “ตรวจการเงินก่อนจ่าย” ในหน้าตั้งค่านโยบาย',
    `${roles.OWNER}หรือ${roles.ADMIN}เปิด “ตรวจการเงินก่อนจ่าย” ได้ที่หน้าตั้งค่านโยบาย`,
    'เมื่อปิด ไม่มีใครอนุมัติใบเบิกของตัวเองได้ไม่ว่าบทบาทใด',
    'ขอให้ผู้มีสิทธิ์ตั้งค่านโยบายเปิดสวิตช์',
  ]) assert.ok(read.some((text) => text.includes(said)), said);
});

it('the substitute-receipt guide calls the owner by the one name', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;
  const read = sentences(buildSubstituteReceiptGuide('co'));
  // "กิจการเจ้าของคนเดียว" is a kind of business (a sole proprietorship), not a role.
  for (const text of read) assert.doesNotMatch(text, /เจ้าของ(?!กิจการ|คนเดียว)/u, text);
  const said = `${roles.OWNER}ลงนามได้ทั้งในฐานะผู้จ่ายเงินและผู้อนุมัติ`;
  assert.ok(read.some((text) => text.includes(said)), said);
});

// The wizard offers online and paper signing; the signing section covers both, in the words of the screens.
it('the substitute-receipt guide describes paper signing as the screens do', () => {
  const guide = buildSubstituteReceiptGuide('co');
  const text = sentences({ ...guide, sections: guide.sections.filter((section) => section.id === 'sign') }).join('\n');
  const screens = ['SubstituteReceiptWizardPage.tsx', 'SubstitutePaperSigningPanel.tsx']
    .map((name) => readFileSync(join(__dirname, '../expenses', name), 'utf8')).join('\n');
  for (const quote of ['เลือกวิธีลงนาม', 'ลงนามออนไลน์', 'พิมพ์และเซ็นบนกระดาษ', 'ผู้ลงนามทั้งสองส่วนเป็นคนเดียวกัน (ต้องผ่านนโยบายบริษัท)', 'ยื่นฉบับลงนามเพื่อตรวจรับ',
    'ตรวจสอบเอกสารฉบับเต็มและข้อมูลที่ถอดจากกระดาษ', 'หน้าถัดไป', 'อ่านครบทุกหน้าและตรวจเทียบข้อมูลแล้ว', 'ตรวจรับและจัดเก็บฉบับสมบูรณ์']) {
    assert.ok(text.includes(`“${quote}”`), quote);
    assert.ok(screens.includes(quote), `${quote} is on a screen`);
  }
  // In the owner-self mode one person may sign both lines; the certificate says who, not always the owner.
  assert.doesNotMatch(text, /ว่าเจ้าของ(กิจการ)?ลงนามทั้งสองฐานะ/u);
  assert.ok(text.includes('ถ้าคนเดียวลงนามทั้งสองฐานะ ระบบจะระบุไว้ในเอกสาร'), 'one person signing both is noted, whoever it is');
});

describe('shop guides name the company admin for the business permissions it holds', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;

  it('names ADMIN for substitute-receipt settings in the expense guide', () => {
    assert.ok(sentences(buildExpensesGuide('co')).includes(`${roles.OWNER}, ${roles.ADMIN}`));
  });

  it('names ADMIN throughout substitute-receipt setup and preparation', () => {
    const read = sentences(buildSubstituteReceiptGuide('co'));
    for (const expected of [
      `ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะผู้ที่มีสิทธิ์ตั้งค่าบริษัท เช่น ${roles.OWNER}และ${roles.ADMIN}`,
      `ตั้งค่า (สำหรับ${roles.OWNER}และ${roles.ADMIN})`,
      `${roles.OWNER}, ${roles.ADMIN}, ${roles.MANAGER}และ${roles.FINANCE}`,
      `${roles.OWNER}, ${roles.ADMIN}`,
    ]) assert.ok(read.includes(expected), expected);
  });

  // Defaults from ROLE_GRANTS and the route guards: expense.review OWNER/ADMIN/MANAGER/FINANCE; expense.confirm and
  // expense.category.manage OWNER/ADMIN/FINANCE. ACCOUNTANT holds none of them, so no guide names ฝ่ายบัญชี for them.
  it('names who can review, confirm, manage categories and prepare a substitute receipt by default', () => {
    const rows = (guide: UserGuide, id: string) => guide.sections.find((section) => section.id === id)!.blocks.flatMap((block) => (block.kind === 'table' ? block.rows : []));
    const holders = (table: string[][], act: string) => table.find((row) => row[0] === act)?.[2];
    const reviewers = `${roles.OWNER}, ${roles.ADMIN}, ${roles.MANAGER}, ${roles.FINANCE}`;
    const confirmers = `${roles.OWNER}, ${roles.ADMIN}, ${roles.FINANCE}`;
    const expenses = buildExpensesGuide('co');
    assert.equal(holders(rows(expenses, 'overview'), 'รอตรวจสอบ'), `ผู้มีสิทธิ์ตรวจสอบค่าใช้จ่าย เช่น ${reviewers}`);
    assert.equal(holders(rows(expenses, 'overview'), 'พร้อมยืนยัน'), `ผู้มีสิทธิ์ยืนยันค่าใช้จ่าย เช่น ${confirmers}`);
    assert.equal(holders(rows(expenses, 'submenus'), 'หมวดหมู่'), confirmers);
    assert.equal(holders(rows(expenses, 'submenus'), 'ใบรับรองแทนใบเสร็จ'), reviewers);
    assert.equal(holders(rows(expenses, 'permissions'), 'ตรวจความครบถ้วนและยืนยันเอกสาร'), confirmers);
    assert.equal(holders(rows(expenses, 'permissions'), 'เพิ่มหรือแก้ไขหมวดหมู่'), confirmers);
    const categories = sentences({ ...expenses, sections: expenses.sections.filter((section) => section.id === 'categories') });
    for (const text of categories) assert.ok(!text.includes(roles.ACCOUNTANT), text);
    assert.ok(categories.some((text) => text.includes(`ผู้มีสิทธิ์จัดการหมวดหมู่เสมอ เช่น ${roles.OWNER} ${roles.ADMIN} และ${roles.FINANCE}`)));
    // In the designated-approver mode only the listed approvers may approve, the owner included.
    assert.equal(holders(rows(buildSubstituteReceiptGuide('co'), 'permissions'), 'อนุมัติและออกเอกสาร'), `${confirmers} ถ้าบริษัทกำหนดรายชื่อผู้อนุมัติ ต้องเป็นคนในรายชื่อนั้น`);
  });
});

// The guide cannot import API code, so it copies the report words; these checks read the sources and fail on any drift.
describe('the reports guide uses the words the reports page shows', () => {
  const guide = buildReportsGuide('co');
  const root = join(__dirname, '../../../../..');
  const catalogue = readFileSync(join(root, 'apps/api/src/modules/reports/domain/report-catalog.ts'), 'utf8');
  const titles = new Map([...catalogue.matchAll(/code: '([^']+)',\s+version: \d+,\s+title: '([^']+)'/g)].map((match) => [match[1]!, match[2]!]));
  const table = (id: string) => guide.sections.find((section) => section.id === id)!.blocks.flatMap((block) => (block.kind === 'table' ? block.rows : []));

  it('names every report by its catalogue title, in catalogue order', () => {
    assert.equal(titles.size, 18);
    assert.deepEqual(table('catalog').map((row) => row[0]), [...titles.values()]);
  });

  it('gives as examples the column headings those reports really have', () => {
    const adapters = readFileSync(join(root, 'apps/api/src/modules/reports/application/report-source-adapters.ts'), 'utf8');
    const headings = (method: string) => {
      const body = adapters.slice(adapters.indexOf(`private async ${method}(`));
      return [...body.slice(0, body.indexOf('private async ', 1)).matchAll(/\{ key: '\w+', label: '([^']+)', type: '\w+' \}/g)].map((match) => match[1]).join(' · ');
    };
    const detail = sentences(guide).find((text) => text.startsWith('หัวคอลัมน์เปลี่ยนไปตามรายงานที่เลือก'))!;
    assert.ok(detail.includes(`${titles.get('financial.trial_balance')}มีคอลัมน์ ${headings('trialBalanceReport')}`), detail);
    assert.ok(detail.includes(`${titles.get('expense.summary')}มีคอลัมน์ ${headings('expenseSummaryReport')}`), detail);
  });

  it('describes only the result cards the page shows', () => {
    const page = readFileSync(join(__dirname, '../reports/ReportsWorkspacePage.tsx'), 'utf8');
    const cards = [...page.matchAll(/<div className="text-xs font-medium uppercase text-gray-500">([^<]+)<\/div>/g)].map((match) => match[1]);
    assert.ok(cards.length >= 3, 'the page still has result cards');
    assert.deepEqual(table('run').map((row) => row[0]), cards);
  });

  it('shows no English word but the product names kept as they are', () => {
    for (const text of sentences(guide)) assert.doesNotMatch(text.replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g, ''), /[A-Za-z]/, text);
  });

  // The guide's own rule: a word in “ ” is on a screen, letter for letter (or names a section of this guide).
  it('quotes only words the reports page shows', () => {
    const shown = [
      readFileSync(join(__dirname, '../reports/ReportsWorkspacePage.tsx'), 'utf8'),
      readFileSync(join(__dirname, '../reports/reports-ui.logic.ts'), 'utf8'),
      readFileSync(join(__dirname, '../../common/i18n/workspace-dictionary.ts'), 'utf8'),
      ...guide.sections.map((section) => section.title),
    ].join('\n');
    const quotes = [...new Set(sentences(guide).flatMap((text) => [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]!)))];
    assert.ok(quotes.length >= 8, 'the guide quotes the page');
    assert.deepEqual(quotes.filter((quote) => !shown.includes(quote)), []);
  });

  // Untrue before (2026-10-03): runs keep no rows; every run computes afresh (only ภาพรวมการทำงาน reads the dashboard's
  // stored numbers); the page lists every report and marks the ones you cannot open; the export card is
  // “ไฟล์รายงานที่ส่งออก” and does not show who exported; ledger reports cover the selected period only; reports do
  // not follow the top-bar branch choice.
  it('says what the page and the reports really do', () => {
    const text = sentences(guide).join('\n');
    for (const untrue of ['ย้อนกลับไปเปิดผลลัพธ์เดิม', 'ชุดเดิมที่ระบบเก็บไว้', 'แสดงเฉพาะรายงานที่บัญชีของคุณมีสิทธิ์', 'ศูนย์ส่งออกข้อมูล',
      'ว่าใครส่งข้อมูลชุดใด', 'ณ วันสิ้นงวด', 'ใช้กับข้อมูลทั้งบริษัทหรือเฉพาะบางส่วน', 'บริษัทตัวอย่าง', 'ให้ตรงกันก่อนเทียบตัวเลข']) {
      assert.equal(text.includes(untrue), false, untrue);
    }
    for (const fact of ['ไม่ได้เก็บผลลัพธ์', '“ไม่มีสิทธิ์”', '“ไฟล์รายงานที่ส่งออก”', '“ทุกสาขา (รวม)”']) assert.ok(text.includes(fact), fact);
  });
});

describe('shop guide permission help names business roles and separates package access', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;
  const permissionHelp = `ใช้ตารางนี้บอก${roles.OWNER}ว่าต้องการสิทธิ์ใดเพิ่ม`;
  const check = (guide: UserGuide) => {
    for (const sentence of sentences(guide)) assert.ok(!sentence.includes(roles.SYSTEM_ADMIN), sentence);
    assert.equal(guide.sections.find((section) => section.id === 'permissions')!.summary, permissionHelp);
  };

  it('keeps platform roles out of the expense guide and distinguishes a closed menu from missing employee rights', () => {
    const guide = buildExpensesGuide('co');
    check(guide);
    const answer = sentences(guide).find((sentence) => sentence.startsWith('ถ้าเมนูเปิดใช้แล้ว'))!;
    assert.ok(answer, 'explain employee access only after the company menu is enabled');
    for (const text of [roles.OWNER, 'ตรวจแพ็กเกจ', 'ติดต่อทีมงาน']) assert.ok(answer.includes(text), text);
  });

  it('keeps platform roles out of the substitute guide and describes settings access by permission', () => {
    const guide = buildSubstituteReceiptGuide('co', ['company.setup.manage']);
    check(guide);
    const instructions = sentences(guide).find((sentence) => sentence.includes('เปิดได้เฉพาะผู้ที่มีสิทธิ์ตั้งค่าบริษัท'))!;
    assert.ok(instructions, 'a custom role holding company.setup.manage can open settings too');
    assert.ok(links(guide).includes('/companies/co/settings/substitute-receipt'));
  });

  it('keeps platform roles out of the reports guide and names exporters with source access', () => {
    const guide = buildReportsGuide('co');
    check(guide);
    const menuHelp = sentences(guide).find((sentence) => sentence.startsWith('ถ้าเมนูเปิดใช้แล้ว'))!;
    for (const text of [roles.OWNER, 'ตรวจแพ็กเกจ', 'ติดต่อทีมงาน']) assert.ok(menuHelp.includes(text), text);
    const exportHelp = sentences(guide).find((sentence) => sentence.startsWith('ถ้าคุณไม่มีสิทธิ์ส่งออกข้อมูล'))!;
    for (const role of ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY'] as const) {
      assert.ok(exportHelp.includes(roles[role]), role);
    }
    assert.ok(exportHelp.includes('ที่มีสิทธิ์ดูข้อมูลของรายงานนั้น'), exportHelp);
  });

  it('keeps platform roles out of the tax guide and names the holders of tax export and review rights', () => {
    const guide = buildTaxGuide('co');
    check(guide);
    const exportHelp = sentences(guide).find((sentence) => sentence.startsWith('ถ้าคุณไม่มีสิทธิ์ส่งออกรายงานภาษี'))!;
    const reviewHelp = sentences(guide).find((sentence) => sentence.startsWith('Export REVIEW_JSON'))!;
    for (const text of [exportHelp, reviewHelp]) {
      for (const role of ['OWNER', 'FINANCE', 'ACCOUNTANT', 'AUDITOR_READONLY'] as const) assert.ok(text.includes(roles[role]), role);
      for (const role of ['ADMIN', 'MANAGER'] as const) assert.ok(!text.includes(roles[role]), role);
    }
  });

  it('keeps platform roles out of the claim guide and sends every request for rights to the owner', () => {
    const guide = buildReimbursementGuide('co');
    check(guide);
    const said = (part: string) => sentences(guide).find((sentence) => sentence.includes(part)) ?? part;
    // A missing menu, tab or button, or the page's own refusal: only the owner can give every right in the table.
    for (const [part, ask] of [
      ['แสดงว่าบัญชีของคุณยังไม่มีสิทธิ์ใช้งาน', `ให้แจ้ง${roles.OWNER} โดยบอกสิ่งที่ต้องการทำ`],
      ['ถ้าไม่พบแท็บหรือปุ่มที่ต้องใช้', `ให้แจ้ง${roles.OWNER}ตรวจสิทธิ์ของคุณ`],
      ['ข้อความคือ “บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย”', `ให้ติดต่อ${roles.OWNER} โดยอ้างตาราง`],
    ]) assert.ok(said(part).includes(ask), said(part));
    // Rights come with a role: a role that has the item, or the item added to the role, for everyone in it.
    const howToAsk = said('อ้างข้อในคอลัมน์กลางของตารางนี้');
    for (const text of [`แจ้ง${roles.OWNER}ว่าต้องการทำสิ่งใด`, 'เปลี่ยนบทบาทของคุณเป็นบทบาทที่มีข้อนั้น', 'เลือกข้อนั้นให้บทบาทของคุณ', 'ทุกคนในบทบาทเดียวกัน']) {
      assert.ok(howToAsk.includes(text), text);
    }
  });
});


describe('claim notification gaps in the guide', () => {
  it('explains changed draft choices, combined standing saves, and the requester finance-block notice', () => {
    const guide = buildReimbursementGuide('co', OWNER, ['OWNER']);
    const text = sentences(guide).join(' ');
    const notify = guide.sections.find(s => s.id === 'notify')!;
    const rows = notify.blocks.flatMap(b => b.kind === 'table' ? b.rows : []);
    assert.ok(rows.some(r => r[0].includes('ระงับ') && r[1].includes('ผู้เบิก') && r[2].includes('เหตุผล')));
    assert.ok(rows.some(r => r[0].includes('ร่าง') && r[2].includes('เงินสด') && r[2].includes('บัญชีรับเงินคืนประจำ')));
    assert.match(text, /ถ้าบันทึกโดยไม่เปลี่ยนจะไม่แจ้งซ้ำ/);
    assert.match(text, /ใบร่างที่ทำแทนผู้เบิก: แจ้งเมื่อวิธีรับเงินคืนเปลี่ยน/);
    assert.doesNotMatch(text, /ปลายทาง/);
    const draft = rows.find(r => r[0].includes('ร่าง'))!;
    assert.equal(draft[1], 'ผู้เบิกที่ยังใช้งานอยู่ เมื่อวิธีรับเงินคืนหรือบัญชีเปลี่ยน');
    assert.match(draft[2], /เปิดใบเบิกเพื่อตรวจ ถ้าไม่ถูกต้อง แจ้งผู้จัดทำใบเบิก/);
    assert.doesNotMatch(draft[2], /ผู้ตรวจการเงิน/);
    assert.ok(rows.some(r => r[0].includes('ระงับ') && r[1].includes('ไม่รวมคนที่ระงับและผู้เบิก')));
    assert.match(text, /แจ้งเตือนเดียว/);
    assert.match(text, /บัญชีรับเงินคืนประจำ/);
    assert.doesNotMatch(text, /เจ้าของบัญชีได้รับแจ้งทุกครั้ง/);
  });
});

it('the claim guide names the receiving-method choice when a draft states none', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']));
  assert.ok(text.includes('เลือกวิธีรับเงินคืนและส่งอนุมัติ'));
  assert.ok(text.includes('คำขอโอนเงินกด'));
  assert.equal(text.includes('คำขออื่นปุ่มจะเป็น'), false);
});

it('the claim guide applies self-approval to every role and keeps solo and frozen routes in the explanations and policy table', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']));
  assert.equal((text.match(/เมื่อปิด ไม่มีใครอนุมัติใบเบิกของตัวเองได้ไม่ว่าบทบาทใด/g) ?? []).length, 3);
  assert.ok(text.includes('ผู้เบิกเป็นคนเดียวที่อนุมัติใบนี้ได้'));
  assert.ok(text.includes('ใบที่ส่งไปแล้วใช้ผู้อนุมัติตามที่กำหนดไว้ตอนส่ง'));
  assert.equal(text.includes('บทบาทอื่นทำได้เมื่อบริษัทเปิด'), false);
});

it('the claim guide names first signing and replacement as the buttons do', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']));
  assert.ok(text.includes('กด “ลงนามในใบเบิก”'));
  assert.ok(text.includes('ถ้าเคยลงนามแล้ว ปุ่มอ่าน “ลงนามใหม่”'));
});


it('duplicate guide covers company-wide evidence and the expense-document payment block', () => {
  const text = JSON.stringify(buildReimbursementGuide('co-1', ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.policy.manage']));
  assert.match(text, /ข้ามผู้เบิก/);
  assert.match(text, /เอกสารค่าใช้จ่าย/);
  assert.match(text, /ยืนยันเอกสารก่อน/);
});
