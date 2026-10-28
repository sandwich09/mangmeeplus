import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeToastBus } from '@/common/feedback/toast-bus';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  GENERIC_UPLOAD_ERROR_MESSAGE,
  UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE,
} from '@/common/files/upload-file.logic';
import {
  planAccountantEvidenceBundle, fetchAccountantEvidenceBundle,
  confirmDuplicate,
  getSharedEvidence,
  generateSubstituteReceipt,
  dismissDuplicate,
  downloadSubstituteReceiptPdf,
  fetchAttachmentPreviewBlob,
  fetchSubstituteReceiptPdfBlob,
  initPersonalSignatureUpload,
  loadLineSubstituteReceiptPrefill,
  normalizeApiBase,
  recordExpensePayment,
  resolveUploadUrl,
  uploadExpenseEvidenceFile,
  updateExpenseSourceDraft,
  uploadReceiptFile,
  reopenExpense, voidExpense, getExpenseCertificateHistory, correctSystemWhtCertificate,
  removeExternalWhtCertificate, changeExternalWhtCertificate, linkExternalWhtCertificate, setWhtHandoffPayeeAddress, listWhtHandoffs, listWhtHandoffsPaged, issueSystemWhtCertificate, issueSystemWhtReplacementCopy, downloadSystemWhtCertificate,
} from './expenses.api';

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalSetTimeout = globalThis.setTimeout;

it('paged certificates send page parameters while existing handoff callers retain arrays', async () => {
  const urls: URL[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), 'http://localhost'); urls.push(url);
    return new Response(JSON.stringify(url.searchParams.has('page') ? { rows: [], total: 0, page: 2, pageSize: 20, counts: {} } : []), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  assert.deepEqual(await listWhtHandoffs('co', { sourcePaymentId: 'expense' }), []);
  assert.deepEqual(await listWhtHandoffs('co'), []);
  assert.equal((await listWhtHandoffsPaged('co', { status: 'REQUIRED', page: 2, pageSize: 20, search: 'ชื่อ & เลข', branchId: 'b' })).page, 2);
  assert.equal(urls[0].searchParams.get('sourcePaymentId'), 'expense'); assert.equal(urls[1].search, '');
  await listWhtHandoffsPaged('co', { sourcePaymentId: 'expense', page: 1, pageSize: 100 });
  assert.equal(urls[3].searchParams.get('sourcePaymentId'), 'expense');
  assert.equal(urls[3].searchParams.has('status'), false);
  assert.equal(urls[2].pathname, '/api/v1/companies/co/wht/payment-handoffs');
  assert.deepEqual(Object.fromEntries(urls[2].searchParams), { status: 'REQUIRED', page: '2', pageSize: '20', search: 'ชื่อ & เลข', branchId: 'b' });
});

it('expense certificate dialogs send their exact existing endpoint bodies and display a refusal without an automatic toast', async () => {
  const previousWindow = globalThis.window;
  const requests: { url: string; body: unknown }[] = [], toasts: string[] = [];
  const stop = subscribeToastBus(event => toasts.push(event.message));
  (globalThis as any).window = { dispatchEvent: () => {} };
  const message = 'รายจ่ายเปลี่ยนแล้ว กรุณาเปิดรายจ่ายเพื่อตรวจสอบ';
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ code: 'expense_wht_source_changed', message }), { status: 409, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const body = { commandId: 'command', externalCertificateNumber: 'EXT-1', externalEvidenceRef: '', issuedDate: '2026-10-11', note: 'ส่งแล้ว' };
  try {
    await assert.rejects(linkExternalWhtCertificate('co', 'handoff', body), error => apiErrorMessage(error) === message);
    await assert.rejects(changeExternalWhtCertificate('co', 'handoff', body), error => apiErrorMessage(error) === message);
    await assert.rejects(removeExternalWhtCertificate('co', 'handoff', { commandId: 'remove', reason: 'บันทึกผิด', expectedUpdatedAt: '2026-10-12T00:00:00.000Z' }), error => apiErrorMessage(error) === message);
    await assert.rejects(setWhtHandoffPayeeAddress('co', 'handoff', { payeeAddress: 'บ้านเลขที่ 1' }), error => apiErrorMessage(error) === message);
    assert.deepEqual(requests, [
      { url: '/api/v1/companies/co/wht/payment-handoffs/handoff/external-certificate', body },
      { url: '/api/v1/companies/co/wht/payment-handoffs/handoff/external-certificate/change', body },
      { url: '/api/v1/companies/co/wht/payment-handoffs/handoff/external-certificate/remove', body: { commandId: 'remove', reason: 'บันทึกผิด', expectedUpdatedAt: '2026-10-12T00:00:00.000Z' } },
      { url: '/api/v1/companies/co/wht/payment-handoffs/handoff/payee-address', body: { payeeAddress: 'บ้านเลขที่ 1' } },
    ]);
    assert.deepEqual(toasts, []);
  } finally { stop(); if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow; }
});

