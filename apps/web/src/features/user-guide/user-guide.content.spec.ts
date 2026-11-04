import * as React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { reimbursementPayoutRoundStatus, THAI_SYSTEM_ROLE_NAMES, REIMBURSEMENT_PAYMENT_REFERENCE_TEXT } from '@watchdog-bms/contracts';
import { CLAIM_SIGN_LABEL, CLAIM_RESIGN_LABEL, SELF_APPROVAL_POLICY_NOTE, reimbursementSubmitReadiness } from '../reimbursements/reimbursements.model';
import { buildReimbursementGuide } from './reimbursement-guide.content';
import { buildSubstituteReceiptGuide } from './substitute-receipt-guide.content';
import { buildExpensesGuide } from './expenses-guide.content';
import { buildTaxGuide } from './tax-guide.content';
import { buildReportsGuide } from './reports-guide.content';
import { buildGettingStartedGuide } from './getting-started-guide.content';
import { PLAN_TIER_PRESETS, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
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

it('PWS-GUIDE payment and claim explanations use the current plain screen words', () => {
  const starting = sentences(buildGettingStartedGuide('co', [...OWNER, 'expense.disbursement.pay'], [...TIER_FEATURE_PRESETS.STARTER_249])).join(' ');
  assert.match(starting, /VAT นี้ใช้ตอนยื่นภาษีได้ไหม/);
  assert.match(starting, /ตรวจคำตอบ “ใช้ VAT ตอนยื่นภาษี” ให้ครบก่อนใช้ยื่น/);
  assert.match(starting, /ใบสำคัญจ่ายเลขที่เดิม เป็นหลักฐานว่าบันทึกจ่ายแล้ว/);
  const claim = sentences(buildReimbursementGuide('co')).join(' ');
  assert.match(claim, /ใบเบิกเก่าที่ถูกยกเลิกทั้งใบแล้วทำต่อไม่ได้/);
  assert.match(claim, /เมื่อระบบกำลังยกเลิกใบเบิก อ่านเหตุผลที่ค้างอยู่ในหน้าใบเบิกก่อนทำต่อ/);
  assert.match(claim, /เจ้าของบัญชีที่ยังใช้งานอยู่ได้รับแจ้งให้ตรวจ/);
});

it('LINE-HELP-ALL-2 keeps the web guide neutral and names current LINE commands and web buttons', () => {
  const text = sentences(buildGettingStartedGuide('co', ['line.ai.query', 'company.plan.manage', 'company.legal_identity.manage',
    'reimbursement.cancel_own', 'wht.external_certificate.link'])).join(' ');
  for (const label of ['เปลี่ยนบริษัท', 'เปิดเว็บบริษัทนี้', 'โปรโมชั่น', 'ติดต่อเจ้าหน้าที่', 'ยกเลิกใบเบิกนี้', 'จดเลขที่ใบ 50 ทวิ']) {
    assert.ok(text.includes(`“${label}”`), label);
  }
  assert.match(text, /ลิงก์นี้เป็นของคุณคนเดียว/);
  assert.match(text, /หากต้องการลบข้อมูล แจ้งคำขอแยกกับทีมงาน/);
  assert.doesNotMatch(text, /อย่า(?!ง)|ห้าม|ค่ะ|นะคะ|\p{Extended_Pictographic}|พิมพ์ “บริษัทของฉัน”|กด “ติดต่อเจ้าหน้าที่” ในเมนู/u);
});

it('LINE-HELP-ALL renders the getting-started guide with role/package-safe steps and current catalog facts', () => {
  const permissions = [...OWNER, 'line.ai.query', 'company.legal_identity.manage', 'company.plan.manage', 'company.branch.manage', 'access.employee.create',
    'access.role.manage', 'wht.external_certificate.link', 'wht.certificate.issue', 'wht.pnd53.read', 'notification.read', 'expense.signature.self_manage', 'dashboard.read'];
  const starter = buildGettingStartedGuide('co', permissions, [...TIER_FEATURE_PRESETS.STARTER_249]);
  const enterprise = buildGettingStartedGuide('co', permissions, [...TIER_FEATURE_PRESETS.ENTERPRISE_1999]);
  assert.ok(sentences(starter).includes('จดเลขที่ 50 ทวิที่ทำนอกระบบ'));
  assert.ok(!sentences(starter).includes('ออก 50 ทวิในระบบ'));
  assert.ok(sentences(enterprise).includes('ออก 50 ทวิในระบบ'));
  const staff = sentences(buildGettingStartedGuide('co', ['line.ai.query', 'expense.read_own'], [...TIER_FEATURE_PRESETS.STARTER_249]));
  assert.ok(staff.includes('พนักงานอยากเปิดร้านของตัวเอง'));
  for (const ownerStep of ['เปิดร้านหรือเปิดร้านเพิ่ม', 'เพิ่มพนักงานและเชื่อม LINE', 'กำหนดหน้าที่และสิทธิ์', 'ซื้อแพ็กเกจ']) assert.ok(!staff.includes(ownerStep), ownerStep);
  assert.deepEqual(Object.values(PLAN_TIER_PRESETS).slice(1).map(p => [p.branchLimit, p.employeeLimit, p.monthlySlipLimit]), [[1, 2, 30], [2, 5, 50], [5, 10, 100], [10, 30, 500]]);
  assert.ok(sentences(starter).some(text => text.includes('ผู้ใช้ 2/5/10/30 คน') && text.includes('30/50/100/500 ใบ')));
  assert.doesNotMatch(sentences(enterprise).join(' '), /ค่ะ|ครับ|กรุณา/);
  (globalThis as any).React = React;
  require.extensions['.svg'] = module => { module.exports = () => null; };
  const { UserGuidePage } = require('./UserGuidePage') as typeof import('./UserGuidePage');
  const runtime = require('react') as typeof React, original = runtime.useState;
  Reflect.set(runtime, 'useState', (initial: unknown) => {
    const [value, set] = (original as any)(initial);
    return [Array.isArray(initial) ? enterprise.sections.map(section => section.id) : value, set];
  });
  try {
    const html = renderToStaticMarkup(React.createElement(UserGuidePage, { guide: enterprise }));
    assert.match(html, /เริ่มใช้งานร้านและ LINE/); assert.match(html, /เลือกวันที่/); assert.match(html, /ทำนอกระบบ/);
    assert.match(html, /href="\/companies\/co\/dashboard"/); assert.match(html, /aria-expanded="true"/);
  } finally { Reflect.set(runtime, 'useState', original); }
});

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

  it('offers related-expense readers the same list and certificate shortcuts as the sidebar', () => {
    const permissions = ['expense.read_related'];
    assert.ok(links(buildExpensesGuide('co', permissions)).includes('/companies/co/expenses'));
    const certificate = links(buildSubstituteReceiptGuide('co', permissions));
    assert.ok(certificate.includes('/companies/co/expenses/substitute-receipts'));
    assert.ok(certificate.includes('/companies/co/expenses'));
    assert.ok(links(buildReimbursementGuide('co', permissions)).includes('/companies/co/expenses'));
    assert.ok(!certificate.some(href => href.includes('/settings/')));
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

  it('G1: explains the nonempty status chooser and queue metrics including duplicate holds', () => {
    const list = sentences({ ...guide, sections: guide.sections.filter((section) => section.id === 'list') }).join(' ');
    assert.match(list, /ติดรายการซ้ำ/u);
    assert.match(list, /จ่ายได้/u);
    assert.match(list, /ช่อง “สถานะ” แสดงทั้งหมดและเฉพาะกลุ่มที่มีใบเบิก/u);
    assert.doesNotMatch(list, /ตัวกรอง 8 แท็บ|ตัวกรองแสดงเสมอ/u);
    assert.match(list, /จำนวนรออนุมัติและรอจ่ายพร้อมยอดเงิน รวมใบที่กฎรายการซ้ำห้ามจ่ายด้วย/u);
    for (const gone of ['ร่างรอส่ง', 'รอจ่ายเงินคืน', 'ยอดรวมที่ขอเบิก', 'การ์ดสรุป', 'draftRowSubmitLabel']) assert.ok(!list.includes(gone), gone);
  });

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
    const receiptExample = { status: 'DRAFT', receiptRequirementStatus: 'REQUIRED', lines: [{ lineNo: 1, incurredDate: '2026-01-01' }] };
    const shown = [claimScreens, reimbursementSubmitReadiness(receiptExample).message, reimbursementSubmitReadiness({ ...receiptExample, allowMissingReceiptWithReason: true }).message, ...Object.values(REIMBURSEMENT_PAYMENT_REFERENCE_TEXT), ...[
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
    for (const label of ['เหตุผลที่จ่ายต่างจากที่ระบุในใบ', 'จ่ายต่างจากที่ระบุในใบ', 'วิธีจ่ายต่างจากที่ระบุในใบ ระบุเหตุผล']) assert.ok(quotes.includes(label), label);
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
    const ANSWERED_FOR_YOU = 'หัวข้อบอกชื่อคนที่ทำและสิ่งที่ทำ เช่น “แก้บัญชีรับเงิน” “ยืนยันบัญชีเดิม” หรือ “เปลี่ยนวิธีรับเงินคืน” ตามด้วย “ในใบเบิกของคุณ” และเลขที่ใบเบิก เนื้อความบอกธนาคารและ 4 ตัวท้ายของบัญชี หรือบอกว่ารับเป็นเงินสด และให้เปิดใบเบิกเพื่อตรวจ';
    // Once in the phone's card and once in the table from sm up: the same sentence.
    assert.equal(texts.filter((text) => text === ANSWERED_FOR_YOU).length, 2);
    // On a phone the sentence is in a card that wraps: no table, no horizontal scroll.
    assert.match(html, new RegExp(`<ul class="flex flex-col gap-2 sm:hidden">[\\s\\S]*?<p class="text-sm leading-6 break-words text-gray-600">${ANSWERED_FOR_YOU}</p>`, 'u'));
    for (const said of ['กด “แสดงเลขบัญชี” หรือ “แสดงเบอร์พร้อมเพย์” เพื่อดูเลขเต็ม', 'ปุ่มคือ “แสดงเบอร์พร้อมเพย์” กับ “คัดลอกเบอร์พร้อมเพย์”', 'บัญชีพร้อมเพย์ใช้ปุ่ม “แสดงเบอร์พร้อมเพย์” และ “ซ่อนเบอร์พร้อมเพย์”',
      'ข้อแรกคือเบอร์พร้อมเพย์ไม่ถูกต้อง', 'ประวัติการจ่ายจะขึ้นป้าย “จ่ายต่างจากที่ระบุในใบ”', 'เมื่อเลือกวิธีรับเงินคืนแล้ว ใบเบิกกลับไปพร้อมจ่ายทันที', 'จะไม่มีแจ้งเตือนถึงผู้เบิก']) {
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
  assert.equal(holders('อนุมัติและจ่ายใบเบิก'), `${roles.OWNER} ${roles.ADMIN} ${roles.MANAGER}`);
  assert.equal(holders('ตรวจใบเบิก'), `${roles.OWNER} ${roles.ACCOUNTANT}`);
  assert.equal(holders('ตรวจและจ่ายใบเบิก'), `${roles.OWNER} ${roles.FINANCE}`);
  assert.equal(holders('ตั้งนโยบายใบเบิก'), `${roles.OWNER} ${roles.ADMIN}`);
  assert.equal(holders('สิทธิ์แก้ไขข้อมูลพนักงาน'), `${roles.OWNER} ${roles.ADMIN} และ${roles.MANAGER}กับ${roles.HR}ในสาขาที่ตนดูแล`);
  assert.equal(rows('tabs').find((row) => row[0] === 'เพิ่มเติม → ตั้งค่านโยบาย')?.[1], `${roles.OWNER} และ${roles.ADMIN}`);
  // Default roles can record payment; the guide explains the owner and sole-approver exceptions to the switch.
  const approvers = `${roles.OWNER} ${roles.ADMIN} และ${roles.MANAGER}`;
  for (const part of ['ทำได้อยู่แล้ว บทบาทที่ร้านสร้างเอง']) {
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
  assert.equal(guide.sections.find((section) => section.id === 'policy')!.title, `ตั้งค่านโยบายของร้าน (สำหรับ${roles.OWNER}และ${roles.ADMIN})`);
  assert.equal(guide.sections.find((section) => section.id === 'finance')!.summary, 'มีเมื่อร้านเปิด “ตรวจการเงินก่อนจ่าย” เท่านั้น');
  // What a switch does is said of the company; whom to ask names both holders.
  for (const said of [
    'งานตรวจการเงินมีต่อเมื่อร้านเปิด “ตรวจการเงินก่อนจ่าย” ในหน้าตั้งค่านโยบาย',
    `${roles.OWNER}หรือ${roles.ADMIN}เปิด “ตรวจการเงินก่อนจ่าย” ได้ที่หน้าตั้งค่านโยบาย`,
    `เมื่อปิด อนุมัติเองได้เฉพาะ${roles.OWNER} หรือเมื่อผู้เบิกเป็นคนเดียวที่อนุมัติใบนั้นได้`,
    'ขอให้ผู้มีสิทธิ์ตั้งค่านโยบายเปิดสวิตช์',
  ]) assert.ok(read.some((text) => text.includes(said)), said);
});

it('G1: the claim guide pins current form, cancellation, comparison and policy wording', () => {
  const guide = buildReimbursementGuide('co');
  const text = sentences(guide).join(' ');
  for (const label of ['+ สร้างใบเบิก', 'ใบเบิกทั้งหมด', 'รอการเงิน', 'รอจ่าย', 'แก้ไขใบเบิก', 'ยกเลิกใบเบิกนี้', 'ไม่ยกเลิก', 'ยกเลิกใบเบิก',
    'ยกเลิกรายการจ่ายนี้', 'เลือกจากค่าใช้จ่ายที่บันทึกไว้', 'ค่าใช้จ่ายที่บันทึกไว้', 'ใบเบิกถูกแก้หลังส่งอนุมัติ', 'เดิม', 'ใหม่',
    'บันทึกร่าง', 'ทำต่อ', 'ทำต่อเพื่อยกเลิก', 'หลักฐานการจ่าย', 'แนบสำเนาที่เซ็นครบ', 'แนบเป็นไฟล์แนบทั่วไป', 'ไปบันทึกลายเซ็น', 'ใบเบิกจะเดินตามนี้', 'บันทึกการตั้งค่า',
    'ส่งใบเบิกให้ใครอนุมัติ', 'ไม่มีใบเสร็จได้ถ้ากรอกเหตุผล', 'ถ้าใบเสร็จอาจซ้ำกับใบอื่น', 'เตือนอย่างเดียว', 'ห้ามส่งอนุมัติ', 'ห้ามจ่ายจนกว่าจะตรวจ']) {
    assert.ok(text.includes(label), label);
  }
  const fields = guide.sections.find(section => section.id === 'create')!.blocks.flatMap(block => block.kind === 'table' ? block.rows : []);
  assert.ok(fields.some(row => row[0] === 'หมวด' && row[2]!.includes('ยังไม่มีหมวดเลือกไว้ให้')));
  assert.ok(fields.some(row => row[0] === 'ผู้เบิก' && row[1] === 'แสดงเฉพาะผู้ที่ทำใบเบิกแทนคนอื่นได้'));
  assert.ok(fields.some(row => row[0] === 'เหตุผลที่ไม่มีใบเสร็จ' && row[1] === 'แสดงเมื่อรายการที่กรอกเองยังไม่มีใบเสร็จ'));
  assert.ok(!fields.some(row => row[0] === 'สกุลเงิน'));
  assert.match(text, /ไม่มีช่องแก้จำนวนเงิน/u);
  assert.match(text, /ยกเลิกแล้ว/u);
  assert.doesNotMatch(text, /ข้อมูลคำขอ|สรุปคำขอ|ดูรายละเอียด”|อนุมัติด้วยข้อมูลล่าสุด|แก้ยอดให้เท่ากับ/u);
});

it('G1: the substitute guide quotes current screens and follows their four stages', () => {
  const guide = buildSubstituteReceiptGuide('co');
  const read = sentences(guide);
  const feature = join(__dirname, '../expenses');
  const source = (file: string) => readFileSync(file, 'utf8').replace(/\$\{THAI_SYSTEM_ROLE_NAMES\.([A-Z_]+)\}/g, (_, role: keyof typeof THAI_SYSTEM_ROLE_NAMES) => THAI_SYSTEM_ROLE_NAMES[role]).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const shown = [
    ...readdirSync(feature).filter(name => /^(?:Substitute|substitute-receipt).*\.tsx?$/.test(name) && !name.includes('.spec.')).map(name => source(join(feature, name))),
    source(join(__dirname, '../../common/i18n/workspace-dictionary.ts')),
  ].join('\n');
  const quotes = [...new Set(read.flatMap(text => [...text.matchAll(/“([^”]+)”/g)].map(match => match[1]!)))];
  assert.ok(quotes.length >= 25, 'the guide names the controls a reader needs');
  assert.deepEqual(quotes.filter(quote => !shown.includes(quote)), []);
  const stages = guide.sections.find(section => section.id === 'steps')!.blocks.flatMap(block => block.kind === 'steps' ? block.steps.map(step => step.title) : []);
  assert.deepEqual(stages, ['ค่าใช้จ่าย', 'รายละเอียด', 'เซ็น', 'เสร็จ']);
  const statuses = guide.sections.find(section => section.id === 'list')!.blocks.flatMap(block => block.kind === 'table' ? block.rows.map(row => row[0]) : []);
  assert.deepEqual(statuses, ['รอเซ็น', 'รออนุมัติ', 'ออกแล้ว', 'ยกเลิกแล้ว']);
  const text = read.join(' ');
  for (const label of ['ซื้อไปใช้ทำอะไร', 'ผู้รับรองการจ่าย', 'ใช้เงินของใครจ่าย', 'วิธีจ่าย', 'วันที่จ่าย', 'ใช้ลายเซ็นนี้', 'พิมพ์ใบสำคัญรับเงิน', 'อนุมัติและออกใบรับรอง', 'เดือนที่จ่าย']) assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /งานที่รอดำเนินการ|ตัวเลขสรุป 4 ช่อง|ดำเนินการ|ลงนาม|ลายมือชื่อ|กรุณา/u);
  assert.match(text, /ใบที่เซ็นบนกระดาษใช้สร้างใบเบิกในระบบไม่ได้/u);
  assert.match(text, /เงินส่วนตัวของพนักงานยังไม่ถือว่าร้านจ่ายคืน/u);
});

it('the substitute-receipt guide calls the owner by the one name', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;
  const read = sentences(buildSubstituteReceiptGuide('co'));
  // "กิจการเจ้าของคนเดียว" is a kind of business (a sole proprietorship), not a role.
  for (const text of read) assert.doesNotMatch(text, /เจ้าของ(?!กิจการ|คนเดียว)/u, text);
  const said = `${roles.OWNER}เซ็นได้ทั้งในฐานะผู้จ่ายเงินและผู้อนุมัติ`;
  assert.ok(read.some((text) => text.includes(said)), said);
});

// The wizard offers online and paper signing; the signing section covers both, in the words of the screens.
it('the substitute-receipt guide describes paper signing as the screens do', () => {
  const guide = buildSubstituteReceiptGuide('co');
  const text = sentences({ ...guide, sections: guide.sections.filter((section) => section.id === 'sign') }).join('\n');
  const screens = ['SubstituteReceiptWizardPage.tsx', 'SubstitutePaperSigningPanel.tsx']
    .map((name) => readFileSync(join(__dirname, '../expenses', name), 'utf8')).join('\n');
  for (const quote of ['เลือกวิธีเซ็น', 'เซ็นออนไลน์', 'พิมพ์แล้วเซ็นบนกระดาษ', 'คนเดียวกันเซ็นทั้งสองช่อง', 'ส่งฉบับที่เซ็นแล้ว',
    'เปิดเอกสารที่ส่งมา', 'หน้าถัดไป', 'อ่านครบทุกหน้าและตรวจเทียบข้อมูลแล้ว', 'ตรวจรับและจัดเก็บฉบับสมบูรณ์']) {
    assert.ok(text.includes(`“${quote}”`), quote);
    assert.ok(screens.includes(quote), `${quote} is on a screen`);
  }
  // In the owner-self mode one person may sign both lines; the certificate says who, not always the owner.
  assert.doesNotMatch(text, /ว่าเจ้าของ(กิจการ)?เซ็นทั้งสองฐานะ/u);
  assert.ok(text.includes('คนเดียวเซ็นทั้งสองฐานะได้ตามสิทธิ์ และระบบระบุไว้ในเอกสาร'), 'one person signing both is noted, whoever it is');
});

describe('shop guides name the company admin for the business permissions it holds', () => {
  const roles = THAI_SYSTEM_ROLE_NAMES;

  it('names ADMIN for substitute-receipt settings in the expense guide', () => {
    assert.ok(sentences(buildExpensesGuide('co')).includes(`${roles.OWNER}, ${roles.ADMIN}`));
  });

  it('names ADMIN throughout substitute-receipt setup and preparation', () => {
    const read = sentences(buildSubstituteReceiptGuide('co'));
    for (const expected of [
      `ไปที่ ค่าใช้จ่ายและใบเสร็จ แล้วเลือก ตั้งค่าใบรับรองแทนใบเสร็จ เปิดได้เฉพาะผู้ที่มีสิทธิ์ตั้งค่าร้าน เช่น ${roles.OWNER}และ${roles.ADMIN}`,
      `ตั้งค่า (สำหรับ${roles.OWNER}และ${roles.ADMIN})`,
      'คนบันทึกรายการ หรือมีสิทธิ์ตรวจสอบค่าใช้จ่าย',
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
    assert.equal(holders(rows(expenses, 'submenus'), 'ใบรับรองแทนใบเสร็จ'), 'คนบันทึกรายการ หรือผู้มีสิทธิ์ตรวจสอบค่าใช้จ่าย');
    assert.equal(holders(rows(expenses, 'permissions'), 'ตรวจความครบถ้วนและยืนยันเอกสาร'), confirmers);
    assert.equal(holders(rows(expenses, 'permissions'), 'เพิ่มหรือแก้ไขหมวดหมู่'), confirmers);
    const categories = sentences({ ...expenses, sections: expenses.sections.filter((section) => section.id === 'categories') });
    for (const text of categories) assert.ok(!text.includes(roles.ACCOUNTANT), text);
    assert.ok(categories.some((text) => text.includes(`ผู้มีสิทธิ์จัดการหมวดหมู่ เช่น ${roles.OWNER} ${roles.ADMIN} และ${roles.FINANCE}`)));
    // In the designated-approver mode only the listed approvers may approve, the owner included.
    assert.equal(holders(rows(buildSubstituteReceiptGuide('co'), 'permissions'), 'อนุมัติและออกใบรับรอง'), `${confirmers} ถ้าร้านกำหนดรายชื่อผู้อนุมัติ ต้องเป็นคนในรายชื่อนั้น`);
  });
});

// The guide cannot import API code, so it copies the report words; these checks read the sources and fail on any drift.
it('G2: expenses and sold tax instructions quote current screen words', () => {
  const root = join(__dirname, '../../../../..');
  const source = (file: string) => readFileSync(file, 'utf8').replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\//g, (_match, literal: string | undefined) => literal ?? '').replace(/^\s*\/\/.*$/gm, '');
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [source(path)] : [];
  });
  const shown = [...sources(join(__dirname, '../expenses')), ...sources(join(__dirname, '../tax')), ...sources(join(__dirname, '../counterparties')),
    ...['expenses.ts', 'tax.ts', 'disbursement-vouchers.ts'].map(name => source(join(root, 'packages/contracts/src', name))), source(join(__dirname, '../../common/i18n/workspace-dictionary.ts'))].join('\n');
  const expense = buildExpensesGuide('co');
  const tax = buildTaxGuide('co');
  const sold = tax.sections.find(section => section.id === 'wht')!.blocks[0]!;
  const quotes = [...new Set([...sentences(expense), ...sentences({ ...tax, sections: [{ ...tax.sections.find(section => section.id === 'wht')!, blocks: [sold] }] })]
    .flatMap(text => [...text.matchAll(/“([^”]+)”/g)].map(match => match[1]!)))];
  assert.ok(quotes.length >= 35, 'guides name the controls people need');
  const thai = /[฀-๿]/;
  const isShown = (quote: string) => {
    for (let at = shown.indexOf(quote); at !== -1; at = shown.indexOf(quote, at + 1)) {
      if (!thai.test(shown[at - 1] ?? '') && !thai.test(shown[at + quote.length] ?? '')) return true;
    }
    return false;
  };
  assert.deepEqual(quotes.filter(quote => !isShown(quote)), []);
});

it('G2: expenses guide names the current list, check steps and evidence controls', () => {
  const guide = buildExpensesGuide('co');
  const text = sentences(guide).join(' ');
  for (const label of ['ส่งออก Excel ให้สำนักงานบัญชี', 'ยังไม่ยืนยัน', 'ยกเลิก/ปฏิเสธ', 'ส่งใบเสร็จ', 'ตรวจข้อมูล', 'ภาษีและเอกสาร', 'ตรวจสรุป',
    'ประเภทเอกสาร', 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', 'มีใบเสร็จของรายการนี้ไหม', 'จะใช้อะไรแทน', 'เหตุผลที่ใช้หลักฐานนี้',
    'บันทึกร่าง', 'เพิ่มหมวดหมู่', 'แก้ชื่อหมวดหมู่', 'เดือน', 'นับเดือนตาม', 'วันที่ส่งเข้า', 'วันที่เอกสาร']) assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /ปุ่มกรอง 5 ปุ่ม|แท็บ 5 แท็บ|ให้ AI อ่านใบเสร็จ”|เพิ่มหมวดหมู่ใหม่|ปุ่มรูปตา|แถบหัวเอกสารและแท็บ/u);
  const manual = sentences({ ...guide, sections: guide.sections.filter(section => section.id === 'manual') }).join(' ');
  assert.doesNotMatch(manual, /กรอกฐาน อัตรา/u);
});

it('G2: sold tax instructions name certificate, signature and PND53 controls', () => {
  const guide = buildTaxGuide('co', ['wht.certificate.issue', 'wht.pnd53.read', 'company.tax_signature.manage']);
  const text = sentences(guide).join(' ');
  for (const label of ['หนังสือรับรอง 50 ทวิ', 'ยังไม่ออก', 'ทำนอกระบบ', 'ดาวน์โหลดหนังสือรับรอง', 'ลายเซ็นบน 50 ทวิ',
    'พิมพ์แล้วเซ็นเอง', 'ใส่รูปลายเซ็นให้อัตโนมัติ', 'ดึงรายการล่าสุด', 'ดาวน์โหลดแบบ ภ.ง.ด.3', 'ดาวน์โหลดแบบ ภ.ง.ด.53', 'บันทึกว่ายื่นแล้ว', '10 รายการ', 'ดาวน์โหลดรายการให้ผู้ทำบัญชี', 'ต้องจัดทำ ภ.ง.ด.2 แยก']) assert.ok(text.includes(label), label);
  for (const href of ['/companies/co/expenses/wht-certificates', '/companies/co/settings/tax-signature', '/companies/co/tax/withholding']) assert.ok(links(guide).includes(href), href);
  assert.deepEqual(links(buildTaxGuide('co', [])), []);
});

it('WHT-OUTSIDE guides external recording without system printing or signature settings for a shop without the feature', () => {
  const permissions = ['wht.certificate.read', 'wht.external_certificate.link', 'company.tax_signature.manage'];
  const guide = buildTaxGuide('co', permissions, false);
  const text = sentences(guide).join(' ');
  for (const phrase of ['ทำใบ 50 ทวิ จากแบบฟอร์มกรมสรรพากรหรือโปรแกรมอื่น แล้วจดเลขที่ไว้ที่นี่', 'จดเลขที่ใบ 50 ทวิ',
    'เลขที่ใบ', 'วันที่ทำใบ', 'เก็บใบจริงไว้ที่ (ไม่บังคับ)', 'แนบไฟล์ได้ถ้ามี']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /ออกเลขที่และดาวน์โหลด|ดาวน์โหลดหนังสือรับรอง|ลายเซ็นบน 50 ทวิ/);
  assert.ok(links(guide).includes('/companies/co/expenses/wht-certificates'));
  assert.ok(!links(guide).includes('/companies/co/settings/tax-signature'));
});

it('FIX-Q3 tax guide names the three actions in Thai and every required self-issued certificate field', () => {
  const text = sentences(buildTaxGuide('co')).join(' ');
  assert.doesNotMatch(text, /tax code|reconciliation|ปุ่มดำเนินการ/iu);
  for (const phrase of ['คำนวณรายงาน', 'ยื่นแบบแล้ว', 'ชำระแล้ว', 'รหัสภาษี', 'กระทบยอด']) assert.ok(text.includes(phrase), phrase);
  const guide = buildTaxGuide('co');
  const block = guide.sections.find(section => section.id === 'wht')!.blocks[0]!;
  assert.equal(block.kind, 'items');
  if (block.kind !== 'items') return;
  const instructions = block.items.find(item => item.title === 'ทำหนังสือรับรองนอกระบบ')!.detail;
  for (const field of ['เลขที่ใบ', 'วันที่จ่ายตามหนังสือรับรองเดิม', 'วันที่ทำใบ']) assert.ok(instructions.includes(`“${field}”`), field);
});

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
    const instructions = sentences(guide).find((sentence) => sentence.includes('เปิดได้เฉพาะผู้ที่มีสิทธิ์ตั้งค่าร้าน'))!;
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
      ['ข้อความคือ “บัญชีนี้ยังใช้การเบิกจ่ายไม่ได้”', `ให้ติดต่อ${roles.OWNER} โดยอ้างตาราง`],
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

it('the claim guide offers sending from the form and keeping a draft without receipts', () => {
  const guide = buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']);
  const list = sentences({ ...guide, sections: guide.sections.filter(section => section.id === 'list') }).join(' ');
  const text = sentences(guide).join(' ');
  assert.ok(text.includes('“เลือกวิธีรับเงินคืนในใบนี้”'));
  assert.ok(text.includes('“ส่งอนุมัติ” ในฟอร์มได้เลย'));
  assert.ok(text.includes('“บันทึกร่าง” ไว้ก่อนแม้ยังไม่มีใบเสร็จ'));
  assert.ok(text.includes('กด “ส่งอนุมัติ” เมื่อตรวจครบ'));
  assert.ok(text.includes('ใบเสร็จตามกติกาของร้าน'));
  assert.doesNotMatch(list, /ปุ่มบน.*ร่าง|เลือกวิธีรับเงินคืนและส่งอนุมัติ|ตรวจวิธีรับเงินคืนและส่งอนุมัติ/u);
});

it('the claim guide applies self-approval to every role and keeps solo and frozen routes in the explanations and policy table', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']));
  assert.equal(text.split(SELF_APPROVAL_POLICY_NOTE).length - 1, 3);
  assert.ok(text.includes('ผู้เบิกเป็นคนเดียวที่อนุมัติใบนั้นได้'));
  assert.ok(text.includes('ใบที่ส่งไปแล้วใช้ผู้อนุมัติตามที่กำหนดไว้ตอนส่ง'));
  assert.equal(text.includes('บทบาทอื่นทำได้เมื่อบริษัทเปิด'), false);
});

it('the claim guide names first signing and replacement as the buttons do', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create'], ['STAFF']));
  assert.ok(text.includes(`กด “${CLAIM_SIGN_LABEL}”`));
  assert.ok(text.includes(`ถ้าเคยเซ็นแล้ว ปุ่มอ่าน “${CLAIM_RESIGN_LABEL}”`));
});


