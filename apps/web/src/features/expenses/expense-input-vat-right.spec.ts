import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inputVatRightLabel, showInputVatQuestion, showListedInputVatRight } from './expense-input-vat-right.logic';
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
for (const [name, file, start, end] of [
  ['manual', 'ExpensesPages.tsx', 'function ManualExpensePanel', ''],
  ['review', 'ExpensesPages.tsx', 'const saveDocumentReview =', 'const overrideClassification'],
  ['draft', 'ExpensesPages.tsx', 'const disallowsTaxCode = !allowsDomesticInputTaxCode', 'setInfo('],
  ['certificate', 'SubstituteReceiptWizardPage.tsx', 'const created = await createExpenseDraft', 'const submit'],
]) it(`${name} form never supplies the input VAT right`, () => {
  const text = source(file); const from = text.indexOf(start); assert.ok(from >= 0, start);
  const to = end ? text.indexOf(end, from) : -1;
  assert.doesNotMatch(text.slice(from, to < 0 ? undefined : to), /inputVatClaimStatus\s*:/);
});
it('only shows the question for VAT papers outside a nonregistered shop', () => {
  for (const vatStatus of ['REGISTERED', 'UNKNOWN']) assert.equal(showInputVatQuestion({ vatAmount: '7', inputVatRight: { vatStatus } } as any), true);
  assert.equal(showInputVatQuestion({ vatAmount: '7', inputVatRight: { vatStatus: 'NOT_REGISTERED' } } as any), false);
  assert.equal(showInputVatQuestion({ vatAmount: '0' } as any), false);
});
it('names waiting, decided and legacy rights without inventing a decision', () => {
  assert.equal(inputVatRightLabel({ inputVatClaimStatus: 'NEEDS_REVIEW' } as any), 'รอตรวจสอบ');
  assert.equal(inputVatRightLabel({ inputVatClaimStatus: 'CLAIMABLE' } as any), 'ใช้ได้ตามเงื่อนไข');
  assert.equal(inputVatRightLabel({ inputVatClaimStatus: 'NON_CLAIMABLE', inputVatRight: { reasonCode: 'RECORDED_BEFORE_INPUT_VAT_DECISION' } } as any), 'ไม่ได้ใช้ VAT ตอนยื่นภาษี เพราะบันทึกไว้ก่อนเริ่มตรวจ');
});

import { mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const api = mutable('./expenses.api');
const select = mutable('@/common/components/field/ThemedSelect');
const { ExpenseInputVatRight } = require('./ExpenseInputVatRight');
const fixture: any = { id: 'e1', vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW', inputVatRight: {
  status: 'NEEDS_REVIEW', fixed: false, vatStatus: 'REGISTERED', reasonCode: null, latestDecision: null,
  conditions: ['SHOP_REGISTERED', 'CLAIMABLE_TYPE', 'PAPER_ATTACHED', 'SELLER_TAX_ID', 'DOCUMENT_NUMBER', 'USABLE_EVIDENCE', 'BUYER_MATCH'].map(code => ({ code, answer: true, source: 'SYSTEM', fact: code === 'BUYER_MATCH' ? { registry: { registeredName: 'ร้านเรา', taxId: '0100000000002' } } : {} })),
} };
function plainChooser() { return mock.method(select, 'ThemedSelect', function ThemedSelect(props: any) { return h('select', props, props.children); }); }
it('step Next keeps a waiting right without a decision and submits only the shared ticks on an explicit choice', async () => {
  const chooser = plainChooser(); let payload: any;
  const decide = mock.method(api, 'decideExpenseInputVat', async (_company: string, _expense: string, input: any) => { payload = input; });
  const saveRef = { current: null as (() => Promise<boolean>) | null };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: fixture, canReview: true, saveRef }));
  try {
    view.render(true); assert.equal(await saveRef.current!(), true); assert.equal(payload, undefined);
    view.find('ThemedSelect').onChange({ target: { value: 'CLAIMABLE' } }); view.render(true);
    const boxes = view.nodes.filter(node => node.tag === 'input' && node.props.type === 'checkbox'); assert.equal(boxes.length, 3);
    for (const box of boxes) box.props.onChange({ target: { checked: true } });
    view.render(true); assert.equal(await saveRef.current!(), true);
    assert.deepEqual(payload, { toStatus: 'CLAIMABLE', reason: '', buyerConfirmed: false, reviewerConditions: ['BUSINESS_USE', 'NOT_PROHIBITED', 'ISSUER_ENTITLED'] });
  } finally { view.cleanup(); chooser.mock.restore(); decide.mock.restore(); }
});
it('plain shops have no new field; other readers and fixed types see facts', () => {
  for (const vatStatus of ['NOT_REGISTERED', 'REGISTERED', 'UNKNOWN']) {
    const detail = { ...fixture, inputVatRight: { ...fixture.inputVatRight, vatStatus } };
    const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: false }));
    const html = view.render(); assert.doesNotMatch(html, /select|checkbox|textarea|ตรวจ VAT สำหรับยื่นภาษี/);
    if (vatStatus === 'NOT_REGISTERED') assert.equal(html, ''); else assert.match(html, /ใช้ VAT ตอนยื่นภาษี/);
  }
  const fixed = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: { ...fixture, inputVatClaimStatus: 'NON_CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, status: 'NON_CLAIMABLE', fixed: true, reasonCode: 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE' } }, canReview: true }));
  assert.match(fixed.render(), /ขอใบกำกับภาษีเต็มรูปจากผู้ขาย/); assert.doesNotMatch(fixed.render(), /select|checkbox/);
});
it('posted journals show the fact without a decision button or an impossible reopen remedy', () => {
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: { ...fixture, inputVatRight: { ...fixture.inputVatRight, decisionBlocker: 'input_vat_posted_journal_immutable' } }, canReview: true }));
  assert.match(view.render(), /แก้คำตอบเรื่อง VAT ของรายการนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจต่อ/); assert.doesNotMatch(view.render(), /<button|แก้ไขเอกสาร/);
});
it('unknown shop and unread buyer facts expose their fix beside the failing condition', () => {
  const chooser = plainChooser();
  const detail = { ...fixture, inputVatRight: { ...fixture.inputVatRight, vatStatus: 'UNKNOWN', buyerMatchStatus: 'UNCHECKED', conditions: fixture.inputVatRight.conditions.map((c: any) => ({ ...c, answer: !['SHOP_REGISTERED', 'BUYER_MATCH', 'SELLER_TAX_ID'].includes(c.code) })) } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, canAnswerVatStatus: true, canEditShopIdentity: true, saveRef: { current: null }, fixAction: (key: string) => h('button', {}, key) }));
  try {
    view.render(); view.find('ThemedSelect').onChange({ target: { value: 'CLAIMABLE' } });
    const html = view.render(); assert.match(html, /settings\/profile\?returnTo=/); assert.match(html, /ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว/); assert.match(html, /vendor_tax_id/);
  } finally { chooser.mock.restore(); }
});
it('server refusal stays at the field, and a confirmed decision saves through its own endpoint', async () => {
  const chooser = plainChooser(); let fail = true, refreshed = 0;
  const decide = mock.method(api, 'decideExpenseInputVat', async () => { if (fail) throw Object.assign(new Error('missing'), { code: 'input_vat_reason_required' }); });
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: fixture, canReview: true, onSaved: async () => { refreshed++; } }));
  try {
    view.render(); view.find('button').onClick(); view.render(); view.find('ThemedSelect').onChange({ target: { value: 'NON_CLAIMABLE' } }); view.render();
    await view.find('button', p => p.children.includes('บันทึกคำตอบเรื่อง VAT')).onClick();
    assert.match(view.render(), /role="alert"/); assert.equal(refreshed, 0);
    view.find('textarea').onChange({ target: { value: 'ใช้ส่วนตัว' } }); fail = false; view.render();
    await view.find('button', p => p.children.includes('บันทึกคำตอบเรื่อง VAT')).onClick(); assert.equal(refreshed, 1);
  } finally { chooser.mock.restore(); decide.mock.restore(); }
});
it('UX6 hides summary and history for unregistered shops and VAT-free papers', () => {
  const { InputVatDecisionHistory } = require('./ExpenseInputVatRight');
  for (const vatStatus of ['REGISTERED', 'UNKNOWN', 'NOT_REGISTERED']) {
    for (const vatAmount of ['0', '7']) {
      const detail = { ...fixture, vatAmount, inputVatRight: { ...fixture.inputVatRight, vatStatus } };
      for (const component of [InputVatDecisionHistory, ExpenseInputVatRight]) {
        const view = certificateHarness(() => h(component, { companyId: 'co', detail, canReview: true }));
        try {
          const html = view.render();
          if (vatStatus === 'NOT_REGISTERED' || vatAmount === '0') assert.equal(html, '');
          else assert.match(html, /ใช้ VAT ตอนยื่นภาษี/);
        } finally { view.cleanup(); }
      }
    }
  }
});
it('UX6 names a later decision change and asks its reason before the right and conditions', () => {
  const chooser = plainChooser();
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, status: 'CLAIMABLE', latestDecision: { decidedByName: 'ผู้ตรวจ', decidedAt: '2026-10-14T01:00:00Z', reason: 'ตรวจแล้ว' } } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true }));
  try {
    assert.match(view.render(), />เปลี่ยนคำตอบเรื่อง VAT</);
    view.find('button').onClick(); const html = view.render();
    assert.ok(html.indexOf('aria-label="เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี"') < html.indexOf('<select'));
    assert.ok(html.indexOf('aria-label="เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี"') < html.indexOf('type="checkbox"'));
  } finally { view.cleanup(); chooser.mock.restore(); }
});