it('certificate issue is silent by default, callers can override it, and other mutations keep their toast defaults', async () => {
  const previousWindow = globalThis.window;
  const toasts: string[] = [];
  const stop = subscribeToastBus(event => toasts.push(event.message));
  (globalThis as any).window = { dispatchEvent: () => {} };
  const message = 'รายจ่ายเปลี่ยนไปแล้ว กรุณาเปิดรายจ่ายและตรวจสอบอีกครั้ง';
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'expense_wht_source_changed', message }), { status: 409, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    for (const call of [issueSystemWhtCertificate, issueSystemWhtReplacementCopy, downloadSystemWhtCertificate]) {
      await assert.rejects(call('co', 'handoff', { suppressErrorToast: true }), error => apiErrorMessage(error) === message);
    }
    assert.deepEqual(toasts, []);
    await assert.rejects(issueSystemWhtCertificate('co', 'handoff'));
    assert.deepEqual(toasts, []);
    await assert.rejects(issueSystemWhtCertificate('co', 'handoff', { suppressErrorToast: false }));
    await assert.rejects(issueSystemWhtReplacementCopy('co', 'handoff'));
    assert.deepEqual(toasts, [message, message]);
  } finally {
    stop(); if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
  }
});

it('reopen and void send taxFilingAttested only for the certificate path', async () => {
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  for (const action of [reopenExpense, voidExpense]) {
    await action('co', 'expense', 'แก้ยอด');
    await action('co', 'expense', 'แก้ยอด', true);
  }
  assert.deepEqual(bodies, [
    { reason: 'แก้ยอด' }, { reason: 'แก้ยอด', taxFilingAttested: true },
    { reason: 'แก้ยอด' }, { reason: 'แก้ยอด', taxFilingAttested: true },
  ]);
});

it('reads certificate history through the expense-scoped tax GET route', async () => {
  let url = '';
  globalThis.fetch = (async (input) => {
    url = String(input);
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  assert.deepEqual(await getExpenseCertificateHistory('co', 'expense'), []);
  assert.equal(url, '/api/v1/companies/co/wht/expenses/expense/certificate-history');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  globalThis.setTimeout = originalSetTimeout;
  if (originalDocument === undefined) delete (globalThis as { document?: Document }).document;
  else globalThis.document = originalDocument;
});

function mockAttachmentPreviewResponse(fileResponse: Response): Array<{ input: string; init?: RequestInit }> {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), ...(init ? { init } : {}) });
    return requests.length === 1
      ? new Response(JSON.stringify({ downloadUrl: 'https://storage.example.test/signed', expiresAt: '2026-08-08T10:00:00Z' }), { headers: { 'content-type': 'application/json' } })
      : fileResponse;
  }) as typeof fetch;
  return requests;
}

