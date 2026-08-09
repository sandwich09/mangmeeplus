import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  buildDataRightsCasesPath,
  closeDataRightsCase,
  createDataRightsCase,
  recordDataRightsEvidence,
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
});
