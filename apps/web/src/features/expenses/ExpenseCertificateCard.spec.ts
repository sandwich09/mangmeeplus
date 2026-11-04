import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { WHT_HANDOFF_MISSING_LABELS, type WhtCertificateHandoffListRowDto } from '@watchdog-bms/contracts';
import { ToastContext } from '@/common/components/toast/use-toast';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const outsideClick = mutable('@/common/hooks/use-close-on-outside-click');
const api = mutable('./expenses.api');
const modals = mutable('@/common/components/modal/Modal');
const { ExpenseCertificateCard } = require('./ExpenseCertificateCard');
const { ExpenseCertificateHistory } = require('./ExpenseCertificateHistory');
const { ExpenseCertificateCorrectionFields } = require('./ExpenseCertificateCorrectionFields');
const issue = ['wht.certificate.issue'], link = ['wht.external_certificate.link'], read = ['wht.certificate.read'];
test('WHT-OUTSIDE a shop without system certificates offers recording and the package line, never a system download', () => {
  for (const status of ['REQUIRED', 'SYSTEM_ISSUED'] as const) {
    const view = setup(row({ status, systemIssuanceOpen: true }), [...issue, ...link]);
    Object.assign(view.props, { systemCertificatesAvailable: false, children: h('button', null, 'พิมพ์ใบแทน') });
    try {
      const html = view.render();
      if (status === 'REQUIRED') assert.match(visible(html), /จดเลขที่ใบ 50 ทวิ/);
      assert.match(visible(html), /แพ็กนี้ทำใบ 50 ทวิ ในระบบไม่ได้ ทำนอกระบบแล้วจดเลขที่ไว้/);
      assert.doesNotMatch(html, /ออกหนังสือรับรอง 50 ทวิ<\/button>|ดาวน์โหลดหนังสือรับรอง|เพิ่มที่อยู่|พิมพ์ใบแทน/);
    } finally { view.cleanup(); }
  }
});
function row(over: Partial<WhtCertificateHandoffListRowDto> = {}): WhtCertificateHandoffListRowDto {
  return { id: 'handoff', status: 'REQUIRED', systemIssuanceOpen: true, missing: [], payerMissing: [], prefill: { payeeSnapshot: { name: 'ผู้รับเงิน', address: null } }, payeeAddress: 'ที่อยู่ผู้รับเงิน',
    certificateNumber: 'WHT-2', certificateIssuedAt: '2026-10-11', externalCertificateNumber: 'EXT-1', externalIssuedDate: '2026-10-10', externalPaymentDate: '2026-10-09', ...over } as WhtCertificateHandoffListRowDto;
}
function setup(value = row(), permissions = issue, options: { loading?: boolean; error?: string | null; history?: any[] } = {}) {
  const successes: string[] = [], changes: any[] = [];
  const props = { companyId: 'co', expenseId: 'expense', revision: 'v1', handoff: value, permissions, issueButton: h('button', { className: 'mangmee-btn-primary' }, 'ออกหนังสือรับรอง 50 ทวิ'), onDownload() {}, onChanged(next: any) { changes.push(next); }, primaryHidden: false, busy: false, error: null as string | null };
  const readState = { row: options.loading || options.error ? null : value, loading: options.loading ?? false, error: options.error ?? null };
  const initial = options.history ? [{ rows: options.history, loading: false, error: null }, 0, readState] : [readState];
  const view = certificateHarness(() => {
    const card = h(ExpenseCertificateCard, props);
    return h(ToastContext.Provider, { value: { success: message => successes.push(message), warning() {}, error() { throw Error('no duplicate error toast'); } } },
      options.history ? h(ExpenseCertificateHistory, { companyId: 'co', expenseId: 'expense', revision: 'v1', canRead: true, confirmed: true }, card) : card);
  }, initial);
  return { ...view, props, successes, changes };
}
const visible = (html: string) => html.replace(/<[^>]*>/g, '').replaceAll('&quot;', '"');
const primaryCount = (html: string) => (html.match(/<button[^>]*class="[^"]*mangmee-btn-primary/g) ?? []).length;
function openRecord(view: ReturnType<typeof setup>) {
  view.find('button', p => p.children.includes('จดเลขที่ใบ 50 ทวิ')).onClick(); view.render();
}
function type(view: ReturnType<typeof setup>, field: string, value: string) {
  view.find(field === 'note' || field === 'address' ? 'textarea' : field === 'date' || field === 'paymentDate' ? 'ThemedDate' : 'input', p => p.id === `certificate-${field}-expense`).onChange({ target: { value } }); view.render();
}
async function submit(view: ReturnType<typeof setup>) {
  view.find('form', p => p.id === 'certificate-expense').onSubmit({ preventDefault() {} }); await view.settle(); return view.render();
}

const modal = mock.method(modals, 'Modal', ({ open, title, children, footer }: any) => open ? h('section', { 'data-dialog': true }, h('h2', null, title), children, footer) : null);

test('WHT-OUTSIDE recording keeps required text fields and offers an optional file and moves the saved number to ทำใบแล้ว', async () => {
  const request = mock.method(api, 'linkExternalWhtCertificate', async () => row({ status: 'EXTERNAL_LINKED', externalCertificateNumber: 'OUT-1' }));
  const view = setup(row({ systemIssuanceOpen: false }), link);
  Object.assign(view.props, { systemCertificatesAvailable: false });
  try {
    view.render(); openRecord(view);
    const html = visible(view.render());
    for (const word of ['จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ', 'เลขที่ใบ', 'วันที่ทำใบ', 'เก็บใบจริงไว้ที่ (ไม่บังคับ)', 'หมายเหตุ']) assert.ok(html.includes(word), word);
    assert.match(view.render(), /type="file"/);
    assert.match(view.render(), /aria-label="แนบรูปหรือ PDF ของใบ \(ถ้ามี\)"/);
    assert.equal(view.find('ThemedFile', p => p.id === 'certificate-file-expense').required, undefined);
    type(view, 'number', 'OUT-1'); type(view, 'date', '2026-01-02'); type(view, 'paymentDate', '2026-01-01');
    await submit(view);
    assert.deepEqual(view.successes, ['จดเลขที่แล้ว ย้ายไป "ทำใบแล้ว"']);
    assert.equal(request.mock.callCount(), 1);
  } finally { request.mock.restore(); view.cleanup(); }
});

