import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  approveDataRightsCase,
  buildDataRightsCasesPath,
  closeDataRightsCase,
  completeDataRightsCase,
  createDataRightsCase,
  recordDataRightsEvidence,
  startDataRightsExecution,
  startDataRightsVerification,
} from './data-rights.api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('system data-rights API client', () => {
  it('builds an encoded stable list query', () => {
    assert.equal(
      buildDataRightsCasesPath({
        status: 'RETENTION_REVIEW',
        caseType: 'MEMBERSHIP_EXIT',
        companyId: 'company:หนึ่ง',
        pageSize: 100,
        dueFilter: 'RESOLVED',
      }),
      '/v1/system/data-rights/cases?status=RETENTION_REVIEW&caseType=MEMBERSHIP_EXIT&companyId=company%3A%E0%B8%AB%E0%B8%99%E0%B8%B6%E0%B9%88%E0%B8%87&pageSize=100&dueFilter=RESOLVED',
    );
  });

  it('posts evidence references only through the same-origin authenticated API', async () => {
    let request: { url?: string; method?: string; body?: string } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), method: init?.method, body: String(init?.body) };
      return Response.json({ caseId: 'case-1', replayed: false, case: {} });
    }) as typeof fetch;

    await recordDataRightsEvidence('case/unsafe', {
      commandId: 'cmd-1',
      evidenceType: 'BACKUP_MANIFEST',
      category: 'BACKUPS',
      reference: 'evidence://data-rights/case-1/backup-manifest',
      sha256: 'a'.repeat(64),
      note: 'Restricted evidence store reference; no raw document.',
    });

    assert.equal(request.url, '/api/v1/system/data-rights/cases/case%2Funsafe/evidence');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body ?? '{}'), {
      commandId: 'cmd-1',
      evidenceType: 'BACKUP_MANIFEST',
      category: 'BACKUPS',
      reference: 'evidence://data-rights/case-1/backup-manifest',
      sha256: 'a'.repeat(64),
      note: 'Restricted evidence store reference; no raw document.',
    });
  });

  it('posts an explicit blocked-case reference on remediation create', async () => {
    let body = '';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      return Response.json({ caseId: 'case-new', replayed: false, case: {} });
    }) as typeof fetch;

    await createDataRightsCase({
      commandId: 'cmd-remediation',
      requestKey: 'DR-REMEDIATION-1',
      caseType: 'USER_ACCOUNT_ERASURE',
      requestSource: 'SUPPORT',
      targetUserId: 'user-1',
      dueAt: '2026-09-09T00:00:00.000Z',
      priorCaseReference: 'case://blocked-case-1',
    });

    assert.equal(JSON.parse(body).priorCaseReference, 'case://blocked-case-1');
  });

  it('sends BLOCKED through the close command without inventing a destructive route', async () => {
    let request: { url?: string; body?: string } = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), body: String(init?.body) };
      return Response.json({ caseId: 'case-1', replayed: false, case: {} });
    }) as typeof fetch;

    await closeDataRightsCase('case-1', {
      commandId: 'cmd-blocked',
      outcome: 'BLOCKED',
      reason: 'Object Lock prevents version purge; remediation required.',
    });

    assert.equal(request.url, '/api/v1/system/data-rights/cases/case-1/close');
    assert.equal(JSON.parse(request.body ?? '{}').outcome, 'BLOCKED');
  });

  it('sends the single-admin reason only with a self-step, on all five steps', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ caseId: 'case-1', replayed: false, case: {} });
    }) as typeof fetch;
    const reason = 'ระบบมีผู้ดูแลระบบเพียงคนเดียว จึงทำขั้นตอนนี้ด้วยตนเอง';
    const evidence = { evidenceType: 'INDEPENDENT_VERIFICATION' as const, reference: 'evidence://verification/1', sha256: 'a'.repeat(64) };
    const completion = { outcome: 'COMPLETED' as const, outcomeSummary: 'บันทึกครบทุกขั้นตอน' };

    // Two different people: nothing about single-admin mode is sent.
    await approveDataRightsCase('case-1', 'cmd-1');
    await startDataRightsExecution('case-1', 'cmd-2');
    await startDataRightsVerification('case-1', 'cmd-3');
    await recordDataRightsEvidence('case-1', { commandId: 'cmd-4', ...evidence });
    await completeDataRightsCase('case-1', { commandId: 'cmd-5', ...completion });
    assert.equal(requests.some((request) => 'singleAdminReason' in request.body), false);
    assert.deepEqual(requests.slice(0, 3).map((request) => request.body), [{ commandId: 'cmd-1' }, { commandId: 'cmd-2' }, { commandId: 'cmd-3' }]);

    // The only System Admin: each step carries its reason.
    requests.length = 0;
    await approveDataRightsCase('case-1', 'cmd-6', reason);
    await startDataRightsExecution('case-1', 'cmd-7', reason);
    await startDataRightsVerification('case-1', 'cmd-8', reason);
    await recordDataRightsEvidence('case-1', { commandId: 'cmd-9', ...evidence, singleAdminReason: reason });
    await completeDataRightsCase('case-1', { commandId: 'cmd-10', ...completion, singleAdminReason: reason });
    assert.deepEqual(
      requests.map((request) => [request.url.split('/').at(-1), request.body.singleAdminReason]),
      [['approve', reason], ['start-execution', reason], ['start-verification', reason], ['evidence', reason], ['complete', reason]],
    );
  });

  it('answers each single-admin refusal in plain Thai, with no code or identifier in the sentence', () => {
    for (const [code, expected] of [
      ['data_rights_second_admin_required', /ต้องให้ผู้ดูแลระบบอีกคนเป็นผู้ทำ/],
      ['data_rights_single_admin_reason_required', /กรุณาเขียนเหตุผล/],
      ['data_rights_single_admin_reason_invalid', /อย่างน้อย 20 ตัวอักษร/],
      ['data_rights_single_admin_not_applicable', /ไม่ต้องยืนยันแบบทำคนเดียว/],
    ] as const) {
      const message = apiErrorMessage({ status: 403, code, message: 'The case creator cannot approve the data-rights case.' });
      assert.match(message, expected, code);
      assert.doesNotMatch(message, /[A-Za-z_]{3,}/, code);
    }
  });
});