it('UX6 lists show only rights applicable on the document date, including before registration changes', () => {
  assert.equal(showListedInputVatRight({ vatAmount: '7', inputVatRightVisible: false }), false);
  assert.equal(showListedInputVatRight({ vatAmount: '7', inputVatRightVisible: true }), true);
  assert.equal(showListedInputVatRight({ vatAmount: '0', inputVatRightVisible: true }), false);
  assert.equal(showListedInputVatRight({ vatAmount: '7' }), false);
  assert.match(source('ExpensesPages.tsx'), /showListedInputVatRight\(e\)/);
  assert.doesNotMatch(source('ExpensesPages.tsx'), /vatRightFilter|hasListedInputVatRights/);
  assert.match(source('ExpensesPages.tsx'), /e.inputVatClaimStatus === 'NEEDS_REVIEW'.*รอตรวจ VAT สำหรับยื่นภาษี/);
});

it('UX7 changing a decision restores saved ticks and an unchanged reviewer-confirmed buyer', () => {
  const chooser = plainChooser();
  const conditions = [...fixture.inputVatRight.conditions.map((c: any) => c.code === 'BUYER_MATCH' ? { ...c, source: 'REVIEWER', fact: { printed: {}, registry: { registeredName: 'ร้านเดิม', taxId: '0100000000002' } } } : c),
    ...['BUSINESS_USE', 'NOT_PROHIBITED', 'ISSUER_ENTITLED'].map(code => ({ code, answer: true, source: 'REVIEWER', fact: {} }))];
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, status: 'CLAIMABLE', buyerMatchStatus: 'UNCHECKED',
    conditions: conditions.map(c => c.code === 'BUYER_MATCH' ? { ...c, answer: false, fact: { registry: { registeredName: 'ร้านเดิม', taxId: '0100000000002' }, printed: {} } } : c.source === 'REVIEWER' ? { ...c, answer: false } : c),
    latestDecision: { conditions, decidedByName: 'ผู้ตรวจ', decidedAt: '2026-10-14T01:00:00Z' } } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true }));
  try {
    view.render(); view.find('button').onClick(); const html = view.render();
    const boxes = view.nodes.filter(n => n.tag === 'input' && n.props.type === 'checkbox');
    assert.equal(boxes.length, 4); assert.ok(boxes.every(n => n.props.checked));
    assert.doesNotMatch(html, /ยังไม่ครบ:.*ชื่อและเลขผู้เสียภาษีของร้าน/);
    assert.doesNotMatch(html, /ข้อมูลเปลี่ยนจากครั้งที่ตรวจไว้/, 'JSON object key order is not a changed fact');
  } finally { view.cleanup(); chooser.mock.restore(); }
});
it('UX7 a changed buyer fact asks for a new check beside its explanation', () => {
  const chooser = plainChooser();
  const buyer = { code: 'BUYER_MATCH', answer: true, source: 'REVIEWER', fact: { registry: { registeredName: 'ร้านเดิม', taxId: '0100000000002' }, printed: {} } };
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, status: 'CLAIMABLE', buyerMatchStatus: 'UNCHECKED',
    conditions: [{ ...buyer, answer: false, fact: { registry: { registeredName: 'ร้านใหม่', taxId: '0100000000002' }, printed: {} } }],
    latestDecision: { conditions: [buyer], decidedByName: 'ผู้ตรวจ', decidedAt: '2026-10-14T01:00:00Z' } } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true }));
  try {
    view.render(); view.find('button').onClick(); const html = view.render();
    assert.match(html, /ข้อมูลเปลี่ยนจากครั้งที่ตรวจไว้ ตรวจเงื่อนไขนี้อีกครั้ง/);
    assert.equal(view.find('input').checked, false);
  } finally { view.cleanup(); chooser.mock.restore(); }
});
it('UX7 the change form leaves the fact row and uses one left-aligned full-width field label', () => {
  const chooser = plainChooser();
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: fixture, canReview: true, showLabel: false,
    renderReadOnly: (content: any) => h('dl', { 'data-fact-row': true }, h('dt', {}, 'ใช้ VAT ตอนยื่นภาษี'), h('dd', {}, content)) }));
  try {
    assert.match(view.render(), /data-fact-row/); view.find('button').onClick(); const html = view.render();
    assert.doesNotMatch(html, /data-fact-row/); assert.match(html, /w-full[^"<>]*text-left/);
    assert.equal((html.match(/>ใช้ VAT ตอนยื่นภาษี</g) ?? []).length, 1);
  } finally { view.cleanup(); chooser.mock.restore(); }
});