test('card always has its heading and one primary at most across every permission and certificate state', () => {
  const cases: [Partial<WhtCertificateHandoffListRowDto>, string[], string, number][] = [
    [{}, issue, 'ยังไม่ออก', 1],
    [{}, [...issue, ...link], 'ยังไม่ออก', 1],
    [{ systemIssuanceOpen: false }, [...issue, ...link], 'ยังไม่ได้บันทึกหนังสือรับรอง', 1],
    [{ systemIssuanceOpen: false }, link, 'ยังไม่ได้บันทึกหนังสือรับรอง', 1],
    [{}, read, 'ยังไม่ออก', 0],
    [{ missing: ['FORM_TYPE_UNRESOLVED'] }, issue, WHT_HANDOFF_MISSING_LABELS.FORM_TYPE_UNRESOLVED, 0],
    [{ missing: ['INCOME_CATEGORY_OR_RATE_MISSING'] }, issue, WHT_HANDOFF_MISSING_LABELS.INCOME_CATEGORY_OR_RATE_MISSING, 0],
    // Walk C: the next step is "แก้ไขเอกสาร"; the self-issued record stays a plain link, never the green button.
    [{ missing: ['FORM_TYPE_UNRESOLVED'] }, [...issue, ...link], WHT_HANDOFF_MISSING_LABELS.FORM_TYPE_UNRESOLVED, 0],
    [{ status: 'SYSTEM_ISSUED' }, issue, 'ออกแล้ว เลขที่ WHT-2 วันที่', 1],
    [{ status: 'SYSTEM_ISSUED' }, ['wht.certificate.correct'], 'ออกแล้ว เลขที่ WHT-2 วันที่', 1],
    [{ status: 'SYSTEM_ISSUED' }, link, 'ออกแล้ว เลขที่ WHT-2 วันที่', 1],
    [{ status: 'SYSTEM_ISSUED' }, read, 'ออกแล้ว เลขที่ WHT-2 วันที่', 1],
    [{ status: 'EXTERNAL_LINKED', externalEvidenceRef: 'ตู้เอกสาร', linkNote: 'ส่งแล้ว' }, link, 'ทำนอกระบบ เลขที่ EXT-1 วันที่', 0],
    [{ status: 'EXTERNAL_LINKED' }, read, 'ทำนอกระบบ เลขที่ EXT-1 วันที่', 0],
  ];
  for (const [over, permissions, sentence, count] of cases) {
    const view = setup(row(over), permissions), markup = view.render(), html = visible(markup);
    assert.ok(html.includes('หนังสือรับรอง 50 ทวิ'));
    assert.ok(html.includes(sentence), sentence); assert.equal(primaryCount(markup), count);
    assert.doesNotMatch(html, /REQUIRED|SYSTEM_ISSUED|EXTERNAL_LINKED|PND3|PND53|อัปเกรด|undefined/);
    if (permissions === read) {
      if (over.status === 'SYSTEM_ISSUED') {
        assert.match(markup, />ดาวน์โหลดหนังสือรับรอง<\/button>/);
        assert.equal((markup.match(/<button/g) ?? []).length, 1);
      } else assert.doesNotMatch(markup, /<button/);
    }
    if (over.missing) { assert.ok(html.includes('กด “แก้ไขเอกสาร” เพื่อเติมข้อมูล')); assert.doesNotMatch(html, /ออกหนังสือรับรอง 50 ทวิ/); }
    if (over.status === 'EXTERNAL_LINKED') assert.ok(html.includes('ทำนอกระบบ'));
  }
  const both = setup(row(), [...issue, ...link]); both.render();
  assert.match(both.find('button', p => p.children.includes('จดเลขที่ใบ 50 ทวิ')).className, /underline/);
  const external = visible(setup(row({ status: 'EXTERNAL_LINKED', externalEvidenceRef: 'ตู้เอกสาร', linkNote: 'ส่งแล้ว' }), link).render());
  assert.ok(external.includes('เลขอ้างอิง: ตู้เอกสาร')); assert.ok(external.includes('หมายเหตุ: ส่งแล้ว'));
});

test('system and self-issued status numbers stay together on a phone', () => {
  for (const [status, number] of [['SYSTEM_ISSUED', 'WHT-2'], ['EXTERNAL_LINKED', 'EXT-1']] as const) {
    const html = setup(row({ status })).render();
    assert.ok(html.includes(`<span class="whitespace-nowrap">${number}</span>`));
  }
});

test('walk C: the status is one run of text, the address comes before the issue button, a failed read is shown once', () => {
  const issued = setup(row({ status: 'SYSTEM_ISSUED' })).render();
  assert.match(issued, /mangmee-badge[^>]*>ออกแล้ว<\/span> <span><span class="inline-block max-w-full">เลขที่ <span class="whitespace-nowrap">WHT-2<\/span><\/span> <span class="whitespace-nowrap">วันที่ออก /);
  const pending = setup(row(), [...issue, ...link]).render();
  assert.ok(pending.indexOf('ที่อยู่ผู้รับเงินบนหนังสือรับรอง') < pending.indexOf('ออกหนังสือรับรอง 50 ทวิ'));
  const missing = setup(row({ missing: ['FORM_TYPE_UNRESOLVED'] }), [...issue, ...link]); missing.render();
  assert.match(missing.find('button', p => p.children.includes('จดเลขที่ใบ 50 ทวิ')).className, /underline/);
  const failed = setup(row(), issue, { error: 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้งอีกครั้ง' });
  failed.props.error = 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้งอีกครั้ง';
  assert.equal(failed.render().split('ระบบขัดข้องชั่วคราว').length - 1, 1);
});

test('walk C: a record refused because someone issued or recorded first uses this card\'s sentence and reloads the card', async () => {
  const request = mock.method(api, 'linkExternalWhtCertificate', async () => { throw Object.assign(Error('server words'), { code: 'wht_handoff_not_linkable' }); });
  const read = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows: [row({ status: 'SYSTEM_ISSUED' })] }));
  const view = setup(row({ systemIssuanceOpen: false }), link);
  try {
    view.render(); openRecord(view); type(view, 'number', 'EXT-9'); type(view, 'date', '2026-01-01'); type(view, 'paymentDate', '2025-12-31');
    const html = await submit(view);
    assert.match(html, /บันทึกไม่ได้ เพราะมีผู้ออกหรือบันทึกหนังสือรับรองของรายจ่ายนี้ไปก่อนแล้ว/); assert.doesNotMatch(html, /server words/);
    assert.match(html, /data-dialog/); assert.equal(view.find('input', p => p.id === 'certificate-number-expense').value, 'EXT-9');
  } finally { request.mock.restore(); read.mock.restore(); view.cleanup(); }
});

test('issued primary downloads through the existing callback and yields to the correction submit action', () => {
  for (const permissions of [issue, read]) {
  let downloads = 0;
  const view = setup(row({ status: 'SYSTEM_ISSUED' }), permissions);
  view.props.onDownload = () => { downloads++; };
  view.render(); view.find('button', p => p.children.includes('ดาวน์โหลดหนังสือรับรอง')).onClick();
  assert.equal(downloads, 1);
  view.props.primaryHidden = true;
  assert.doesNotMatch(view.render(), />ดาวน์โหลดหนังสือรับรอง<\/button>/);
  }
});

test('loading and refused reads stay inside a headed card, retry works and superseded reads are ignored', async () => {
  let calls = 0, resolveOld!: (value: any) => void;
  const request = mock.method(api, 'listWhtHandoffsPaged', async (...args: unknown[]) => {
    assert.deepEqual(args, ['co', { sourcePaymentId: 'expense', page: 1, pageSize: 100 }]);
    if (++calls === 1) return new Promise(resolve => { resolveOld = resolve; });
    if (calls === 2) throw Error('รายจ่ายเปลี่ยนแล้ว กรุณาลองโหลดอีกครั้ง');
    return { rows: [row()] };
  });
  const view = setup(row(), issue, { loading: true });
  try {
    assert.match(view.render(true), /หนังสือรับรอง 50 ทวิ/);
    view.props.revision = 'v2'; view.render(true); await view.settle();
    assert.match(view.render(), /ยังโหลดหนังสือรับรองไม่ได้/);
    view.find('button').onClick(); view.render(true); await view.settle();
    assert.match(view.render(), /ยังไม่ออก/);
    resolveOld({ rows: [row({ status: 'SYSTEM_ISSUED', certificateNumber: 'STALE' })] }); await view.settle();
    assert.doesNotMatch(view.render(), /STALE/);
  } finally { request.mock.restore(); view.cleanup(); }
});

