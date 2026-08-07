import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTaxReconciliation, getTradeTaxEvidenceAttachmentDownloadUrl, listTaxCodeDefinitions } from './transaction-tax.api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('transaction tax API client', () => {
  it('sends canonical definition filters through the same-origin BFF', async () => {
    let requested = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    await listTaxCodeDefinitions('company-1', { transactionContext: 'DOMESTIC_SALE', direction: 'OUTPUT', status: 'ACTIVE' });
    assert.equal(requested, '/api/v1/companies/company-1/tax/code-definitions?transactionContext=DOMESTIC_SALE&direction=OUTPUT&status=ACTIVE');
  });

  it('posts reconciliation with period and branch scope', async () => {
    let request: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), method: init?.method, body: String(init?.body) };
      return new Response(JSON.stringify({ id: 'run-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    await createTaxReconciliation('company-1', { formType: 'PP30', periodKey: '2026-07', branchId: 'branch-1' });
    assert.equal(request.url, '/api/v1/companies/company-1/tax/reconciliations');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body ?? '{}'), { formType: 'PP30', periodKey: '2026-07', branchId: 'branch-1' });
  });

  it('opens an international tax-evidence attachment through the permission-checked download endpoint', async () => {
    let requested = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(JSON.stringify({ downloadUrl: '/signed/evidence', expiresAt: '2026-07-15T01:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const result = await getTradeTaxEvidenceAttachmentDownloadUrl('company-1', 'attachment-1');
    assert.equal(requested, '/api/v1/companies/company-1/attachments/attachment-1/download-url');
    assert.equal(result.downloadUrl, '/signed/evidence');
  });
});