describe('expenses.api URL helpers', () => {
  it('sends a source draft as the only update lane and keeps unknown values null', async () => {
    let request: { url?: string; method?: string; body?: unknown } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ id: 'expense-1', updatedAt: '2026-09-07T00:01:00.000Z' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await updateExpenseSourceDraft('company-1', 'expense-1', '2026-09-07T00:00:00.000Z', {
      businessPurpose: 'ซื้อใช้ที่ร้าน',
      items: [{ itemRef: 'item-2', quantity: null, unitPrice: '0' }],
    });

    assert.deepEqual(request, {
      url: '/api/v1/companies/company-1/expenses/expense-1',
      method: 'PATCH',
      body: {
        expectedUpdatedAt: '2026-09-07T00:00:00.000Z',
        sourceDraft: {
          businessPurpose: 'ซื้อใช้ที่ร้าน',
          items: [{ itemRef: 'item-2', quantity: null, unitPrice: '0' }],
        },
      },
    });
  });

  it('carries same-expense routing and renders one localized actionable toast from a coded prepare rejection', async () => {
    const input = { fundingSource: 'COMPANY' as const, paidInFullAcknowledged: true as const, reasonCode: 'RECEIPT_UNAVAILABLE' as const, missingReceiptReason: 'paid without final receipt',
      businessPurpose: 'business meal', payerUserId: 'payer-1', routeCheckBill: true as const,
      paymentMethod: 'CASH' as const, expectedExpenseUpdatedAt: '2026-08-27T00:00:00.000Z', idempotencyKey: 'same-expense' };
    for (const locale of ['th', 'en'] as const) {
      const toasts: string[] = [];
      const unsubscribe = subscribeToastBus((event) => toasts.push(event.message));
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        assert.equal(String(url), '/api/v1/companies/co-1/expenses/exp-1/substitute-receipt');
        assert.deepEqual(JSON.parse(String(init?.body)), input);
        return new Response(JSON.stringify({ code: 'check_bill_payment_evidence_required', message: 'Attach separate proof of actual payment before preparing the substitute receipt.' }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      try {
        await assert.rejects(() => generateSubstituteReceipt('co-1', 'exp-1', input, locale), (error: unknown) => {
          const message = apiErrorMessage(error, locale);
          assert.match(message, locale === 'th' ? /จ่ายจริง.*เงินสด.*รายการเดิม/ : /actual payment.*cash.*same expense/);
          assert.deepEqual(toasts, [message], 'toast and persistent inline error agree, with no generic duplicate');
          return true;
        });
      } finally { unsubscribe(); }
    }
  });
  it('carries the selected source branch to the shared evidence endpoint', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost');
      assert.equal(url.searchParams.get('branchId'), 'branch-siam');
      assert.equal(url.searchParams.get('dateField'), 'uploadedAt');
      return new Response(JSON.stringify({ rows: [], total: 0, folders: [] }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await getSharedEvidence('company-1', { branchId: 'branch-siam', dateField: 'uploadedAt' });
  });
  it('retries an expense payment with the exact intent and civil paid date, without browser UTC conversion', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), '/api/v1/companies/company-1/expenses/expense-1/payment');
      assert.equal(init?.method, 'POST');
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'expense-1', status: 'CONFIRMED' }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const body = { idempotencyKey: 'intent-payment-1', paidAmount: '40.00', paidAt: '2026-07-31', paymentMethod: 'CASH' as const };
    await recordExpensePayment('company-1', 'expense-1', body);
    await recordExpensePayment('company-1', 'expense-1', body);
    assert.deepEqual(bodies, [body, body]);
    assert.equal(body.paidAt, '2026-07-31');
  });

  it('normalizes API base URL that already includes v1', () => {
    assert.equal(normalizeApiBase('http://localhost:3001/v1'), 'http://localhost:3001');
    assert.equal(normalizeApiBase('http://localhost:3001/v1/'), 'http://localhost:3001');
  });

  it('resolves local upload URL against API origin', () => {
    assert.equal(
      resolveUploadUrl('/local-storage/upload/abc', 'http://localhost:3001'),
      'http://localhost:3001/local-storage/upload/abc',
    );
  });

  it('forwards the signed create-only upload headers to storage', async () => {
    let request: { method?: string; headers?: Headers; body?: BodyInit | null } = {};
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      request = { method: init?.method, headers: new Headers(init?.headers), body: init?.body };
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const file = new File([Uint8Array.from([1, 2, 3])], 'receipt.png', { type: 'image/png' });

    await uploadReceiptFile('https://storage.example.test/upload', 'PUT', file, {
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    });

    assert.equal(request.method, 'PUT');
    assert.equal(request.headers?.get('content-type'), 'image/png');
    assert.equal(request.headers?.get('if-none-match'), '*');
    assert.equal(request.body, file);
  });

  it('sends only the server-owned signature upload contract fields', async () => {
    let request: { url?: string; body?: BodyInit | null } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), body: init?.body };
      return new Response(JSON.stringify({ attachmentId: 'att-signature' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await initPersonalSignatureUpload(
      'co-1',
      'exp-1',
      'evidence-1',
      new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'signature.png', { type: 'image/png' }),
    );

    assert.equal(request.url, '/api/v1/companies/co-1/expenses/exp-1/substitute-receipt/evidence-1/signature-upload-intent');
    assert.deepEqual(JSON.parse(String(request.body)), {
      originalFileName: 'signature.png',
      mimeType: 'image/png',
      byteSize: 4,
    });
  });

  it('links a generic evidence upload intent to the expense before upload', async () => {
    const requests: Array<{ url: string; body?: BodyInit | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body });
      if (url.endsWith('/attachments/upload-intent')) return new Response(JSON.stringify({
        attachmentId: 'att-1', uploadUrl: 'https://storage.example.test/upload', uploadMethod: 'PUT', uploadHeaders: {},
      }), { headers: { 'content-type': 'application/json' } });
      if (url === 'https://storage.example.test/upload') return new Response(null, { status: 200 });
      return new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await uploadExpenseEvidenceFile('co-1', 'exp-1', 'branch-1', new File([new Uint8Array([1])], 'receipt.pdf', { type: 'application/pdf' }), 'expense.receipt.primary');

    assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
      originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 1,
      visibility: 'INTERNAL', branchId: 'branch-1', metadataJson: { expenseReceiptExpenseId: 'exp-1' },
    });
    assert.match(requests[2]?.url ?? '', /expenses\/exp-1\/receipt-uploads\/att-1\/complete$/);
  });

  it('loads LINE prefill by opaque path without putting accepted business values in the URL', async () => {
    let requested = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({
        workflowId: 'workflow-opaque', expenseId: 'exp-1', targetRevision: '2026-08-16T00:00:00.000Z',
        status: 'OPEN', acceptedValues: { businessPurpose: 'ไปพบลูกค้า' },
      }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await loadLineSubstituteReceiptPrefill('co-1', 'exp-1', 'workflow-opaque');

    assert.equal(requested, '/api/v1/companies/co-1/expenses/exp-1/substitute-receipt/continuations/workflow-opaque');
    assert.equal(requested.includes('ไปพบลูกค้า'), false);
    assert.equal(result.acceptedValues.businessPurpose, 'ไปพบลูกค้า');
  });

  it('masks file-server failures behind upload-safe messages', async () => {
    const file = new File([], 'receipt.png', { type: 'image/png' });
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;

    await assert.rejects(
      uploadReceiptFile('https://storage.example.test/upload', 'PUT', file),
      { message: GENERIC_UPLOAD_ERROR_MESSAGE },
    );

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ message: 'File signature does not match the declared MIME type.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;
    await assert.rejects(
      uploadReceiptFile('https://storage.example.test/upload', 'PUT', file),
      { message: UPLOAD_FILE_TYPE_MISMATCH_ERROR_MESSAGE },
    );
  });

  it('fetches an attachment preview through the inline signed URL without browser credentials', async () => {
    const requests = mockAttachmentPreviewResponse(new Response(Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]), {
      headers: { 'content-type': 'image/png; charset=binary' },
    }));

    const blob = await fetchAttachmentPreviewBlob('co-1', 'att-1', 'image/png');

    assert.equal(blob.size, 9);
    assert.equal(blob.type, 'image/png;charset=binary');
    assert.equal(requests[0]?.input, '/api/v1/companies/co-1/attachments/att-1/download-url?disposition=inline');
    assert.equal(requests[1]?.input, 'https://storage.example.test/signed');
    assert.equal(requests[1]?.init?.mode, 'cors');
    assert.equal(requests[1]?.init?.credentials, 'omit');
  });

  it('uses the allowlisted storage response MIME when attachment metadata has no MIME type', async () => {
    mockAttachmentPreviewResponse(new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      headers: { 'content-type': 'application/pdf' },
    }));

    const blob = await fetchAttachmentPreviewBlob('co-1', 'att-without-metadata');

    assert.equal(blob.size, 5);
    assert.equal(blob.type, 'application/pdf');
  });

  it('cleans old substitute receipt display metadata from a retained SVG preview, preserving its source and reference', async () => {
    const reference = '<text x="50" y="176">เลขอ้างอิงรายการ: SRC-202609-00040</text>';
    const header = '<text text-anchor="middle" x="425" y="76">เลขที่ SRC-202609-00040 · version 1</text>';
    const source = `<svg xmlns="http://www.w3.org/2000/svg">${header}${reference}</svg>`;
    mockAttachmentPreviewResponse(new Response(source, { headers: { 'content-type': 'image/svg+xml' } }));
    const blob = await fetchAttachmentPreviewBlob('co-1', 'retained-certificate', 'image/svg+xml');
    assert.equal(blob.type, 'image/svg+xml');
    assert.equal(await blob.text(), `<svg xmlns="http://www.w3.org/2000/svg">${reference}</svg>`);
    assert.ok(source.includes(header));
  });

  it('rejects empty, unsupported, mismatched, and failed attachment preview responses', async () => {
    mockAttachmentPreviewResponse(new Response(null, { status: 404 }));
    await assert.rejects(fetchAttachmentPreviewBlob('co-1', 'att-1', 'image/png'), /ไม่พบข้อมูลที่ต้องการ/);

    mockAttachmentPreviewResponse(new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } }));
    await assert.rejects(fetchAttachmentPreviewBlob('co-1', 'att-1', 'image/png'), /ไม่มีข้อมูล/);

    mockAttachmentPreviewResponse(new Response(Uint8Array.from([1]), { headers: { 'content-type': 'application/pdf' } }));
    await assert.rejects(fetchAttachmentPreviewBlob('co-1', 'att-1', 'image/png'), /ไม่ตรง/);

    const unsupportedRequests = mockAttachmentPreviewResponse(new Response(Uint8Array.from([1]), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(fetchAttachmentPreviewBlob('co-1', 'att-1', 'text/html'), /ไม่รองรับ/);
    assert.equal(unsupportedRequests.length, 0);

    mockAttachmentPreviewResponse(new Response(Uint8Array.from([1]), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(fetchAttachmentPreviewBlob('co-1', 'att-1'), /ไม่รองรับ/);
  });

  it('rejects preview responses whose bytes do not match their allowlisted MIME type', async () => {
    for (const mimeType of ['application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml']) {
      mockAttachmentPreviewResponse(new Response(new TextEncoder().encode('<!doctype html><html>not a document</html>'), {
        headers: { 'content-type': mimeType },
      }));

      await assert.rejects(fetchAttachmentPreviewBlob('co-1', `corrupt-${mimeType}`), /เนื้อหาไฟล์/);
    }
  });

  it('accepts matching JPEG and system-generated XML/SVG signatures', async () => {
    for (const [mimeType, bytes] of [
      ['image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])],
      ['image/svg+xml', new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ] as const) {
      mockAttachmentPreviewResponse(new Response(bytes, { headers: { 'content-type': mimeType } }));

      const blob = await fetchAttachmentPreviewBlob('co-1', `valid-${mimeType}`);

      assert.equal(blob.type, mimeType);
      assert.equal(blob.size, bytes.byteLength);
    }
  });

  it('fetches and validates the issued substitute receipt PDF through the authenticated API', async () => {
    let requested = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), { headers: { 'content-type': 'application/pdf' } });
    }) as typeof fetch;

    const blob = await fetchSubstituteReceiptPdfBlob('co-1', 'exp-1', 'evidence-1');

    assert.equal(requested, '/api/v1/companies/co-1/expenses/exp-1/substitute-receipt/evidence-1/artifact.pdf');
    assert.equal(blob.type, 'application/pdf');
    assert.equal(blob.size, 5);
  });

  it('keeps API metadata when a substitute receipt PDF request fails', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: ['property visibility should not exist'],
      code: 'request_validation_failed',
    }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-pdf-1' },
    })) as typeof fetch;

    await assert.rejects(
      fetchSubstituteReceiptPdfBlob('co-1', 'exp-1', 'evidence-1'),
      (error: Error & { status?: number; code?: string; details?: { requestId?: string; message?: string[] } }) => {
        assert.equal(error.status, 400);
        assert.equal(error.code, 'request_validation_failed');
        assert.deepEqual(error.details?.message, ['property visibility should not exist']);
        assert.equal(error.details?.requestId, 'req-pdf-1');
        return true;
      },
    );
  });

  it('appends the download anchor and delays object URL revocation for Safari', async () => {
    const calls: string[] = [];
    const link = {
      href: '', download: '', style: { display: '' },
      click: () => { calls.push('click'); },
      remove: () => { calls.push('remove'); },
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        createElement: () => link,
        body: { appendChild: () => { calls.push('append'); } },
      },
    });
    URL.createObjectURL = () => { calls.push('create'); return 'blob:download'; };
    URL.revokeObjectURL = (url) => { calls.push(`revoke:${url}`); };
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      calls.push(`delay:${delay}`);
      if (typeof callback === 'function') callback();
      return 1;
    }) as typeof setTimeout;
    globalThis.fetch = (async () => new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;

    await downloadSubstituteReceiptPdf('co-1', 'exp-1', 'evidence-1', 'SRC-1');

    assert.equal(link.href, 'blob:download');
    assert.equal(link.download, 'SRC-1.pdf');
    assert.equal(link.style.display, 'none');
    assert.deepEqual(calls, ['create', 'append', 'click', 'remove', 'delay:1000', 'revoke:blob:download']);
  });

  it('sends the reviewer reason to both duplicate-resolution actions', async () => {
    const requests: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await confirmDuplicate('co-1', 'exp-1', 'candidate-1', 'same receipt');
    await dismissDuplicate('co-1', 'exp-1', 'candidate-2', 'different purchase');

    assert.deepEqual(requests, [
      {
        url: '/api/v1/companies/co-1/expenses/exp-1/duplicates/candidate-1/confirm',
        method: 'POST',
        body: JSON.stringify({ reason: 'same receipt' }),
      },
      {
        url: '/api/v1/companies/co-1/expenses/exp-1/duplicates/candidate-2/dismiss',
        method: 'POST',
        body: JSON.stringify({ reason: 'different purchase' }),
      },
    ]);
  });
});