test('an empty handoff read is an empty state, and reloading can find a newly available handoff', async () => {
  let calls = 0;
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows: ++calls === 1 ? [] : [row()] }));
  const view = setup(row(), issue, { loading: true });
  try {
    view.render(true); await view.settle();
    const html = view.render();
    assert.match(html, /ยังไม่มีข้อมูลสำหรับออกหนังสือรับรองของรายจ่ายนี้/);
    assert.doesNotMatch(html, /ยังโหลดหนังสือรับรองไม่ได้|role="alert"/);
    view.find('button', p => p.children.includes('โหลดข้อมูลอีกครั้ง')).onClick();
    view.render(true); await view.settle();
    assert.match(view.render(), /ยังไม่ออก/);
    assert.doesNotMatch(view.render(), /ยังไม่มีข้อมูลสำหรับออกหนังสือรับรอง/);
  } finally { request.mock.restore(); view.cleanup(); }
});

test('a failed handoff read says what failed once and offers one retry button', async () => {
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => { throw Error('network failure'); });
  const view = setup(row(), issue, { loading: true });
  try {
    view.render(true); await view.settle();
    const html = visible(view.render());
    assert.match(html, /ยังโหลดหนังสือรับรองไม่ได้/);
    assert.equal(html.split('ลองอีกครั้ง').length - 1, 1);
    assert.doesNotMatch(html, /ยังไม่มีข้อมูลสำหรับออกหนังสือรับรอง/);
    view.find('button', p => p.children.includes('ลองอีกครั้ง'));
  } finally { request.mock.restore(); view.cleanup(); }
});

test('issue refusal remains visible once during a read and clears only on explicit retry', async () => {
  const message = 'เลขที่หนังสือรับรองนี้ถูกใช้แล้ว กรุณาลองออกใหม่อีกครั้ง';
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows: [row()] }));
  const view = setup(row(), issue, { loading: true });
  let clears = 0;
  Object.assign(view.props, { error: message, onClearError() { clears++; view.props.error = null; } });
  try {
    assert.equal(view.render().split(message).length - 1, 1);
    view.render(true); await view.settle();
    assert.equal(view.render().split(message).length - 1, 1);
    assert.equal(clears, 0);
    view.find('button', p => p.children.includes('ลองอีกครั้ง')).onClick();
    assert.equal(clears, 1); assert.doesNotMatch(view.render(), /เลขที่หนังสือรับรองนี้ถูกใช้แล้ว/);
  } finally { request.mock.restore(); view.cleanup(); }
});

test('self-issued dialog validates, sends the trimmed body and preserves every typed field on refusal', async () => {
  let reject = true;
  const request = mock.method(api, 'linkExternalWhtCertificate', async (...args: any[]) => {
    assert.equal(args[0], 'co'); assert.equal(args[1], 'handoff');
    assert.deepEqual({ ...args[2], commandId: 'command' }, { commandId: 'command', externalAttachmentId: null, externalCertificateNumber: 'EXT-9', issuedDate: '2026-01-01', paymentDate: '2025-12-31', externalEvidenceRef: '', note: 'ส่งให้แล้ว' });
    if (reject) throw Error('รายจ่ายเปลี่ยนแล้ว กรุณาเปิดรายจ่ายเพื่อตรวจสอบ');
    return row({ status: 'EXTERNAL_LINKED', externalCertificateNumber: 'EXT-9', externalIssuedDate: '2026-01-01', linkNote: 'ส่งให้แล้ว' });
  });
  const view = setup(row({ systemIssuanceOpen: false }), link);
  try {
    view.render(); openRecord(view);
    assert.equal(view.find('Modal', p => p.open).closeOnBackdrop, false);
    assert.match(view.render(), /<\/form><button[^>]*>ยกเลิก<\/button><button[^>]*form="certificate-expense"[^>]*>บันทึก<\/button><\/section>/);
    assert.equal(view.find('Modal', p => p.open).dirty, false);
    assert.doesNotMatch(view.render(), /ใช้เมื่อร้านออกหนังสือรับรองให้ผู้รับเงินเองนอกระบบ/);
    assert.match(await submit(view), /กรอกเลขที่ใบก่อนบันทึก/); assert.equal(request.mock.callCount(), 0);
    type(view, 'number', ' EXT-9 '); type(view, 'date', '2099-01-01');
    assert.equal(view.find('Modal', p => p.open).dirty, true, 'typed text is asked about before the window closes');
    assert.match(view.render(), /วันที่ทำใบต้องไม่เกินวันนี้/);
    assert.match(await submit(view), /วันที่ทำใบต้องไม่เกินวันนี้/); assert.equal(request.mock.callCount(), 0);
    type(view, 'date', '2026-01-01'); type(view, 'paymentDate', '2025-12-31'); type(view, 'note', ' ส่งให้แล้ว ');
    assert.match(await submit(view), /รายจ่ายเปลี่ยนแล้ว กรุณาเปิดรายจ่ายเพื่อตรวจสอบ/);
    assert.equal(view.find('input', p => p.id === 'certificate-number-expense').value, ' EXT-9 ');
    assert.equal(view.find('textarea').value, ' ส่งให้แล้ว '); assert.deepEqual(view.successes, []);
    const firstCommand = request.mock.calls[0]!.arguments[2].commandId;
    reject = false; const html = await submit(view);
    assert.equal(request.mock.calls[1]!.arguments[2].commandId, firstCommand);
    assert.doesNotMatch(html, /data-dialog/); assert.match(html, /EXT-9/);
    assert.deepEqual(view.successes, ['จดเลขที่แล้ว ย้ายไป "ทำนอกระบบ"']); assert.equal(view.changes.length, 1);
  } finally { request.mock.restore(); }
});

test('payee address uses a multiline dialog, retains refusals, saves the endpoint body and disappears after issuance', async () => {
  let reject = true;
  const request = mock.method(api, 'setWhtHandoffPayeeAddress', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff', { payeeAddress: 'บ้านเลขที่ 1\nถนนทดสอบ' }]);
    if (reject) throw Error('ออกหนังสือรับรองแล้ว กรุณาใช้แก้ไขหนังสือรับรอง');
    return row({ payeeAddress: 'บ้านเลขที่ 1\nถนนทดสอบ', systemIssuanceOpen: false });
  });
  const view = setup(row({ payeeAddress: null }));
  try {
    assert.match(view.render(), /ยังไม่มีที่อยู่/);
    view.find('button', p => p.children.includes('เพิ่มที่อยู่')).onClick(); view.render();
    assert.match(await submit(view), /กรอกที่อยู่ผู้รับเงินก่อนบันทึก/);
    assert.equal(request.mock.callCount(), 0);
    type(view, 'address', ' บ้านเลขที่ 1\nถนนทดสอบ ');
    assert.match(await submit(view), /ออกหนังสือรับรองแล้ว กรุณาใช้แก้ไขหนังสือรับรอง/);
    assert.equal(view.find('textarea').value, ' บ้านเลขที่ 1\nถนนทดสอบ ');
    reject = false; assert.match(await submit(view), /บ้านเลขที่ 1/);
    assert.deepEqual(view.successes, ['บันทึกที่อยู่ผู้รับเงินแล้ว']);
    assert.equal(view.changes[0].systemIssuanceOpen, true);
    assert.match(view.render(), /ออกหนังสือรับรอง 50 ทวิ/);
    assert.doesNotMatch(setup(row({ status: 'SYSTEM_ISSUED' })).render(), /แก้ไขที่อยู่|ที่อยู่ผู้รับเงินบนหนังสือรับรอง/);
  } finally { request.mock.restore(); }
});