it('duplicate guide covers company-wide evidence and the expense-document payment block', () => {
  const text = JSON.stringify(buildReimbursementGuide('co-1', ['reimbursement.read', 'reimbursement.payment.record', 'reimbursement.policy.manage']));
  assert.match(text, /ข้ามผู้เบิก/);
  assert.match(text, /เอกสารค่าใช้จ่าย/);
  assert.match(text, /ยืนยันเอกสารก่อน/);
});

describe('guides after the sold-screen changes', () => {
  it('distinguishes an immediate camera upload from chosen files and the sender-only result', () => {
    const guide = buildExpensesGuide('co');
    const upload = sentences({ ...guide, sections: guide.sections.filter(section => section.id === 'upload') }).join(' ');
    for (const phrase of ['รูปแรกจากกล้องส่งทันทีเมื่อเลือกสาขาแล้ว', 'ระบบเก็บรูปไว้', 'เลือกสาขาและกด “ส่งใบเสร็จ”',
      '“ถ่ายเพิ่ม” / “เลือกเพิ่ม”', '“หมายเหตุ (ไม่บังคับ)”', 'ดูรายการที่ส่ง', 'ส่งอีกใบ', 'เติมข้อมูลใบเสร็จ', 'บันทึกแล้วกลับมาที่ผลส่ง', 'ลบร่างใบเสร็จ', 'เมนู “ใบรับรองแทนใบเสร็จ”']) assert.ok(upload.includes(phrase), phrase);
    assert.doesNotMatch(upload, /\+ หมายเหตุ|ไม่มีใบเสร็จ ทำใบรับรองแทนใบเสร็จ/);
  });

  it('explains review defaults, saving with Next, missing-receipt answers and a named checker', () => {
    const text = sentences(buildExpensesGuide('co')).join(' ');
    for (const phrase of ['ขั้นแรกที่ยังขาดข้อมูล', 'ถ้าครบแล้วเปิดขั้นสุดท้าย', 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', 'ผู้ตรวจเลือก “ใช้ VAT ตอนยื่นภาษี” และตรวจเงื่อนไขให้ครบ แล้วกด “ถัดไป”', '“ไม่มีใบเสร็จ” หรือ “ใบเสร็จหาย”',
      'ไม่ต้องเลือกประเภทเอกสารหรือตอบเรื่องภาษี', '“ส่งให้ตรวจ” เลือกหนึ่งคนใน “ส่งให้ใครตรวจ”', 'ชื่อผู้ขาย', 'เลือกจากคู่ค้าหรือพิมพ์ชื่อใหม่ได้',
      'วิธีจ่ายเริ่มที่ “โอนเงิน”', 'เปิดร่าง']) assert.ok(text.includes(phrase), phrase);
    assert.doesNotMatch(text, /บันทึกการตรวจ|ตรวจครบทุกข้อแล้ว รอกดยืนยัน|ส่งตรวจสอบ|ส่งให้คนอื่นตรวจ/u);
  });

  it('uses document-date months and explains that spreadsheet links open a protected expense page', () => {
    const guide = buildExpensesGuide('co');
    const text = (id: string) => sentences({ ...guide, sections: guide.sections.filter(section => section.id === id) }).join(' ');
    assert.match(text('list'), /นับตามวันที่เอกสาร ถ้ายังไม่มีวันที่เอกสารจะนับตามวันที่ส่งเข้า/u);
    assert.match(text('evidence'), /ค่าเริ่มต้นเป็นรายการยืนยันแล้วตาม “วันที่เอกสาร”/u);
    assert.match(text('evidence'), /ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี/u);
    assert.match(text('evidence'), /เลือก “เพิ่มเติม” แล้วกด “ส่งออก Excel ให้สำนักงานบัญชี”/u);
    assert.doesNotMatch(text('evidence'), /evidence_manifest|ลิงก์หลักฐานที่คุณเปิดได้/u);
  });

  it('covers claim correction, draft deletion, payment and completion after signing', () => {
    const text = sentences(buildReimbursementGuide('co')).join(' ');
    for (const phrase of ['ต้องแก้ไข', 'แท็บที่มีงานรอคุณ', 'ขั้นที่ต้องทำก่อน', 'คอลัมน์เดียว', 'ร่างที่ไม่เคยส่ง', '“ลบร่าง” ไม่ต้องให้เหตุผล',
      '“จ่ายเงิน” เปิดฟอร์ม', 'ปุ่มบันทึกจ่ายที่แสดงยอด', 'หลักฐานการจ่าย', 'เอกสารที่อาจซ้ำ',
      'เมื่อปิด อนุมัติเองได้เฉพาะเจ้าของกิจการ', 'จ่ายครบแล้ว ถ้าเอกสารยังไม่ครบจะแสดง “ยังไม่ได้เซ็นใบเบิก”', 'ขั้นเอกสารจบเมื่อเซ็นครบหรือแนบสำเนาที่เซ็นครบ', 'ถูกส่งกลับให้แก้', 'ส่งกลับให้แก้']) assert.ok(text.includes(phrase), phrase);
    assert.doesNotMatch(text, /กด “บันทึกร่าง” แล้วกด “ส่งอนุมัติ” ในหน้าใบเบิก/u);
  });

  it('lets recorders prepare certificates and explains candidate search and the preset single signing route', () => {
    const text = sentences(buildSubstituteReceiptGuide('co')).join(' ');
    for (const phrase of ['คนบันทึกทำใบรับรองของรายการตนเองได้', 'แม้ยังไม่ตอบขั้นตรวจหลักฐาน', 'รายการบันทึกด้วยมือที่ไม่มีไฟล์แสดงได้',
      'รูปใบเสร็จที่ยังไม่ได้อ่านไม่แสดง', 'เปิดค่าใช้จ่าย', 'ค้นเลขที่ ชื่อผู้ขายหรือรายละเอียดจากรายการทั้งหมด', 'หน้าละ 5 รายการ',
      'ระบบบันทึกคำตอบว่าไม่มีใบเสร็จให้', 'ระบบเลือกเจ้าของกิจการ', 'เลือกผู้จัดทำเมื่อรับรองได้', 'เซ็นและออกใบรับรอง', 'จบในขั้นเดียว']) assert.ok(text.includes(phrase), phrase);
    assert.doesNotMatch(text, /เรียงลำดับได้ 4 แบบ|แสดงเฉพาะรายการล่าสุด|บันทึกการตรวจ”|ผู้จัดทำซึ่งมีสิทธิ์ตรวจสอบค่าใช้จ่าย/u);
  });

  it('covers the sold withholding pages and the consequence of clearing the stored signature', () => {
    const text = sentences(buildTaxGuide('co')).join(' ');
    for (const phrase of ['เลือกเดือนที่จ่ายและแบบภาษี', 'ภ.ง.ด.3 (จ่ายให้บุคคล)', 'ภ.ง.ด.53 (จ่ายให้บริษัท)',
      'เปิดลิงก์แก้ข้อมูลที่ขาด', 'ดึงรายการล่าสุด', 'ดาวน์โหลดแบบ ภ.ง.ด.3', 'ดาวน์โหลดแบบ ภ.ง.ด.53', 'บันทึกว่ายื่นแล้ว',
      'ดูรูปที่เก็บไว้', '“พิมพ์แล้วเซ็นเอง” แล้วกด “บันทึก” รูปที่เก็บไว้จะถูกลบ']) assert.ok(text.includes(phrase), phrase);
  });

  it('keeps reader-facing guide text within reviewed bounds including E44', () => {
    // E44 adds the approved H-1 explanation and replaces the WHT summary with H-2.
    for (const [guide, limit] of [[buildExpensesGuide('co'), 11243], [buildReimbursementGuide('co'), 43225],
      [buildSubstituteReceiptGuide('co'), 10777], [buildTaxGuide('co'), 6038]] as const) {
      assert.ok(sentences(guide).join('').length <= limit, `${guide.key}: ${sentences(guide).join('').length} > ${limit}`);
    }
  });
});

