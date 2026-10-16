import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expense-certificate-test-harness';
const css = require.extensions['.css'], svg = require.extensions['.svg'];
require.extensions['.css'] = (m: any) => { m.exports = {}; };
require.extensions['.svg'] = (m: any) => { m.exports = () => null; };
const leave = mutable('@/common/components/unsaved-navigation/use-unsaved-navigation');
const modal = mutable('@/common/components/modal');
const api = mutable('./disbursement-vouchers/disbursement-vouchers.api');
const { DisbursementVoucherSupportingFiles } = require('./DisbursementVoucherSupportingFiles');
if (css) require.extensions['.css'] = css; else delete require.extensions['.css'];
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
const file = { id: 'a', name: 'บัญชีผู้รับ.pdf', mimeType: 'application/pdf', byteSize: 123, uploadedByUserId: 'u', uploadedByName: 'สมใจ', uploadedAt: '2026-10-15T03:00:00Z' };
function setup(props: any = {}) {
  const mocks = [mock.method(leave, 'useUnsavedNavigation', () => ({ dialog: null })),
    mock.method(modal, 'Modal', (p: any) => p.open ? h('section', {}, p.title, p.children, p.footer) : null)];
  const view = certificateHarness(() => h(DisbursementVoucherSupportingFiles, { companyId: 'shop', id: 'v', initialFiles: [file], ...props }));
  return { ...view, close: () => { view.cleanup(); mocks.reverse().forEach(m => m.mock.restore()); } };
}
test('draft supporting files offer photo/file selection, view and removal; submitted files only offer view', () => {
  const draft = setup({ editable: true }), read = setup();
  try {
    const html = draft.render();
    assert.match(html, /แนบไฟล์ประกอบการจ่าย \(ถ้ามี\)/); assert.match(html, /เช่น รูปหน้าสมุดบัญชีหรือ QR ของผู้รับ ใบแจ้งหนี้ หรือรูปเช็ค/);
    assert.match(html, /capture="environment"/); assert.match(html, /multiple=""/); assert.match(html, /ถ่ายรูป|เลือกไฟล์/);
    assert.match(html, /ดูไฟล์/); assert.match(html, /เอาออก/); assert.match(html, /สมใจ/);
    const readonly = read.render(); assert.match(readonly, /ไฟล์ประกอบ 1 ไฟล์/); assert.match(readonly, /ดูไฟล์/); assert.doesNotMatch(readonly, /เอาออก|เลือกไฟล์|type="file"/);
  } finally { read.close(); draft.close(); }
});
test('a new voucher offers the file buttons at once; choosing a file saves the draft first, attaches to it, then reports the draft', async () => {
  const calls: string[] = [];
  const upload = mock.method(api, 'uploadDisbursementSupportingFile', async (_c: string, id: string) => { calls.push(`upload:${id}`); return 'uploaded'; });
  const attach = mock.method(api, 'attachDisbursementSupportingFile', async (_c: string, id: string) => { calls.push(`attach:${id}`); return [file]; });
  const view = setup({ id: undefined, editable: true, initialFiles: [], saveDraft: async () => { calls.push('save'); return 'new-draft'; },
    onDraftSaved: (id: string) => calls.push(`saved:${id}`) });
  try {
    const html = view.render();
    assert.match(html, /type="file"/); assert.match(html, /ถ่ายรูป/); assert.match(html, /เลือกไฟล์/); assert.doesNotMatch(html, /บันทึกร่างเพื่อแนบไฟล์/);
    await view.find('input', p => p.multiple).onChange({ target: { files: [new File(['x'], 'บัญชี.png', { type: 'image/png' })], value: '' } });
    await view.settle();
    assert.deepEqual(calls, ['save', 'upload:new-draft', 'attach:new-draft', 'saved:new-draft']);
    assert.match(view.render(), /แนบเอกสารประกอบการจ่ายแล้ว/);
  } finally { attach.mock.restore(); upload.mock.restore(); view.close(); }
});
test('a refused draft save uploads nothing, and both pages mount the shared component', async () => {
  let uploads = 0;
  const upload = mock.method(api, 'uploadDisbursementSupportingFile', async () => { uploads++; return 'uploaded'; });
  const view = setup({ id: undefined, editable: true, initialFiles: [], saveDraft: async () => null });
  try {
    view.render();
    await view.find('input', p => p.multiple).onChange({ target: { files: [new File(['x'], 'บัญชี.png', { type: 'image/png' })], value: '' } });
    await view.settle();
    assert.equal(uploads, 0); assert.doesNotMatch(view.render(), /เอกสารประกอบการจ่าย<\/section>|กำลังแนบ/);
    for (const page of ['DisbursementVoucherDraftPage', 'DisbursementVoucherDocumentPage']) {
      assert.match(readFileSync(new URL(`./${page}.tsx`, import.meta.url), 'utf8'), /<DisbursementVoucherSupportingFiles/);
    }
    const source = readFileSync(new URL('./DisbursementVoucherDraftPage.tsx', import.meta.url), 'utf8');
    assert.ok(source.indexOf('<TextareaField') < source.indexOf('<DisbursementVoucherSupportingFiles'));
    assert.match(source, /keepStepOnReload.current = true; router.replace/);
  } finally { upload.mock.restore(); view.close(); }
});
test('failed attachment retains the selected bytes and upload id, retries without uploading twice, and can be removed explicitly', async () => {
  let uploads = 0, attaches = 0;
  const upload = mock.method(api, 'uploadDisbursementSupportingFile', async () => { uploads++; return 'uploaded'; });
  const attach = mock.method(api, 'attachDisbursementSupportingFile', async () => { attaches++; if (attaches === 1) throw new Error('offline'); return [file]; });
  const view = setup({ editable: true, initialFiles: [] });
  try {
    view.render(); const chosen = new File(['bytes'], 'เช็ค.png', { type: 'image/png' });
    view.find('input', p => p.multiple).onChange({ target: { files: [chosen], value: '' } });
    await view.settle(); let html = view.render(); assert.match(html, /เช็ค.png/); assert.match(html, /ไฟล์ที่เลือกยังอยู่/);
    assert.equal((view.state[1] as any)[0].file, chosen); assert.equal((view.state[1] as any)[0].attachmentId, 'uploaded');
    await view.find('button', p => p.children.includes('ลองอีกครั้ง')).onClick(); await view.settle(); html = view.render();
    assert.equal(uploads, 1); assert.equal(attaches, 2); assert.deepEqual(view.state[1], []); assert.match(html, /แนบเอกสารประกอบการจ่ายแล้ว/);
    const remove = mock.method(api, 'removeDisbursementSupportingFile', async () => []);
    try { await view.find('button', p => p.children.includes('เอาออก')).onClick(); await view.settle(); assert.match(view.render(), /เอาไฟล์ประกอบการจ่ายออกแล้ว/); }
    finally { remove.mock.restore(); }
  } finally { view.close(); upload.mock.restore(); attach.mock.restore(); }
});

test('discarding a pending upload unlinks a possibly committed attachment before removing it locally', async () => {
  const chosen = new File(['bytes'], 'บัญชี.png', { type: 'image/png' });
  const view = setup({ editable: true, initialFiles: [] }); let removed = '';
  const remove = mock.method(api, 'removeDisbursementSupportingFile', async (_: string, _id: string, attachmentId: string) => { removed = attachmentId; return []; });
  try {
    view.state[1] = [{ file: chosen, attachmentId: 'response-lost' }]; view.render();
    await view.find('button', p => p.children.includes('เอาออก')).onClick(); await view.settle();
    assert.equal(removed, 'response-lost'); assert.deepEqual(view.state[1], []);
  } finally { view.close(); remove.mock.restore(); }
});

test('loaded image previews keep a phone icon and show a thumbnail on wide screens', () => {
  const view = setup({ initialFiles: [{ ...file, mimeType: 'image/png' }] });
  try {
    view.state[8] = 'blob:thumbnail'; const html = view.render();
    assert.match(html, /<img[^>]*class="hidden h-16 w-16 object-cover sm:block"/);
    assert.match(html, /<svg[^>]*class="sm:hidden h-8 w-8 text-gray-500"/);
  } finally { view.close(); }
});