it('UX8 missing shop identity offers the profile return link instead of a buyer tick', () => {
  const chooser = plainChooser();
  for (const field of ['registeredName', 'taxId']) {
    const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, buyerMatchStatus: 'UNCHECKED', conditions: [{ code: 'BUYER_MATCH', answer: false, fact: { registry: { registeredName: 'ร้านเรา', taxId: '0100000000002', [field]: '' } } }] } };
    const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, canAnswerVatStatus: true, canEditShopIdentity: true, saveRef: { current: null } }));
    try {
      const html = view.render();
      assert.match(html, /กรอกชื่อจดทะเบียนและเลขผู้เสียภาษีของร้านที่ข้อมูลร้าน/);
      assert.doesNotMatch(html, /ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน/);
      const link = view.nodes.find(node => node.props.href?.includes('settings/profile'));
      assert.ok(link);
      const url = new URL(link.props.href, 'https://local.test');
      assert.equal(url.searchParams.get('returnTo'), '/companies/co/expenses/e1#expense-input-vat-e1');
      assert.equal(url.hash, '#shop');
    } finally { view.cleanup(); }
  }
  chooser.mock.restore();
});
it('UX8 the buyer condition turns to a check as soon as its reviewer ticks it', () => {
  const chooser = plainChooser();
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, buyerMatchStatus: 'UNCHECKED', conditions: [{ code: 'BUYER_MATCH', answer: false, fact: { registry: { registeredName: 'ร้านเรา', taxId: '0100000000002' } } }] } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, saveRef: { current: null } }));
  try {
    assert.match(view.render(), /ยังไม่ครบ:.*ชื่อและเลขผู้เสียภาษีของร้าน/);
    view.find('input').onChange({ target: { checked: true } });
    const html = view.render(); assert.match(html, /✓.*ชื่อและเลขผู้เสียภาษีของร้าน/); assert.doesNotMatch(html, /ยังไม่ครบ:/);
  } finally { view.cleanup(); chooser.mock.restore(); }
});

it('UX8 returning from shop settings opens and focuses the VAT section', () => {
  const chooser = plainChooser();
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let focused = 0, scrolled = 0;
  (globalThis as any).window = { location: { hash: '#expense-input-vat-e1' } };
  (globalThis as any).document = { getElementById: (id: string) => {
    assert.equal(id, 'expense-input-vat-e1'); return { scrollIntoView: () => scrolled++, focus: () => focused++ };
  } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail: fixture, canReview: true }));
  try {
    view.render(true); const html = view.render(true);
    assert.match(html, /<section[^>]*id="expense-input-vat-e1"/); assert.equal(focused, 1); assert.equal(scrolled, 1);
  } finally { view.cleanup(); chooser.mock.restore(); (globalThis as any).window = previousWindow; (globalThis as any).document = previousDocument; }
});

it('UX8 shop identity fixes use the identity permission, independently of the VAT-answer permission', () => {
  const chooser = plainChooser();
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, conditions: [{ code: 'BUYER_MATCH', answer: false, fact: { registry: {} } }] } };
  try {
    for (const canEditShopIdentity of [true, false]) {
      const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, canEditShopIdentity, canAnswerVatStatus: !canEditShopIdentity, saveRef: { current: null } }));
      try {
        const html = view.render();
        assert.equal(html.includes('settings/profile?'), canEditShopIdentity);
        assert.equal(html.includes('ให้เจ้าของกิจการหรือผู้ดูแลร้านกรอกข้อมูลร้านก่อน'), !canEditShopIdentity);
      } finally { view.cleanup(); }
    }
  } finally { chooser.mock.restore(); }
});

it('EVID-1 names an acknowledged paper original without claiming that an image was attached', () => {
  const chooser = plainChooser();
  const detail = { ...fixture, inputVatClaimStatus: 'CLAIMABLE', inputVatRight: { ...fixture.inputVatRight, conditions: fixture.inputVatRight.conditions.map((condition: any) => condition.code === 'PAPER_ATTACHED' ? { ...condition, source: 'REVIEWER', fact: { attachmentIds: [], originalDocumentAvailable: true } } : condition) } };
  const view = certificateHarness(() => h(ExpenseInputVatRight, { companyId: 'co', detail, canReview: true, saveRef: { current: null } }));
  try { const html = view.render(); assert.match(html, /✓ มีเอกสารตัวจริง/); assert.doesNotMatch(html, /แนบเอกสารแล้ว/); }
  finally { view.cleanup(); chooser.mock.restore(); }
});