it('D3: guide tells who gets confirmed-duplicate notices and one reminder per blocked period', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create']));
  assert.match(text, /ใบเสร็จของใบเบิกยืนยันว่าซ้ำ/);
  assert.match(text, /ผู้เบิกยกเลิกเองไม่ได้/);
  assert.match(text, /เตือนครั้งเดียวในช่วงที่ติดรายการซ้ำ/);
});

it('CLAIM-DETAIL guide names the merged signature card, payment menu and missing-field navigation', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.payment.record'], ['STAFF']));
  assert.ok(text.includes('ลายเซ็นและใบเบิกที่เซ็นแล้ว'));
  assert.ok(text.includes('กด “เพิ่มเติม” แล้วเลือก “ยกเลิกรายการจ่ายนี้”'));
  assert.ok(text.includes('ปุ่มจะพาไปยังจุดที่ต้องเติม'));
  assert.doesNotMatch(text, /กล่อง “ลายเซ็นในใบเบิก”|กล่อง “ใบเบิกที่เซ็นแล้ว”/);
});


it('CLAIM-STEPS guide keeps signing after payment and offers either system or paper in the document step', () => {
  const text = JSON.stringify(buildReimbursementGuide('co', ['reimbursement.read_own', 'reimbursement.create', 'reimbursement.payment.record'], ['STAFF']));
  assert.match(text, /ส่ง → อนุมัติ → จ่ายเงินคืน → เซ็น/);
  assert.match(text, /หลังจ่ายครบ/);
  assert.match(text, /เลือก “เซ็นในระบบ” หรือ “เซ็นบนกระดาษ”/);
  assert.match(text, /แนบใบที่เซ็นแล้ว/);
  assert.match(text, /กด “เพิ่มเติม” ของรายการจ่าย แล้วเลือก “แนบหลักฐานการจ่ายเพิ่ม”/);
  assert.doesNotMatch(text, /พร้อมจ่าย ให้เซ็น|กลับมาพร้อมจ่ายก่อน/);
});


