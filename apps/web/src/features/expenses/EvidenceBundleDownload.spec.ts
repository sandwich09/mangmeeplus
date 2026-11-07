import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const api = mutable('./expenses.api');
const { EvidenceBundleActions, EvidenceBundleDownload } = require('./EvidenceBundleDownload');

test('one archive, multiple parts, and an empty month have distinct readable actions in the shared group', () => {
  for (const [plan, expected] of [
    [{ fileCount: 0, partCount: 0 }, 'เดือนนี้ยังไม่มีไฟล์หลักฐาน'],
    [{ fileCount: 1, partCount: 1 }, 'ดาวน์โหลดไฟล์ทั้งหมด'],
    [{ fileCount: 121, partCount: 3 }, 'เดือนนี้มี 121 ไฟล์ แบ่งเป็น 3 ชุด'],
  ] as const) {
    const downloads: number[] = [];
    const view = certificateHarness(() => h(EvidenceBundleActions, { plan, busy: false, allMonths: false, onDownload: (part: number) => downloads.push(part) }));
    const html = view.render();
    assert.ok(html.includes(expected));
    const buttons = view.nodes.filter(node => node.tag === 'button');
    assert.equal(buttons.length, plan.partCount);
    buttons.forEach(button => button.props.onClick());
    assert.deepEqual(downloads, Array.from({ length: plan.partCount }, (_, i) => i + 1));
    if (plan.partCount > 1) { assert.match(html, /ไฟล์ชุดที่ 1 จาก 3/); assert.match(html, /ไฟล์ชุดที่ 3 จาก 3/); assert.match(html, /mangmee-actions/); }
    assert.doesNotMatch(html, /max-w-/);
  }
});

test('all-month wording and busy controls describe the actual selection and download state', () => {
  const view = certificateHarness(() => h(EvidenceBundleActions, { plan: { fileCount: 61, partCount: 2 }, busy: true, allMonths: true, onDownload: () => {} }));
  assert.match(view.render(), /ช่วงนี้มี 61 ไฟล์ แบ่งเป็น 2 ชุด/);
  for (const button of view.nodes.filter(node => node.tag === 'button')) { assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true); }
});

test('plan reads once with the exact selection; disabled/unmounted selections cannot expose stale results', async () => {
  const calls: unknown[] = [];
  let finish!: (value: unknown) => void;
  const fetch = mock.method(api, 'planAccountantEvidenceBundle', (...args: unknown[]) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); });
  const request = { yearMonth: '2026-10', dateField: 'expenseDate', branchId: 'b1', expenseIds: ['e1'] };
  const disabled = certificateHarness(() => h(EvidenceBundleDownload, { companyId: 'co', request, enabled: false }));
  const view = certificateHarness(() => h(EvidenceBundleDownload, { companyId: 'co', request, enabled: true }));
  try {
    disabled.render(true); assert.deepEqual(calls, []);
    view.render(true); assert.deepEqual(calls, [['co', request]]);
    view.cleanup(); finish({ fileCount: 1, partCount: 1 }); await view.settle();
    assert.equal(view.state[0], null, 'a late previous-filter plan stays hidden');
  } finally { disabled.cleanup(); view.cleanup(); fetch.mock.restore(); }
});

test('a completed part downloads once under its server filename, and a refusal leaves a retry', async () => {
  const downloads: unknown[] = [];
  const blob = new Blob(['zip']);
  const download = mock.method(api, 'downloadBlob', (...args: unknown[]) => { downloads.push(args); });
  const fetch = mock.method(api, 'fetchAccountantEvidenceBundle', async () => ({ blob, fileName: 'หลักฐาน-2026-10.zip' }));
  const view = certificateHarness(() => h(EvidenceBundleDownload, { companyId: 'co', request: { yearMonth: '2026-10' }, enabled: true }), [{ fileCount: 1, partCount: 1 }, null, false, 0]);
  try {
    view.render(); view.find('EvidenceBundleActions').onDownload(1); await view.settle();
    assert.deepEqual(downloads, [[blob, 'หลักฐาน-2026-10.zip']]);
    fetch.mock.mockImplementation(async () => { throw new Error('โหลดไฟล์ไม่ได้ ลองอีกครั้ง'); });
    view.render(); view.find('EvidenceBundleActions').onDownload(1); await view.settle();
    const html = view.render(); assert.match(html, /role="alert"/); assert.match(html, /ลองอีกครั้ง/);
    assert.equal(downloads.length, 1);
  } finally { fetch.mock.restore(); download.mock.restore(); view.cleanup(); }
});