test('one history disclosure follows the status with cancellation and removed-external next steps inside the card', () => {
  const history = { eventType: 'CANCELLED_SOURCE_REOPENED', certificateNumber: 'WHT-1', isExternal: false, certificateDate: '2026-10-10', reason: null,
    relatedCertificateNumber: null, actorDisplayName: 'เจ้าของกิจการ', occurredAt: '2026-10-11T03:00:00Z', evidenceRef: null, note: null };
  const html = setup(row(), issue, { history: [history] }).render();
  assert.equal((html.match(/<summary/g) ?? []).length, 1);
  assert.ok(html.indexOf('ยังไม่ออก') < html.indexOf('ประวัติหนังสือรับรอง'));
  assert.match(visible(html), /ใบเดิมเลขที่ WHT-1 ยกเลิกแล้ว/);
  assert.match(html, /<span class="whitespace-nowrap">WHT-1<\/span>/);
  const externalMarkup = setup(row({ systemIssuanceOpen: false }), link, { history: [{ ...history, eventType: 'EXTERNAL_RECORD_REMOVED', certificateNumber: 'EXT-1', isExternal: true }] }).render();
  assert.match(externalMarkup, /<span class="whitespace-nowrap">EXT-1<\/span>/);
  const external = visible(externalMarkup);
  assert.ok(external.includes('การบันทึกเลขที่ EXT-1 ยกเลิกแล้ว'));
  assert.ok(external.includes('จดเลขที่ใบ 50 ทวิ'));
});

test('correction locked facts show Thai category and grouped money as text without inputs', () => {
  const values = { formType: 'PND53', incomeCategoryName: 'ค่าบริการ', incomeCategoryCode: 'WHT_SERVICE_5', grossAmount: '10000.0000', withheldAmount: '300.0000', whtRate: '3', payeeTaxId: '1111111111111' };
  const view = certificateHarness(() => h(ExpenseCertificateCorrectionFields, { values }));
  const html = view.render();
  for (const text of ['ค่าบริการ', '10,000.00', '300.00', '1111111111111', 'นิติบุคคล']) assert.ok(html.includes(text), text);
  assert.match(html, /line-clamp-2/); assert.match(html, /3% · จ่าย 10,000.00 บาท · หักไว้ 300.00 บาท · เลขผู้เสียภาษี/);
  assert.doesNotMatch(html, /WHT_SERVICE_5|<input|<select|<textarea/);
});