it('PWS-GUIDE-D expense and substitute guides use plain capture, category and VAT instructions', () => {
  const expenses = sentences(buildExpensesGuide('co', OWNER)).join(' ');
  assert.match(expenses, /จัดกลุ่มค่าใช้จ่ายให้ค้นหาและส่งให้ผู้ทำบัญชี/);
  assert.match(expenses, /ส่งใบเสร็จให้ระบบอ่านและเก็บเป็นร่างเพื่อตรวจ/);
  assert.match(expenses, /ถ้าแก้เอกสารไม่ได้ ให้อ่านเหตุผลและใช้ทางแก้ที่หน้ารายจ่ายแสดง/);
  const substitute = sentences(buildSubstituteReceiptGuide('co', OWNER)).join(' ');
  assert.match(substitute, /ใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้ และยังต้องตรวจหัก ณ ที่จ่ายตามรายการ/);
  assert.match(substitute, /ใช้ไม่ได้ ถ้าต้องการใช้ VAT ให้ขอใบกำกับภาษีจากผู้ขายที่จด VAT/);
  assert.doesNotMatch(substitute, /ขอคืนภาษีมูลค่าเพิ่ม|เครดิตภาษีซื้อ/);
});

it('PWS-WHT-GUIDE quotes the plain payment column and monthly filing entry', () => {
  const guide = buildTaxGuide('co', ['wht.pnd53.read']);
  const section = guide.sections.find(item => item.id === 'wht')!;
  const table = section.blocks.find(block => block.kind === 'table');
  assert.ok(table?.kind === 'table');
  assert.equal(table.headers[0], 'จ่ายค่าอะไร');
  const starting = sentences(buildGettingStartedGuide('co', ['wht.pnd53.read'], [...TIER_FEATURE_PRESETS.ENTERPRISE_1999]));
  assert.ok(starting.includes('เลือกเดือนที่หน้า “ภาษีหัก ณ ที่จ่าย” เพื่อตรวจรายการก่อนยื่น'));
});