it('certificate dialog, correction and issue refusals do not emit an automatic error toast', async () => {
  const events: string[] = [];
  const unsubscribe = subscribeToastBus(event => events.push(event.message));
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  (globalThis as Record<string, unknown>)['window'] = {};
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'wht_certificate_payee_name_required' }), { status: 422, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    for (const action of [reopenExpense, voidExpense]) await assert.rejects(() => action('co', 'expense', 'แก้ข้อมูล', true));
    await assert.rejects(() => correctSystemWhtCertificate('co', 'handoff', { reason: 'แก้ชื่อ', corrected: { payeeSnapshot: { name: '' } } }));
    await assert.rejects(() => issueSystemWhtCertificate('co', 'handoff'));
    assert.deepEqual(events, []);
  } finally {
    unsubscribe();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as Record<string, unknown>)['window'];
  }
});


it('plans and fetches actual ZIP bytes under one evidence selection with the server filename', async () => {
  const requests: any[] = [];
  const body = { yearMonth: '2026-10', dateField: 'uploadedAt', branchId: 'b1', expenseIds: ['e1'] };
  globalThis.fetch = (async (input, init) => {
    requests.push({ path: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    if (String(input).endsWith('bundle-plan')) return new Response(JSON.stringify({ fileCount: 1, partCount: 1 }), { headers: { 'content-type': 'application/json' } });
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('หลักฐาน-2026-10.zip')}` } });
  }) as typeof fetch;
  assert.deepEqual(await planAccountantEvidenceBundle('co', body), { fileCount: 1, partCount: 1 });
  const archive = await fetchAccountantEvidenceBundle('co', body, 1);
  assert.equal(archive.fileName, 'หลักฐาน-2026-10.zip'); assert.equal(archive.blob.type, 'application/zip');
  assert.deepEqual([...new Uint8Array(await archive.blob.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(requests, [
    { path: '/api/v1/companies/co/expenses/accountant-package/bundle-plan', method: 'POST', body },
    { path: '/api/v1/companies/co/expenses/accountant-package/bundle/1', method: 'POST', body },
  ]);
});


it('an expired bundle part uses the shared not-found sentence, with no file returned', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'Not Found', statusCode: 404 }), { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  await assert.rejects(() => fetchAccountantEvidenceBundle('co', {}, 99), error => apiErrorMessage(error) === 'ไม่พบข้อมูลที่ต้องการ');
});
