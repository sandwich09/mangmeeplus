import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { certificateHarness, h, mutable } from './expense-certificate-test-harness';
const api = mutable('./expenses.api');
const { ExpenseCertificateFile } = require('./ExpenseCertificateFile');

test('WHT-OUTSIDE-2 ดูไฟล์ opens the scoped image/PDF preview and keeps retry available after refusal', async () => {
  let refused = true;
  const request = mock.method(api, 'getExternalWhtFile', async (companyId: string, handoffId: string, attachmentId: string) => {
    assert.deepEqual([companyId, handoffId, attachmentId], ['co', 'handoff', 'file']);
    if (refused) throw Error('เปิดไฟล์ไม่ได้ ลองอีกครั้ง');
    return { downloadUrl: '/signed/file', name: 'ใบ.pdf', mimeType: 'application/pdf' };
  });
  const bytes = mock.method(api, 'fetchSignedPreviewBlob', async (url: string, mime: string) => {
    assert.deepEqual([url, mime], ['/signed/file', 'application/pdf']);
    return new Blob(['%PDF-1.4'], { type: mime });
  });
  const view = certificateHarness(() => h(ExpenseCertificateFile, { companyId: 'co', handoffId: 'handoff', attachmentId: 'file' }));
  try {
    view.render(); view.find('button').onClick(); await view.settle();
    assert.match(view.render(), /เปิดไฟล์ไม่ได้ ลองอีกครั้ง/);
    assert.equal(view.find('button').disabled, false);
    refused = false;
    view.find('button').onClick(); view.render();
    assert.equal(view.find('button')['aria-busy'], true);
    await view.settle(); view.render();
    const preview = view.find('DocumentPreviewModal');
    assert.equal(preview.source.name, 'ใบ.pdf');
    assert.equal(preview.source.mimeType, 'application/pdf');
    assert.match(preview.source.url, /^blob:/);
    preview.onClose(); assert.doesNotMatch(view.render(), /role="dialog"/);
  } finally { request.mock.restore(); bytes.mock.restore(); view.cleanup(); }
});
