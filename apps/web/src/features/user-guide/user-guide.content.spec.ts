import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { reimbursementPayoutRoundStatus } from '@watchdog-bms/contracts';
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
  return [guide.description, ...guide.sections.flatMap((section) => [section.title, section.summary ?? '', ...section.blocks.flatMap((block) => {
    switch (block.kind) {
      case 'items': return block.items.flatMap((item) => [item.title, item.detail]);
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
