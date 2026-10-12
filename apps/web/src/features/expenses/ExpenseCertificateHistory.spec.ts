import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { WHT_CERTIFICATE_HISTORY_EVENT_LABELS, type WhtCertificateHistoryDto } from '@watchdog-bms/contracts';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiDate, formatThaiTime } from '@/common/i18n/thai-date';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const api = mutable('./expenses.api');
const { ExpenseCertificateHistory, ExpenseCertificateHistoryDisclosure, ExpenseCertificateHistoryNotice } = require('./ExpenseCertificateHistory');

const row = (over: Partial<WhtCertificateHistoryDto> = {}): WhtCertificateHistoryDto => ({
  eventType: 'ISSUED', certificateNumber: 'WHT-1', isExternal: false, certificateDate: '2026-10-11', reason: null,
  relatedCertificateNumber: null, actorDisplayName: 'เจ้าของกิจการ', occurredAt: '2026-10-11T03:00:00Z', taxFilingAttested: false, evidenceRef: null, note: null, ...over,
});
/** What the person reads: a certificate number sits in its own no-wrap span. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');
function setup(rows: WhtCertificateHistoryDto[] = [], opts: { canRead?: boolean; confirmed?: boolean; loading?: boolean; error?: string | null } = {}) {
  const props = { companyId: 'co', expenseId: 'expense', revision: 'v1', canRead: opts.canRead ?? true, confirmed: opts.confirmed ?? false };
  const view = certificateHarness(() => h(ExpenseCertificateHistory, props,
    h(ExpenseCertificateHistoryNotice, { placement: 'edit' }),
    h('main', null, 'รายจ่าย'),
    h(ExpenseCertificateHistoryDisclosure),
    h(ExpenseCertificateHistoryNotice, { placement: 'issue' })),
  [{ rows, loading: opts.loading ?? false, error: opts.error ?? null }, 0]);
  return { ...view, props };
}

test('history is a closed disclosure grouped by Bangkok day with Thai dates, time, actor, event and replacement reason', () => {
  const rows = [row({ eventType: 'CORRECTED', certificateNumber: 'WHT-2', relatedCertificateNumber: 'WHT-3', reason: 'แก้ชื่อ', occurredAt: '2026-10-11T18:00:00Z' }),
    row({ eventType: 'EXTERNAL_RECORD_REMOVED', isExternal: true, certificateNumber: null, actorDisplayName: null, occurredAt: '2026-10-11T16:00:00Z' }), row()];
  const html = setup(rows).render();
  assert.match(html, /ประวัติหนังสือรับรองหัก ณ ที่จ่าย \(3 รายการ\)/);
  assert.match(html, /<details>/); assert.doesNotMatch(html, /<details open/);
  assert.ok(html.includes(formatThaiDate(rows[0]!.occurredAt))); assert.ok(html.includes(formatThaiTime(rows[0]!.occurredAt)));
  assert.equal((html.match(/<h3/g) ?? []).length, 2);
  assert.ok(text(html).includes(`เจ้าของกิจการ · ${WHT_CERTIFICATE_HISTORY_EVENT_LABELS.CORRECTED} · เลขที่ WHT-2 · ใบใหม่เลขที่ WHT-3 · เหตุผล: แก้ชื่อ`));
  assert.match(html, /<span class="whitespace-nowrap">WHT-2<\/span>/); assert.match(html, /<span class="whitespace-nowrap">WHT-3<\/span>/);
  assert.ok(html.includes(WHT_CERTIFICATE_HISTORY_EVENT_LABELS.EXTERNAL_RECORD_REMOVED));
  assert.doesNotMatch(html, /EXTERNAL_RECORD_REMOVED|CORRECTED|undefined|null/);
});

test('history uses the current contract labels for document cancellation and reopening', () => {
  const html = setup([row({ eventType: 'CANCELLED_SOURCE_VOIDED' }), row({ eventType: 'CANCELLED_SOURCE_REOPENED' })]).render();
  assert.match(html, /ยกเลิก เพราะเอกสารถูกยกเลิก/);
  assert.match(html, /ยกเลิก เพราะเอกสารถูกแก้ไข/);
  assert.doesNotMatch(html, /ยกเลิกเพราะ|ยกเลิกรายจ่าย/);
});

test('history reads only with wht.certificate.read, includes every status, sorts newest first and ignores a superseded response', async () => {
  let calls = 0, resolveOld!: (rows: WhtCertificateHistoryDto[]) => void;
  const request = mock.method(api, 'getExpenseCertificateHistory', async (...args: unknown[]) => {
    calls++; assert.deepEqual(args, ['co', 'expense']);
    if (calls === 1) return new Promise<WhtCertificateHistoryDto[]>(resolve => { resolveOld = resolve; });
    return [row({ occurredAt: '2026-10-10T03:00:00Z', certificateNumber: 'OLD' }), row({ certificateNumber: 'NEW' })];
  });
  const hidden = setup([row()], { canRead: false });
  const view = setup([], { loading: true });
  try {
    assert.equal(hidden.render(true), '<main>รายจ่าย</main>'); assert.equal(calls, 0);
    assert.match(view.render(true), /role="status"/);
    view.props.revision = 'v2'; view.render(true); await view.settle();
    let html = view.render();
    assert.ok(text(html).indexOf('เลขที่ NEW') < text(html).indexOf('เลขที่ OLD'));
    resolveOld([row({ certificateNumber: 'STALE' })]); await view.settle();
    html = view.render(); assert.doesNotMatch(html, /STALE/);
    view.props.confirmed = true; assert.match(view.render(), /ประวัติหนังสือรับรอง/);
    assert.equal(calls, 2);
  } finally { request.mock.restore(); view.cleanup(); hidden.cleanup(); }
});

test('empty renders nothing; a safe error offers retry and successful retry replaces it', async () => {
  assert.equal(setup().render(), '<main>รายจ่าย</main>');
  let calls = 0;
  const request = mock.method(api, 'getExpenseCertificateHistory', async () => {
    if (++calls === 1) throw { code: 'insufficient_permissions', requestId: 'secret-request' };
    return [row()];
  });
  const view = setup([], { loading: true });
  try {
    view.render(true); await view.settle();
    const html = view.render(); assert.match(html, /ลองโหลดอีกครั้ง/); assert.doesNotMatch(html, /insufficient_permissions|secret-request/);
    view.find('button').onClick(); assert.equal(view.state[1], 1);
    view.render(true); await view.settle();
    assert.match(view.render(), /ประวัติหนังสือรับรองหัก ณ ที่จ่าย \(1 รายการ\)/); assert.equal(calls, 2);
  } finally { request.mock.restore(); view.cleanup(); }
});

test('only the newest explicit edit cancellation supplies truthful next-step notices; missing numbers are omitted', () => {
  for (const number of ['WHT-1', null]) {
    const cancelled = row({ eventType: 'CANCELLED_SOURCE_REOPENED', certificateNumber: number });
    const words = number ? `เลขที่ ${number} ` : '';
    const edit = setup([cancelled]).render();
    assert.ok(edit.replace(/<[^>]*>/g, '').includes(`ยกเลิกหนังสือรับรอง${words}แล้ว แก้เสร็จให้ยืนยันและออกใบใหม่ ถ้าเคยส่งใบเดิมให้ผู้รับเงิน แจ้งว่าใบนั้นยกเลิก`));
    assert.ok(edit.indexOf('ยกเลิกหนังสือรับรอง') < edit.indexOf('<main>'));
    const confirmed = setup([cancelled], { confirmed: true }).render();
    assert.ok(confirmed.replace(/<[^>]*>/g, '').includes(`ใบเดิม${words}ยกเลิกแล้ว`));
    assert.doesNotMatch(confirmed, /แก้ไขและยืนยันเอกสาร/);
    if (number) {
      assert.ok(edit.includes(`<span class="whitespace-nowrap">${number}</span>`));
      assert.ok(confirmed.includes(`<span class="whitespace-nowrap">${number}</span>`));
    }
  }
  for (const rows of [[row(), row({ eventType: 'CANCELLED_SOURCE_REOPENED' })], [row({ eventType: 'CANCELLED_SOURCE_VOIDED' })], [row({ eventType: 'EXTERNAL_RECORD_REMOVED', isExternal: true })]]) {
    assert.doesNotMatch(setup(rows).render(), /เพื่อออกใบใหม่|ใบใหม่จะได้เลขใหม่/);
  }
});

test('self-issued history retains wrapped evidence and note as plain text, never links', () => {
  const html = setup([row({ isExternal: true, eventType: 'EXTERNAL_RECORD_REMOVED', evidenceRef: 'https://example.test/ref', note: 'เก็บต้นฉบับไว้' })]).render();
  assert.match(html, /เลขอ้างอิง: https:\/\/example.test\/ref/);
  assert.match(html, /หมายเหตุ: เก็บต้นฉบับไว้/);
  assert.match(html, /whitespace-pre-wrap break-words/);
  assert.doesNotMatch(html, /<a |href=/);
  assert.doesNotMatch(setup([row()]).render(), /เลขอ้างอิง:|หมายเหตุ:/);
});


test('external record changes show the new number and only old values that existed; card history has no padded box', () => {
  const previousExternalRecord = { number: 'EXT-OLD', issuedDate: '2026-10-09', externalEvidenceRef: 'ตู้เดิม', note: 'ส่งแล้ว' };
  const html = setup([row({ eventType: 'EXTERNAL_RECORD_CHANGED', isExternal: true, certificateNumber: 'EXT-NEW', previousExternalRecord })]).render();
  assert.ok(text(html).includes('แก้ไขการบันทึกหนังสือรับรองที่ออกเอง · เลขที่ EXT-NEW'));
  assert.ok(text(html).includes(`เดิม: เลขที่ EXT-OLD · วันที่ ${formatThaiDate('2026-10-09')} · เลขอ้างอิง ตู้เดิม · หมายเหตุ ส่งแล้ว`));
  const sparse = setup([row({ eventType: 'EXTERNAL_RECORD_CHANGED', previousExternalRecord: { number: null, issuedDate: null, externalEvidenceRef: null, note: 'เฉพาะหมายเหตุ' } })]).render();
  assert.ok(text(sparse).includes('เดิม: หมายเหตุ เฉพาะหมายเหตุ'));
  assert.ok(!text(sparse).includes('เดิม: เลขที่'));
  const props = { companyId: 'co', expenseId: 'expense', revision: 'v1', canRead: true, confirmed: true };
  const view = certificateHarness(() => h(ExpenseCertificateHistory, props, h(ExpenseCertificateHistoryDisclosure, { plain: true, label: 'ดูประวัติหนังสือรับรอง' })), [{ rows: [row()], loading: false, error: null }, 0]);
  assert.ok(!view.render().includes('mangmee-card')); assert.match(view.render(), /<details>/);
});


test('changed self-issued history lists only changed old fields and does not repeat unchanged reference or note', () => {
  const previousExternalRecord = { number: 'EXT-OLD', issuedDate: '2026-10-09', externalEvidenceRef: 'เหมือนเดิม', note: 'ส่งแล้ว' };
  const html = setup([row({ eventType: 'EXTERNAL_RECORD_CHANGED', isExternal: true, certificateNumber: 'EXT-NEW', certificateDate: '2026-10-09T00:00:00Z', evidenceRef: 'เหมือนเดิม', note: 'ส่งแล้ว', previousExternalRecord })]).render();
  const words = text(html);
  assert.ok(words.includes('เดิม: เลขที่ EXT-OLD')); assert.ok(!words.includes('วันที่')); assert.ok(!words.includes('เหมือนเดิม')); assert.ok(!words.includes('ส่งแล้ว'));
  const changed = text(setup([row({ eventType: 'EXTERNAL_RECORD_CHANGED', certificateNumber: 'EXT-OLD', certificateDate: '2026-10-10', evidenceRef: 'ใหม่', note: 'ส่งใหม่', previousExternalRecord })]).render());
  assert.ok(changed.includes(`เดิม: วันที่ ${formatThaiDate('2026-10-09')} · เลขอ้างอิง เหมือนเดิม · หมายเหตุ ส่งแล้ว`));
  assert.ok(!changed.includes('เดิม: เลขที่')); assert.ok(changed.includes('เลขอ้างอิง: ใหม่')); assert.ok(changed.includes('หมายเหตุ: ส่งใหม่'));
});

test('long hand-written history numbers wrap in both the new number and the changed old values', () => {
  const old = 'EXT-' + '1'.repeat(40), current = 'EXT-' + '2'.repeat(40);
  const html = setup([row({ eventType: 'EXTERNAL_RECORD_CHANGED', certificateNumber: current, previousExternalRecord: { number: old, issuedDate: null, externalEvidenceRef: null, note: null } })]).render();
  for (const number of [old, current]) {
    assert.ok(html.includes(number)); assert.ok(!html.includes(`<span class="whitespace-nowrap">${number}</span>`));
  }
});
test('history keeps the number label and each current, replacement and old number in one unit', () => {
  const html = setup([row({ eventType: 'CORRECTED', certificateNumber: 'WHT-1', relatedCertificateNumber: 'WHT-2' }),
    row({ eventType: 'EXTERNAL_RECORD_CHANGED', certificateNumber: 'EXT-2', previousExternalRecord: { number: 'EXT-1', issuedDate: null, externalEvidenceRef: null, note: null } })]).render();
  for (const number of ['WHT-1', 'WHT-2', 'EXT-1', 'EXT-2']) {
    assert.match(html, new RegExp(`<span class="inline-block max-w-full">(?:ใบใหม่)?เลขที่ <span class="whitespace-nowrap">${number}</span></span>`));
  }
});

test('R4 cancellation banner uses loaded system-certificate history and omits unavailable actor facts', () => {
  const { ExpenseCancellationNotice } = require('./ExpenseCertificateHistory');
  for (const isExternal of [false, true]) {
    const view = certificateHarness(() => h(ExpenseCertificateHistory, { companyId: 'co', expenseId: 'expense', revision: 'v1', canRead: true, confirmed: false },
      h(ExpenseCancellationNotice, { voidedAt: '2026-10-12T03:00:00Z', reason: 'บันทึกซ้ำ' })),
    [{ rows: [row({ eventType: 'CANCELLED_SOURCE_VOIDED', isExternal })], loading: false, error: null }, 0]);
    const html = view.render();
    assert.match(html, /รายจ่ายนี้ถูกยกเลิกแล้ว · 12 ต.ค. 2569/);
    assert.match(html, /เหตุผล: บันทึกซ้ำ/);
    assert.equal(html.includes('หนังสือรับรองเลขที่ WHT-1 ถูกยกเลิกด้วย'), !isExternal);
    assert.doesNotMatch(html, /โดย|undefined|null/);
  }
});

test('C15 manual removal keeps number, actor and reason and differs from expense-driven removal', () => {
  const manual = text(setup([row({ eventType: 'EXTERNAL_RECORD_REMOVED', isExternal: true, removedManually: true, certificateNumber: 'EXT-1', reason: 'บันทึกผิด' })]).render());
  assert.match(manual, /เจ้าของกิจการ · ลบการบันทึกว่าออกเอง · เลขที่ EXT-1 · เหตุผล: บันทึกผิด/);
  assert.doesNotMatch(manual, /เพราะเอกสารถูกแก้ไขหรือยกเลิก/);
  const automatic = text(setup([row({ eventType: 'EXTERNAL_RECORD_REMOVED', isExternal: true })]).render());
  assert.match(automatic, /เพราะเอกสารถูกแก้ไขหรือยกเลิก/);
});

test('cancelled expenses name the cancelled certificate and tell the payee next step without suggesting re-confirmation', () => {
  const html = text(setup([row({ eventType: 'CANCELLED_SOURCE_VOIDED', certificateNumber: 'WHT-VOID' })]).render());
  assert.match(html, /ยกเลิกหนังสือรับรองเลขที่ WHT-VOID แล้ว ถ้าเคยส่งใบเดิมให้ผู้รับเงิน แจ้งว่าใบนั้นยกเลิก/);
  assert.doesNotMatch(html, /แก้เสร็จให้ยืนยัน/);
});


test('cleared payee address appears in history with its date and without a certificate number', () => {
  const event = row({ eventType: 'PAYEE_ADDRESS_CLEARED', certificateNumber: null, certificateDate: null });
  const view = setup([event]); const html = view.render();
  assert.ok(html.includes('ล้างที่อยู่ผู้รับเงิน เพราะเลขผู้เสียภาษีเปลี่ยน'));
  assert.ok(html.includes(formatThaiDate(event.occurredAt))); assert.ok(html.includes(formatThaiTime(event.occurredAt)));
  assert.ok(!html.includes('PAYEE_ADDRESS_CLEARED')); assert.ok(!html.includes('ใบเดิม'));
  view.cleanup();
});