it('PWS-GUIDE-OWNER pins every owner-approved guide sentence from items 10–21', () => {
  const expenses = sentences(buildExpensesGuide('co', OWNER));
  const substitute = sentences(buildSubstituteReceiptGuide('co', OWNER));
  assert.ok(expenses.some(text => text.includes("จัดกลุ่มค่าใช้จ่ายให้ค้นหาและส่งให้ผู้ทำบัญชี")), "item 10");
  assert.ok(expenses.some(text => text.includes("เลือก “ประเภทเอกสาร” ตอบ “ใช้เป็นหลักฐานรายจ่ายได้ไหม” แล้วเลือกหมวดหมู่ ผู้ตรวจเลือก “ใช้ VAT ตอนยื่นภาษี” และตรวจเงื่อนไขให้ครบ แล้วกด “ถัดไป”")), "item 11");
  assert.ok(expenses.some(text => text.includes("ถ้าแก้เอกสารไม่ได้ ให้อ่านเหตุผลและใช้ทางแก้ที่หน้ารายจ่ายแสดง")), "item 12");
  assert.ok(expenses.some(text => text.includes("ส่งใบเสร็จให้ระบบอ่านและเก็บเป็นร่างเพื่อตรวจ")), "item 13");
  assert.ok(expenses.some(text => text.includes("ยอด VAT ตามเอกสารยังไม่ยืนยันว่าใช้ตอนยื่นภาษีได้ ให้ผู้ทำบัญชีตรวจเอกสารจากชุดที่ส่งออก")), "item 14");
  assert.ok(expenses.some(text => text.includes("จัดกลุ่มค่าใช้จ่ายให้ค้นหาและส่งให้ผู้ทำบัญชีตามสิทธิ์ของคุณ")), "item 15");
  assert.ok(expenses.some(text => text.includes("ยอด VAT ตามเอกสารใช้ตอนยื่นภาษีได้ไหม")), "item 16");
  assert.ok(expenses.some(text => text.includes("ยังไม่แน่ ให้ผู้ทำบัญชีตรวจเงื่อนไขและหลักฐานจากชุดที่ส่งออกก่อนนำ VAT ไปใช้ตอนยื่นภาษี")), "item 17");
  assert.ok(expenses.some(text => text.includes("กรอกเลขผู้เสียภาษีผู้ขาย 13 หลักจากใบกำกับภาษีเต็มรูป ถ้าผู้ขายไม่ได้จด VAT ให้เปลี่ยนประเภทเอกสารให้ตรงความจริง")), "item 18");
  assert.ok(substitute.some(text => text.includes("ใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้ และยังต้องตรวจหัก ณ ที่จ่ายตามรายการ")), "item 19");
  assert.ok(substitute.some(text => text.includes("ใช้ VAT จากใบรับรองแทนใบเสร็จตอนยื่นภาษีได้ไหม")), "item 20");
  assert.ok(substitute.some(text => text.includes("ใช้ไม่ได้ ถ้าต้องการใช้ VAT ให้ขอใบกำกับภาษีจากผู้ขายที่จด VAT")), "item 21");
});

it('E44 tax WHT guide shows the approved e-WHT explanation and current catalogue summary', async () => {
  const { E_WHT_WORDS } = await import('@watchdog-bms/contracts');
  for (const permissions of [['expense.read_own'], OWNER]) {
    const guide = buildTaxGuide('co', permissions);
    const section = guide.sections.find(section => section.id === 'wht')!;
    assert.equal(section.summary, E_WHT_WORDS['H-2']);
    assert.ok(sentences({ ...guide, sections: [section] }).includes(E_WHT_WORDS['H-1']));
  }
});