test('denied bundle plans and downloads offer returning to expenses alongside retry', () => {
  for (const withPlan of [false, true]) for (const inDialog of [false, true]) {
    let returned = false;
    const view = certificateHarness(() => h(EvidenceBundleDownload, { companyId: 'co', request: {}, enabled: true,
      ...(inDialog ? { onReturnToExpenses: () => { returned = true; } } : {}) }),
      [withPlan ? { fileCount: 1, partCount: 1 } : null, 'ร้านนี้ใช้ได้เฉพาะอ่านเอกสารและเก็บร่าง', false, 0]);
    try {
      const html = view.render();
      assert.match(html, /กลับไปรายการค่าใช้จ่าย/); assert.match(html, /ลองอีกครั้ง/);
      if (inDialog) {
        const back = view.nodes.find(node => node.tag === 'button' && node.props.children.includes('กลับไปรายการค่าใช้จ่าย'));
        assert.ok(back); back.props.onClick(); assert.equal(returned, true);
      } else assert.match(html, /href="\/companies\/co\/expenses"/);
    } finally { view.cleanup(); }
  }
});

test('the accountant bundle names all paper counts and warns about missing receipts', () => {
  const plan = { fileCount: 8, partCount: 1, counts: { receipts: 2, substituteReceipts: 1, paymentSlips: 2, vouchers: 2, whtCertificates: 1 }, missingReceiptCount: 3 };
  const view = certificateHarness(() => h(EvidenceBundleActions, { plan, showCounts: true, busy: false, allMonths: false, onDownload: () => {} }));
  const html = view.render();
  assert.match(html, /เอกสารค่าใช้จ่าย 2 · ใบรับรองแทนใบเสร็จ 1 · หลักฐานการจ่าย 2 · ใบสำคัญจ่าย 2 · 50 ทวิ 1/);
  assert.match(html, /ยังไม่มีใบเสร็จ 3 รายการ/);
  const existingPanel = certificateHarness(() => h(EvidenceBundleActions, { plan, busy: false, allMonths: false, onDownload: () => {} }));
  assert.doesNotMatch(existingPanel.render(), /ใบสำคัญจ่าย 2|ยังไม่มีใบเสร็จ 3 รายการ/);
});


test('accounting evidence uses the primary bundle action and keeps split archives and their busy state', () => {
  for (const parts of [1, 2]) {
    const downloads: number[] = [];
    const view = certificateHarness(() => h(EvidenceBundleActions, { accountant: true, plan: { fileCount: 121, partCount: parts }, busy: false, allMonths: false, onDownload: (part: number) => downloads.push(part) }));
    const html = view.render();
    if (parts === 1) assert.match(html, /ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี/);
    else { assert.match(html, /ดาวน์โหลดชุดที่ 1 จาก 2/); assert.match(html, /ดาวน์โหลดชุดที่ 2 จาก 2/); }
    assert.doesNotMatch(html, /ดาวน์โหลดไฟล์ทั้งหมด/);
    const buttons = view.nodes.filter(node => node.tag === 'button');
    assert.equal(buttons.length, parts);
    buttons.forEach((button, index) => { assert.match(button.props.className, index === 0 ? /primary/ : /secondary/); button.props.onClick(); });
    assert.deepEqual(downloads, Array.from({ length: parts }, (_, i) => i + 1));
    view.cleanup();
  }
});


test('bundle hints and actions match available files', () => {
  for (const fileCount of [0, 2]) {
    const view = certificateHarness(() => h(EvidenceBundleActions, { accountant: true, showCounts: true,
      plan: { fileCount, partCount: fileCount ? 1 : 0, counts: { receipts: 1, paymentSlips: 1 }, missingReceiptCount: 0 },
      busy: false, allMonths: false, onDownload() {}, excelAction: h('button', {}, 'ดาวน์โหลด Excel') }));
    const html = view.render();
    assert.match(html, /ดาวน์โหลด Excel/);
    if (fileCount) {
      assert.match(html, /เอกสารค่าใช้จ่าย 1 · หลักฐานการจ่าย 1/);
      assert.match(html, /แตกไฟล์ ZIP ก่อน แล้วเปิด สารบัญ.xlsx ในคอมพิวเตอร์ เพื่อกดเปิดเอกสาร/);
      const group = view.find('ActionGroup');
      assert.ok(group.children.flat().some((child: any) => child?.props?.children === 'ดาวน์โหลด Excel'));
    } else assert.doesNotMatch(html, /แตกไฟล์ ZIP ก่อน/);
    view.cleanup();
  }
});

test('accountant counts include supporting files signed claims and record packets', () => {
  const plan = { fileCount: 11, partCount: 2, counts: { receipts: 2, substituteReceipts: 1, paymentSlips: 2, vouchers: 1, supportingFiles: 1, whtCertificates: 1, claimForms: 1, recordPacks: 2 }, missingReceiptCount: 0 };
  const view = certificateHarness(() => h(EvidenceBundleActions, { accountant: true, plan, showCounts: true, busy: true, allMonths: false, onDownload() {} }));
  assert.match(view.render(), /เอกสารประกอบการจ่าย 1 · 50 ทวิ 1 · ใบเบิก 1 · ชุดเอกสารรายการ 2/);
  const buttons = view.nodes.filter(node => node.tag === 'button');
  assert.equal(buttons.filter(button => button.props.className.includes('primary')).length, 1);
  for (const button of buttons) { assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true); }
  view.cleanup();
});