test('new files contain no upload wording or viewport lock; sticky footer contains only certificate-free actions', () => {
  for (const file of ['ExpenseCertificateCard.tsx', 'ExpenseCertificateCorrectionFields.tsx', 'expense-certificate-card.logic.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\u0e41\u0e19\u0e1a/);
  }
  const source = readFileSync(new URL('ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  const footer = source.slice(source.indexOf('  const modalFooter ='), source.indexOf('  const checkBillSecondaryActions ='));
  assert.doesNotMatch(footer, /HistoryNotice|พิมพ์เอกสาร|whtLoading|whtIssueError/);
  assert.match(source, /<textarea rows=\{4\} id=\{`wht-correct-payee-address-/);
  assert.match(source, /placeholder="เช่น สะกดชื่อผู้รับเงินผิด"/);
  assert.doesNotMatch(source, /height: '6rem'/);
});

test('self-issued change pre-fills the same dialog, keeps a no-change refusal and retries one command id', async () => {
  const view = setup(row({ status: 'EXTERNAL_LINKED', canChangeExternalRecord: true, externalEvidenceRef: 'ตู้เดิม', linkNote: 'ส่งแล้ว' }), link);
  view.render();
  view.find('button', p => p.children.includes('แก้ไขการบันทึก')).onClick(); view.render();
  assert.match(view.render(), /แก้ไขการบันทึกหนังสือรับรองที่ทำนอกระบบ/);
  assert.equal(view.find('input', p => p.id === 'certificate-number-expense').value, 'EXT-1');
  assert.equal(view.find('ThemedDate', p => p.id === 'certificate-date-expense').value, '2026-10-10');
  assert.equal(view.find('input', p => p.id === 'certificate-reference-expense').value, 'ตู้เดิม');
  assert.equal(view.find('textarea').value, 'ส่งแล้ว');
  const message = 'ข้อมูลตรงกับที่บันทึกไว้อยู่แล้ว จึงไม่มีอะไรต้องแก้ไข';
  let reject = true;
  const request = mock.method(api, 'changeExternalWhtCertificate', async (...args: any[]) => {
    if (reject) throw Error(message);
    return row({ status: 'EXTERNAL_LINKED', externalCertificateNumber: args[2].externalCertificateNumber });
  });
  try {
    assert.equal(visible(await submit(view)).split(message).length - 1, 1);
    assert.equal(view.find('input', p => p.id === 'certificate-number-expense').value, 'EXT-1');
    const first = request.mock.calls[0]!.arguments;
    assert.deepEqual({ ...first[2], commandId: 'stable' }, { commandId: 'stable', externalAttachmentId: null, externalCertificateNumber: 'EXT-1', issuedDate: '2026-10-10', paymentDate: '2026-10-09', externalEvidenceRef: 'ตู้เดิม', note: 'ส่งแล้ว' });
    await submit(view); assert.equal(request.mock.calls[1]!.arguments[2].commandId, first[2].commandId);
    type(view, 'number', ' EXT-2 '); assert.ok(!visible(view.render()).includes(message));
    reject = false; await submit(view);
    assert.deepEqual(view.successes, ['แก้ไขการบันทึกแล้ว เลขที่ EXT-2']);
    assert.ok(!view.render().includes('data-dialog'));
  } finally { request.mock.restore(); view.cleanup(); }
  assert.ok(!setup(row({ status: 'EXTERNAL_LINKED', canChangeExternalRecord: false }), link).render().includes('แก้ไขการบันทึก'));
});

test('pending previous certificate replaces the older notice and points to the required address step', () => {
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) for (const number of ['OLD-1', null]) {
    const previousCertificate = { kind, number, cancelledAt: '2026-10-10T03:00:00Z' };
    const history = [{ eventType: kind === 'SYSTEM' ? 'CANCELLED_SOURCE_REOPENED' : 'EXTERNAL_RECORD_REMOVED', certificateNumber: 'OLD-1', isExternal: kind === 'EXTERNAL', occurredAt: previousCertificate.cancelledAt }];
    const html = visible(setup(row({ previousCertificate }), issue, { history }).render());
    assert.equal(html.split('ถูกยกเลิกเมื่อ').length - 1, 1);
    assert.ok(html.includes(kind === 'SYSTEM' ? 'ใบเดิม' : 'การบันทึกเดิม'));
    assert.equal(html.includes('เดิมเลขที่ OLD-1'), number !== null);
    assert.ok(!html.includes('ถูกยกเลิกแล้ว'));
  }
  const view = setup(row({ payeeAddress: null })); const html = visible(view.render());
  assert.ok(html.includes('ยังไม่มีที่อยู่ผู้รับเงิน'));
  assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
  assert.ok(!setup(row({ payeeAddress: 'บ้านเลขที่ 1' })).render().includes('ยังไม่มีที่อยู่ผู้รับเงิน'));
  assert.ok(!setup(row({ prefill: { payeeSnapshot: { name: 'ผู้รับเงิน', address: 'ที่อยู่คู่ค้า' } } as any })).render().includes('ยังไม่มีที่อยู่ผู้รับเงิน'));
  const recorder = visible(setup(row({ systemIssuanceOpen: false }), link).render());
  assert.ok(recorder.includes('ยังไม่ได้บันทึกหนังสือรับรอง')); assert.ok(!recorder.includes('ถ้าร้านออกหนังสือรับรอง'));
});

test('a certificate refresh retains the last state and actions until the new row arrives', async () => {
  let resolve!: (value: any) => void;
  const request = mock.method(api, 'listWhtHandoffsPaged', () => new Promise(done => { resolve = done; }));
  const view = setup(row({ status: 'SYSTEM_ISSUED' }));
  try {
    view.render(true);
    const html = visible(view.render());
    assert.ok(html.includes('ออกแล้ว เลขที่ WHT-2'));
    assert.ok(html.includes('กำลังอัปเดต…')); assert.ok(html.includes('ดาวน์โหลด'));
    resolve({ rows: [row({ status: 'SYSTEM_ISSUED', certificateNumber: 'WHT-3' })] }); await view.settle();
    assert.ok(visible(view.render()).includes('ออกแล้ว เลขที่ WHT-3'));
    assert.ok(!view.render().includes('กำลังอัปเดต…'));
  } finally { request.mock.restore(); view.cleanup(); }
});

test('while the card re-reads after the page issued, the old not-issued status is not shown and its actions cannot be pressed', () => {
  const request = mock.method(api, 'listWhtHandoffsPaged', () => new Promise(() => {}));
  const view = setup(row());
  try {
    assert.ok(visible(view.render()).includes('ยังไม่ออก'));
    view.props.handoff = row({ status: 'SYSTEM_ISSUED', certificateId: 'new' });
    view.render(true);
    const html = visible(view.render());
    assert.ok(html.includes('กำลังอัปเดต…')); assert.ok(!html.includes('ยังไม่ออก'));
    assert.ok(!view.nodes.some(node => node.tag === 'button' && (node.props.children.includes('เพิ่มที่อยู่') || node.props.children.includes('แก้ไขที่อยู่'))));
    assert.ok(html.includes('ออกแล้ว เลขที่ WHT-2'));
  } finally { request.mock.restore(); view.cleanup(); }
});

test.after(() => modal.mock.restore());


test('the issue or correction answer shows the new number and date while the card waits for its read', async () => {
  let resolve!: (value: any) => void;
  const request = mock.method(api, 'listWhtHandoffsPaged', () => new Promise(done => { resolve = done; }));
  try {
    for (const status of ['REQUIRED', 'SYSTEM_ISSUED'] as const) {
      const view = setup(row({ status, certificateId: status === 'REQUIRED' ? null : 'old', currentCertificate: status === 'REQUIRED' ? null : { number: 'OLD-1', issuedAt: '2026-10-09' } as any }));
      view.render();
      view.props.handoff = row({ status: 'SYSTEM_ISSUED', certificateId: 'new', certificateNumber: 'WHT-NEW', certificateIssuedAt: '2026-10-11', currentCertificate: null });
      let html = visible(view.render());
      assert.ok(html.includes('ออกแล้ว เลขที่ WHT-NEW วันที่')); assert.ok(!html.includes('OLD-1')); assert.ok(!html.includes('ยังไม่ออก'));
      view.render(true); html = visible(view.render());
      assert.ok(html.includes('ออกแล้ว เลขที่ WHT-NEW')); assert.ok(html.includes('กำลังอัปเดต…'));
      Object.assign(view.props, { handoff: null }); view.render(true);
      assert.ok(visible(view.render()).includes('ออกแล้ว เลขที่ WHT-NEW'), 'the completed answer survives the page resetting its handoff during refresh');
      resolve({ rows: [row({ status: 'SYSTEM_ISSUED', certificateId: 'new', certificateNumber: 'WHT-NEW' })] }); await view.settle();
      assert.ok(!view.render().includes('กำลังอัปเดต…')); view.cleanup();
    }
  } finally { request.mock.restore(); }
});

test('a missing address has one warning and an add verb; a known address has the edit verb', () => {
  const missing = setup(row({ payeeAddress: null })); const html = missing.render();
  assert.equal(visible(html).split('ยังไม่มีที่อยู่').length - 1, 1);
  assert.ok(missing.find('button', p => p.children.includes('เพิ่มที่อยู่')));
  const known = setup(row({ payeeAddress: 'บ้านเลขที่ 1' }));
  assert.ok(known.render().includes('บ้านเลขที่ 1')); assert.ok(known.find('button', p => p.children.includes('แก้ไขที่อยู่')));
  assert.ok(!known.render().includes('เพิ่มที่อยู่'));
});


test('an issuer saves the address through the one primary step, then receives issue; external recording remains available', async () => {
  const request = mock.method(api, 'setWhtHandoffPayeeAddress', async () => row({ payeeAddress: 'ที่อยู่ใหม่' }));
  const list = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows: [row({ payeeAddress: 'ที่อยู่ใหม่' })] }));
  const view = setup(row({ payeeAddress: null }), issue);
  try {
    let html = view.render(); assert.equal(primaryCount(html), 1); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
    const add = view.find('button', props => props.children.includes('เพิ่มที่อยู่'));
    assert.match(add.className, /mangmee-btn-primary/); assert.ok(html.includes('[&amp;_.mangmee-btn]:w-full'));
    assert.ok(!html.includes('จดเลขที่ใบ 50 ทวิ'));
    add.onClick(); view.render(); type(view, 'address', 'ที่อยู่ใหม่'); await submit(view);
    view.render(true); await view.settle(); html = view.render();
    assert.ok(html.includes('ออกหนังสือรับรอง 50 ทวิ')); assert.equal(primaryCount(html), 1);
    assert.deepEqual(view.successes, ['บันทึกที่อยู่ผู้รับเงินแล้ว']);
  } finally { request.mock.restore(); list.mock.restore(); view.cleanup(); }
  assert.ok(setup(row({ payeeAddress: null, systemIssuanceOpen: false }), link).render().includes('จดเลขที่ใบ 50 ทวิ'));
  assert.ok(setup(row({ payeeAddress: null }), [...issue, ...link]).render().includes('จดเลขที่ใบ 50 ทวิ'));
});

test('a server address refusal remains once in place and starts a read for the address step', async () => {
  const message = 'ยังไม่มีที่อยู่ผู้รับเงิน เพิ่มที่อยู่ผู้รับเงินก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง';
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows: [row({ payeeAddress: null })] }));
  const view = setup(); view.props.error = message;
  try {
    view.render(true); await view.settle();
    assert.equal(view.state[1], 1, 'the refusal schedules a fresh read');
    const html = view.render(); assert.equal(visible(html).split(message).length - 1, 1); assert.ok(html.includes('เพิ่มที่อยู่'));
    assert.ok(!view.nodes.some(node => node.tag === 'button' && node.props.children.includes('ออกหนังสือรับรอง 50 ทวิ')));
  } finally { request.mock.restore(); view.cleanup(); }
});


test('payer details come before the payee address and only a manager gets the one primary profile link', () => {
  for (const allowed of [false, true]) {
    const view = setup(row({ payerMissing: ['TAX_ID', 'ADDRESS'], payeeAddress: null }), [...issue, ...link, ...(allowed ? ['company.legal_identity.manage'] : [])]);
    const html = view.render(); assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ')); assert.ok(html.includes('จดเลขที่ใบ 50 ทวิ'));
    assert.equal(html.includes('ไปกรอกข้อมูลร้าน'), allowed); assert.equal(html.includes('เจ้าของกิจการ'), !allowed);
    assert.match(view.find('button', p => p.children.includes('เพิ่มที่อยู่')).className, /mangmee-btn-secondary/);
    assert.equal((html.match(/mangmee-btn-primary/g) ?? []).length, allowed ? 1 : 0);
  }
});


test('the payee address dialog title follows whether an address already exists', () => {
  for (const address of [null, 'บ้านเลขที่ 1']) {
    const view = setup(row({ payeeAddress: address })); view.render();
    view.find('button', p => p.children.includes(address ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่')).onClick(); view.render();
    assert.equal(view.find('Modal', p => p.open).title, address ? 'แก้ไขที่อยู่ผู้รับเงิน' : 'เพิ่มที่อยู่ผู้รับเงิน');
  }
});
test('the card carries its return anchor, groups the number label and explains the replacement copy', () => {
  const manager = setup(row({ payerMissing: ['TAX_ID'] }), [...issue, 'company.legal_identity.manage']);
  const html = manager.render();
  assert.ok(html.includes(new URLSearchParams({ returnTo: '/companies/co/expenses/expense#wht-certificate' }).toString()));
  const issued = setup(row({ status: 'SYSTEM_ISSUED', certificateNumber: 'WHT-1', currentCertificate: null }));
  assert.match(issued.render(), /<span class="inline-block max-w-full">เลขที่ <span class="whitespace-nowrap">WHT-1<\/span><\/span>/);
  const page = readFileSync(new URL('./ExpenseReviewPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /expenses.certificates.replacement/); assert.doesNotMatch(page, /replacement_help/);
  const { t } = require('@/common/i18n/workspace-i18n.logic');
  assert.equal(t('expenses.certificates.replacement', 'th'), 'พิมพ์ใบแทน (เลขที่เดิม)');
});
test('an issued card gives the safe signature next step and the shorter states do not repeat their buttons', () => {
  const issued = setup(row({ status: 'SYSTEM_ISSUED' })).render();
  assert.ok(visible(issued).includes('พิมพ์ ตรวจลายเซ็น แล้วส่งให้ผู้รับเงิน'));
  assert.ok(issued.indexOf('เลขที่') < issued.indexOf('พิมพ์ ตรวจลายเซ็น'));
  const external = setup(row({ status: 'EXTERNAL_LINKED' }), link).render();
  assert.ok(!external.includes('ตรวจลายเซ็น')); assert.ok(external.includes('ทำนอกระบบ'));
  const recorder = setup(row({ systemIssuanceOpen: false }), link).render();
  assert.ok(recorder.includes('ยังไม่ได้บันทึกหนังสือรับรอง')); assert.ok(!recorder.includes('ถ้าร้านออกหนังสือรับรอง'));
});


test('C15 removal is quiet and permission-scoped, validates a reason, retains refusal and safely retries to waiting', async () => {
  const value = row({ status: 'EXTERNAL_LINKED', canChangeExternalRecord: true, updatedAt: '2026-10-12T00:00:00.000Z' });
  const waiting = row({ status: 'REQUIRED', externalCertificateNumber: null, externalIssuedDate: null, canChangeExternalRecord: false });
  let refuse = true;
  const request = mock.method(api, 'removeExternalWhtCertificate', async (...args: any[]) => {
    assert.deepEqual(args.slice(0, 2), ['co', 'handoff']);
    assert.deepEqual({ ...args[2], commandId: 'command' }, { commandId: 'command', expectedUpdatedAt: value.updatedAt, reason: 'บันทึกผิด' });
    if (refuse) throw Error('ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
    return waiting;
  });
  const view = setup(value, [...issue, ...link]);
  try {
    view.render();
    assert.doesNotMatch(view.find('button', p => p.children.includes('ลบการบันทึกนี้')).className, /primary/);
    view.find('button', p => p.children.includes('ลบการบันทึกนี้')).onClick(); view.render();
    assert.match(visible(view.render()), /ลบการบันทึกเลขที่ EXT-1\?/); assert.match(visible(view.render()), /ไม่ลบ/);
    assert.equal(view.find('Modal', p => p.open).closeOnBackdrop, false);
    assert.equal(view.find('button', p => p.children.includes('ลบการบันทึก')).disabled, false);
    assert.match(await submit(view), /ใส่เหตุผลที่ลบการบันทึก อย่างน้อย 3 ตัวอักษร/); assert.equal(request.mock.callCount(), 0);
    view.find('textarea', p => p.id === 'certificate-remove-reason-expense').onChange({ target: { value: ' บันทึกผิด ' } }); view.render();
    assert.match(await submit(view), /ข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่/);
    assert.equal(view.find('textarea').value.trim(), 'บันทึกผิด');
    const commandId = request.mock.calls[0]!.arguments[2].commandId;
    refuse = false;
    const form = view.find('form', p => p.id === 'certificate-expense');
    form.onSubmit({ preventDefault() {} }); form.onSubmit({ preventDefault() {} }); await view.settle();
    assert.equal(request.mock.callCount(), 2); assert.equal(request.mock.calls[1]!.arguments[2].commandId, commandId);
    assert.doesNotMatch(view.render(), /data-dialog/); assert.match(visible(view.render()), /ยังไม่ออก/);
    assert.deepEqual(view.successes, ['ลบการบันทึกแล้ว']); assert.equal(view.changes.at(-1).status, 'REQUIRED');
    for (const state of ['REQUIRED', 'SYSTEM_ISSUED', 'CANCELLED'] as const) assert.doesNotMatch(setup(row({ status: state, canChangeExternalRecord: false }), link).render(), /ลบการบันทึกนี้/);
    assert.doesNotMatch(setup(row({ status: 'EXTERNAL_LINKED', canChangeExternalRecord: false }), read).render(), /ลบการบันทึกนี้/);
  } finally { request.mock.restore(); view.cleanup(); }
});


test('a cleared typed address explains the tax-number change only beside the missing-address action', () => {
  for (const cleared of [true, false]) for (const address of [null, 'ที่อยู่ใหม่']) {
    const view = setup(row({ payeeAddress: address, payeeAddressClearedByTaxIdChange: cleared }));
    const html = view.render();
    assert.equal(html.includes('ที่อยู่ที่เคยเพิ่มไว้ใช้กับเลขผู้เสียภาษีเดิม'), cleared && address === null);
    assert.equal(html.includes('เพิ่มที่อยู่'), address === null);
    view.cleanup();
  }
});

test('PND2 and dividends explain why the system cannot issue and keep the shop-issued record action', () => {
  for (const code of ['WHT_INTEREST', 'WHT_DIVIDEND_IND', 'WHT_DIVIDEND', 'SYNTHETIC_SEPARATE']) {
    const view = setup(row({ systemIssuanceOpen: false, prefill: { ...row().prefill, incomeCategoryCode: code, formType: code === 'SYNTHETIC_SEPARATE' ? 'PND2' : 'PND53' } }), [...issue, ...link]);
    assert.match(visible(view.render()), /ให้ผู้ทำบัญชีทำนอกระบบแล้วจดเลขที่ไว้/);
    assert.match(visible(view.render()), /จดเลขที่ใบ 50 ทวิ/);
    assert.equal(view.render().includes('>ออกหนังสือรับรอง 50 ทวิ</button>'), false);
    view.cleanup();
  }
});

test('UX4 the external-only card explains delivery and filing without claiming the system files the return', () => {
  const sentence = 'ร้านต้องทำหนังสือรับรองนอกระบบให้ผู้รับเงินและยื่นแบบภาษีหัก ณ ที่จ่ายเอง ระบบเก็บยอดที่หักไว้';
  assert.ok(visible(setup(row({ systemIssuanceOpen: false }), link).render()).includes(sentence));
  assert.ok(!visible(setup(row(), [...issue, ...link]).render()).includes(sentence));
  assert.ok(!visible(setup(row({ status: 'SYSTEM_ISSUED' }), link).render()).includes(sentence));
});

test('W1 unpaid certificate stays a draft and W6 external dates start empty', () => {
  const view = setup(row({ payments: [] }), [...issue, ...link]);
  try {
    const html = visible(view.render());
    assert.match(html, /ร่าง.*บันทึกการจ่ายก่อนออกหนังสือรับรอง/);
    assert.equal(primaryCount(view.render()), 0);
  } finally { view.cleanup(); }
});

test('W6 an existing issued certificate without a payment binding stays downloadable, never becomes a draft', () => {
  const view = setup(row({ status: 'SYSTEM_ISSUED', payments: [{ id: 'p', paidAt: '2026-10-01', paidAtConfirmed: true, amount: '970' }] }));
  try { const html = visible(view.render()); assert.match(html, /ออกแล้ว/); assert.match(html, /ดาวน์โหลดหนังสือรับรอง/); assert.doesNotMatch(html, /ร่าง ·/); } finally { view.cleanup(); }
});

test('W3 each payment choice shows its own date, cash amount and certificate confirmation totals', () => {
  const first = { id: 'p1', paidAt: '2026-09-05', paidAtConfirmed: true, amount: '485', grossAmount: '500', withheldAmount: '15' };
  const view = setup(row({ payments: [first, { ...first, id: 'p2', paidAt: '2026-10-05' }] }));
  (view.props as any).onIssuePayment = async () => {};
  try {
    view.render(); const select = view.find('SelectField', p => p.id === 'certificate-payment');
    assert.equal(select.value, 'p1');
    select.onChange({ target: { value: 'p2' } });
    const html = visible(view.render()); assert.match(html, /5 ต.ค. 2569 · 485.00 บาท/); assert.doesNotMatch(html, /รายการจ่ายที่/);
    const issue = view.find('WhtIssueButton'); assert.equal(issue.handoff.prefill.paymentDate, '2026-10-05'); assert.equal(issue.handoff.prefill.grossAmount, '500'); assert.equal(issue.handoff.prefill.withheldAmount, '15');
  } finally { view.cleanup(); }
});

test('W6 both original dates are blank on a new external certificate record', () => {
  const view = setup(row({ systemIssuanceOpen: false }), link);
  try { view.render(); openRecord(view); for (const field of ['date', 'paymentDate']) assert.equal(view.find('ThemedDate', p => p.id === `certificate-${field}-expense`).value, ''); }
  finally { view.cleanup(); }
});

test('certificate coverage counts every active withholding payment, not the selected certificate', () => {
  const { allPaymentCertificatesIssued } = require('./expense-certificate-card.logic');
  const payments = [{ id: 'p1', withheldAmount: '60' }, { id: 'p2', withheldAmount: '60' }];
  const issued = (id: string, status = 'SYSTEM_ISSUED') => row({ status, prefill: { expensePaymentId: id } } as any);
  assert.equal(allPaymentCertificatesIssued([], []), false);
  assert.equal(allPaymentCertificatesIssued(payments.slice(0, 1), []), false);
  assert.equal(allPaymentCertificatesIssued(payments.slice(0, 1), [issued('p1')]), true);
  assert.equal(allPaymentCertificatesIssued(payments, []), false);
  assert.equal(allPaymentCertificatesIssued(payments, [issued('p1')]), false);
  assert.equal(allPaymentCertificatesIssued(payments, [issued('p1'), issued('p2', 'EXTERNAL_LINKED')]), true);
  assert.equal(allPaymentCertificatesIssued(payments, [issued('p1'), issued('p2', 'CANCELLED')]), false);
  // The read excludes voided payments; its old certificate must not cover a remaining payment.
  assert.equal(allPaymentCertificatesIssued(payments.slice(1), [issued('p1')]), false);
  assert.equal(allPaymentCertificatesIssued(payments.slice(1), [issued('p2')]), true);
  assert.equal(allPaymentCertificatesIssued([...payments, { id: 'no-tax', withheldAmount: '0' }], [issued('p1'), issued('p2')]), true);
});

test('same-day same-amount payment choices use money, recording order and issued markers', () => {
  const payments = ['second-id', 'first-id'].map(id => ({ id, paidAt: '2026-10-14', paidAtConfirmed: true, amount: '1940', grossAmount: '2000', withheldAmount: '60' }));
  const base = row({ payments });
  const issued = row({ id: 'issued', status: 'SYSTEM_ISSUED', prefill: { ...base.prefill, expensePaymentId: 'second-id' } });
  const view = setup(base);
  (view.state[0] as any).rows = [base, issued];
  try {
    view.render();
    const html = view.nodes.filter(n => n.tag === 'option').map(n => n.props.children.join('')).join('\n');
    assert.match(html, /14 ต.ค. 2569 · 1,940.00 บาท · รายการจ่ายที่ 1 · ออกหนังสือรับรองแล้ว/);
    assert.match(html, /14 ต.ค. 2569 · 1,940.00 บาท · รายการจ่ายที่ 2/);
    view.find('SelectField', p => p.id === 'certificate-payment').onChange({ target: { value: 'first-id' } });
    assert.match(visible(view.render()), /ยังไม่ออก/);
  } finally { view.cleanup(); }
});


test('the card reports whole-payment coverage after each read, independent of the selected payment', async () => {
  const payments = ['p1', 'p2'].map(id => ({ id, paidAt: '2026-10-14', paidAtConfirmed: true, amount: '1940', withheldAmount: '60' }));
  const first = row({ status: 'SYSTEM_ISSUED', payments, prefill: { expensePaymentId: 'p1', payeeSnapshot: {} } } as any);
  const second = row({ ...first, id: 'second', prefill: { ...first.prefill, expensePaymentId: 'p2' } });
  let rows = [first];
  const request = mock.method(api, 'listWhtHandoffsPaged', async () => ({ rows }));
  const coverage = mock.fn();
  const outside = mock.method(outsideClick, 'useCloseOnOutsideClick', () => {});
  const view = setup(first);
  (view.props as any).onCoverageChanged = coverage;
  try {
    view.render(true); await view.settle(); view.render(true); await view.settle();
    assert.equal(coverage.mock.calls.at(-1)?.arguments[0], false);
    rows = [first, second]; view.render(true); await view.settle(); view.render(true); await view.settle();
    assert.equal(coverage.mock.calls.at(-1)?.arguments[0], true);
    view.render(); view.find('SelectField', p => p.id === 'certificate-payment').onChange({ target: { value: 'p2' } });
    view.render(true); await view.settle();
    assert.equal(coverage.mock.calls.at(-1)?.arguments[0], true);
  } finally { view.cleanup(); request.mock.restore(); outside.mock.restore(); }
});

test('missing registered payer name offers the profile link with the expense return anchor', () => {
  const view = setup(row({ payerMissing: ['REGISTERED_NAME'] }), [...issue, 'company.legal_identity.manage']);
  const html = view.render();
  assert.ok(visible(html).includes('ชื่อจดทะเบียนของร้าน'));
  assert.ok(html.includes('ไปกรอกข้อมูลร้าน'));
  assert.ok(html.includes(new URLSearchParams({ returnTo: '/companies/co/expenses/expense#wht-certificate' }).toString()));
  assert.ok(!html.includes('ออกหนังสือรับรอง 50 ทวิ'));
});

test('an issued certificate still downloads and offers the profile return link before correction or a copy with missing identity', () => {
  const view = setup(row({ status: 'SYSTEM_ISSUED', payerMissing: ['REGISTERED_NAME'] }), [...issue, 'company.legal_identity.manage']);
  const html = view.render();
  assert.ok(visible(html).includes('ชื่อจดทะเบียนของร้าน'));
  assert.ok(html.includes('กรอกข้อมูลร้าน'));
  assert.ok(html.includes('ดาวน์โหลด'));
});

// The retired list-only address dialog's guarantees now belong to the expense card.
test('address landing dialog validates, keeps typed text on refusal, and saves a trimmed address once', async () => {
  let reject = true;
  const request = mock.method(api, 'setWhtHandoffPayeeAddress', async (...args: any[]) => {
    assert.deepEqual(args, ['co', 'handoff', { payeeAddress: '99 ถนนทดสอบ' }]);
    if (reject) throw Error('รายจ่ายเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่');
    return row({ payeeAddress: '99 ถนนทดสอบ' });
  });
  const view = setup(row({ payeeAddress: null }));
  try {
    view.render(); view.find('button', p => p.children.includes('เพิ่มที่อยู่')).onClick(); view.render();
    assert.equal(view.find('Modal').closeOnBackdrop, false);
    assert.equal(view.find('textarea').maxLength, 500);
    assert.match(await submit(view), /กรอกที่อยู่ผู้รับเงินก่อนบันทึก/); assert.equal(request.mock.callCount(), 0);
    type(view, 'address', ' 99 ถนนทดสอบ ');
    assert.match(await submit(view), /รายจ่ายเปลี่ยนไปแล้ว เปิดหน้านี้ใหม่/);
    assert.equal(view.find('textarea').value, ' 99 ถนนทดสอบ '); assert.deepEqual(view.successes, []);
    reject = false;
    const save = view.find('form').onSubmit;
    save({ preventDefault() {} }); save({ preventDefault() {} }); await view.settle();
    assert.equal(request.mock.callCount(), 2); assert.equal(view.changes.length, 1);
    assert.deepEqual(view.successes, ['บันทึกที่อยู่ผู้รับเงินแล้ว']);
  } finally { view.cleanup(); request.mock.restore(); }
});
test('address landing dialog prefers the typed address over the snapshot and closes without saving', () => {
  const view = setup(row({ payeeAddress: ' 99 ถนนใหม่ ', prefill: { payeeSnapshot: { address: 'ถนนเดิม' } } as any }));
  try {
    view.render(); view.find('button', p => p.children.includes('แก้ไขที่อยู่')).onClick();
    assert.match(view.render(), /แก้ไขที่อยู่ผู้รับเงิน/);
    assert.equal(view.find('textarea').value, '99 ถนนใหม่');
    view.find('Modal').onClose(); assert.doesNotMatch(view.render(), /data-dialog/);
    assert.equal(view.changes.length, 0);
  } finally { view.cleanup(); }
});


test('UAT-T1 self-issued form names every field and prefills only one confirmed recorded payment date', () => {
  for (const payments of [[{ id: 'p1', amount: '485', paidAt: '2026-10-04T17:00:00.000Z', paidAtConfirmed: true }],
    [{ id: 'p1', amount: '485', paidAt: '2026-10-05', paidAtConfirmed: false }],
    [{ id: 'p1', amount: '485', paidAt: '2026-10-05', paidAtConfirmed: true }, { id: 'p2', amount: '485', paidAt: '2026-10-06', paidAtConfirmed: true }]]) {
    const view = setup(row({ systemIssuanceOpen: false, payments } as any), link);
    try {
      view.render();
      // Unconfirmed dates correctly block this route; the form must never invent that date.
      if (!payments[0]!.paidAtConfirmed) continue;
      openRecord(view);
      assert.equal(view.find('ThemedDate', p => p.id === 'certificate-paymentDate-expense').value, payments.length === 1 ? '2026-10-05' : '');
      for (const field of ['number', 'paymentDate', 'date', 'reference', 'note']) {
        const tag = field === 'note' ? 'textarea' : field === 'date' || field === 'paymentDate' ? 'ThemedDate' : 'input';
        assert.ok(view.find(tag, p => p.id === `certificate-${field}-expense`)['aria-label']);
      }
    } finally { view.cleanup(); }
  }
});


test('WHT-OUTSIDE-2 unpaid outside card uses the payment-first sentence', () => {
  const view = setup(row({ payments: [], systemIssuanceOpen: false }), link);
  Object.assign(view.props, { systemCertificatesAvailable: false });
  try {
    const html = visible(view.render());
    assert.match(html, /บันทึกการจ่ายก่อน แล้วค่อยจดเลขที่ใบ 50 ทวิ/);
    assert.doesNotMatch(html, /ก่อนออกหนังสือรับรอง/);
  } finally { view.cleanup(); }
});

test('WHT-OUTSIDE-2 optional upload is saved, shown, replaced and removed without changing required number and dates', async () => {
  const saved = row({ status: 'EXTERNAL_LINKED', canChangeExternalRecord: true, externalAttachmentId: 'old-file' });
  const view = setup(saved, link);
  const upload = mock.method(api, 'uploadExternalWhtFile', async () => 'new-file');
  const change = mock.method(api, 'changeExternalWhtCertificate', async (_company: string, _id: string, body: any) => ({ ...saved, externalAttachmentId: body.externalAttachmentId }));
  try {
    let html = view.render();
    assert.match(visible(html), /ทำนอกระบบ.*เลขที่ EXT-1/);
    assert.match(html, /ดูไฟล์/);
    assert.doesNotMatch(html, /ไม่มีไฟล์ให้ดาวน์โหลด/);
    view.find('button', p => p.children.includes('แก้ไขการบันทึก')).onClick(); view.render();
    assert.match(visible(view.render()), /ใบนี้ทำจากนอกระบบ ระบบเก็บเลขที่และไฟล์ไว้ให้ค้นเจอเท่านั้น/);
    view.find('ThemedFile', p => p.id === 'certificate-file-expense').onChange(new File(['pdf'], 'ใบ.pdf', { type: 'application/pdf' })); view.render();
    await submit(view);
    assert.equal(upload.mock.callCount(), 1);
    assert.equal(change.mock.calls[0].arguments[2].externalAttachmentId, 'new-file');
    assert.equal(change.mock.calls[0].arguments[2].externalCertificateNumber, 'EXT-1');
    view.find('button', p => p.children.includes('แก้ไขการบันทึก')).onClick(); view.render();
    view.find('ThemedFile', p => p.id === 'certificate-file-expense').onChange(null); view.render();
    html = await submit(view);
    assert.equal(change.mock.calls[1].arguments[2].externalAttachmentId, null);
    assert.doesNotMatch(html, />ดูไฟล์</);
  } finally { upload.mock.restore(); change.mock.restore(); view.cleanup(); }
});


test('WHT-OUTSIDE-2 an already recorded payment with an unknown date asks for its date rather than another payment', () => {
  const view = setup(row({ payments: [{ id: 'payment', amount: '970', paidAt: '2026-10-10', paidAtConfirmed: false }], systemIssuanceOpen: false }), link);
  Object.assign(view.props, { systemCertificatesAvailable: false });
  try { assert.match(visible(view.render()), /ระบุวันที่จ่ายจริงในรายการจ่ายก่อน แล้วค่อยจดเลขที่ใบ 50 ทวิ/); }
  finally { view.cleanup(); }
});
