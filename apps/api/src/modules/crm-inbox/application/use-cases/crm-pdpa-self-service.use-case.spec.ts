import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmCustomerSelfServiceUseCase } from './crm-pdpa.use-case';

function makeAudit() {
  const entries: any[] = [];
  return { entries, log: async (e: any) => { entries.push(e); } } as any;
}

// A LIFF-verified, actively-linked identity for customer cust-1 in company co-1.
function makeDeps(overrides: {
  verify?: any;
  channel?: any;
  identity?: any;
  selfService?: any;
} = {}) {
  const calls: any = {};
  const verifier = {
    verify: overrides.verify ?? (async (token: string) => { calls.token = token; return { subject: 'line-user-1' }; }),
  } as any;
  const inboxRepo = {
    findActiveChannelByLineChannelId: async (lineChannelId: string) => {
      calls.channelLookup = lineChannelId;
      return overrides.channel === undefined ? { id: 'ch-1', companyId: 'co-1' } : overrides.channel;
    },
    findIdentity: async (channelId: string, providerUserId: string) => {
      calls.identityLookup = { channelId, providerUserId };
      return overrides.identity === undefined
        ? { customerId: 'cust-1', status: 'ACTIVE', verifiedLinkAt: new Date() }
        : overrides.identity;
    },
  } as any;
  const selfService = {
    revokeConsent: async (companyId: string, customerId: string, now: Date, note: string) => {
      calls.revoke = { companyId, customerId, now, note };
      return overrides.selfService?.revoke ?? { updated: true };
    },
    exportCustomerData: async (companyId: string, customerId: string) => {
      calls.export = { companyId, customerId };
      return overrides.selfService?.export !== undefined
        ? overrides.selfService.export
        : {
            customer: { id: customerId },
            conversations: [{ id: 'conv-1' }],
            messages: [{ id: 'msg-1', conversationId: 'conv-1' }, { id: 'msg-2', conversationId: 'conv-1' }],
            bookings: [],
            pagination: {
              conversations: { total: 1, returned: 1, limit: 250, truncated: false, nextCursor: null },
              messages: { total: 2, returned: 2, limit: 250, truncated: false, nextCursor: null },
              bookings: { total: 0, returned: 0, limit: 250, truncated: false, nextCursor: null },
            },
            inventory: { included: [], excluded: [] },
          };
    },
    createOrGetErasureCase: async (companyId: string, customerId: string, reasonProvided: boolean) => {
      calls.erasureCreate = { companyId, customerId, reasonProvided };
      return overrides.selfService?.erasureCase ?? {
        id: 'case-1', companyId, customerId, status: 'RECEIVED',
        requestedAt: new Date('2026-07-28T00:00:00.000Z'), dueAt: new Date('2026-08-27T00:00:00.000Z'),
        attemptCount: 0, notificationStatus: 'PENDING',
      };
    },
    findErasureCase: async (companyId: string, customerId: string, caseId: string) => {
      calls.erasureFind = { companyId, customerId, caseId };
      return overrides.selfService?.erasureStatus === undefined
        ? {
            id: caseId, companyId, customerId, status: 'RECEIVED',
            requestedAt: new Date(), dueAt: new Date(), attemptCount: 0, notificationStatus: 'PENDING',
          }
        : overrides.selfService.erasureStatus;
    },
  } as any;
  const audit = makeAudit();
  const uc = new CrmCustomerSelfServiceUseCase(verifier, inboxRepo, selfService, audit);
  return { uc, calls, audit };
}

const input = { idToken: 'tok', lineChannelId: 'line-1', requestId: 'req-1' };

describe('CrmCustomerSelfServiceUseCase.withdrawConsent', () => {
  it('revokes consent for the verified customer and audits as CRM_CUSTOMER', async () => {
    const { uc, calls, audit } = makeDeps();
    const result = await uc.withdrawConsent(input);

    assert.deepEqual(result, { customerId: 'cust-1', consentStatus: 'REVOKED' });
    // companyId comes from the channel, customerId from the verified identity —
    // the client never supplies either, so cross-tenant/other-customer is impossible.
    assert.equal(calls.revoke.companyId, 'co-1');
    assert.equal(calls.revoke.customerId, 'cust-1');
    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0].actorType, 'CRM_CUSTOMER');
    assert.equal(audit.entries[0].actorRefId, 'cust-1');
    assert.equal(audit.entries[0].actorUserId, undefined); // never a staff user
    assert.equal(audit.entries[0].companyId, 'co-1');
    assert.equal(audit.entries[0].action, 'access.crm_customer.self_consent.withdraw');
    assert.equal(audit.entries[0].result, 'SUCCESS');
  });

  it('rejects a spoofed / unverified identity without touching data or audit', async () => {
    const { uc, calls, audit } = makeDeps({ identity: { customerId: 'cust-1', status: 'ACTIVE', verifiedLinkAt: null } });
    await assert.rejects(() => uc.withdrawConsent(input), /identity_not_verified/);
    assert.equal(calls.revoke, undefined);
    assert.equal(audit.entries.length, 0);
  });

  it('404s on an unknown channel', async () => {
    const { uc, audit } = makeDeps({ channel: null });
    await assert.rejects(() => uc.withdrawConsent(input), /channel_not_found/);
    assert.equal(audit.entries.length, 0);
  });

  it('404s and does not audit success when the customer row is not in the company', async () => {
    const { uc, audit } = makeDeps({ selfService: { revoke: { updated: false } } });
    await assert.rejects(() => uc.withdrawConsent(input), /not found/i);
    assert.equal(audit.entries.length, 0);
  });
});

describe('CrmCustomerSelfServiceUseCase.exportData', () => {
  it('returns the tenant+customer scoped export and audits with counts', async () => {
    const { uc, calls, audit } = makeDeps();
    const data = await uc.exportData(input);

    assert.equal(calls.export.companyId, 'co-1');
    assert.equal(calls.export.customerId, 'cust-1');
    assert.equal(data.conversations.length, 1);
    assert.equal(audit.entries[0].actorType, 'CRM_CUSTOMER');
    assert.equal(audit.entries[0].action, 'access.crm_customer.self_data.export');
    assert.equal(audit.entries[0].metadataJson.conversations, 1);
    assert.equal(audit.entries[0].metadataJson.messages, 2);
    assert.equal(audit.entries[0].metadataJson.bookings, 0);
    assert.equal(audit.entries[0].metadataJson.pagination.messages.total, 2);
  });

  it('404s when the customer is absent / erased (repo returns null)', async () => {
    const { uc, audit } = makeDeps({ selfService: { export: null } });
    await assert.rejects(() => uc.exportData(input), /not found/i);
    assert.equal(audit.entries.length, 0);
  });
});

describe('CrmCustomerSelfServiceUseCase.requestErasure', () => {
  it('creates + audits a durable case as CRITICAL CRM_CUSTOMER', async () => {
    const { uc, calls, audit } = makeDeps();
    const result = await uc.requestErasure({ ...input, reason: 'no longer a customer' });

    assert.equal(result.customerId, 'cust-1');
    assert.equal(result.caseId, 'case-1');
    assert.equal(result.status, 'RECEIVED');
    assert.equal(calls.erasureCreate.companyId, 'co-1');
    assert.equal(calls.erasureCreate.customerId, 'cust-1');
    assert.equal(calls.revoke, undefined); // no data mutation in this lane
    assert.equal(calls.export, undefined);
    assert.equal(audit.entries[0].actorType, 'CRM_CUSTOMER');
    assert.equal(audit.entries[0].actorRefId, 'cust-1');
    assert.equal(audit.entries[0].action, 'access.crm_customer.self_erasure.request');
    assert.equal(audit.entries[0].riskLevel, 'CRITICAL');
    assert.equal(audit.entries[0].metadataJson.reasonProvided, true);
  });

  it('is idempotent-safe: a repeated request reuses the durable case', async () => {
    const { uc, audit } = makeDeps();
    const first = await uc.requestErasure(input);
    const second = await uc.requestErasure(input);
    assert.equal(first.caseId, second.caseId);
    assert.equal(audit.entries.length, 2);
    assert.equal(audit.entries[1].metadataJson.reasonProvided, false);
  });

  it('rejects an unverified identity', async () => {
    const { uc, audit } = makeDeps({ identity: null });
    await assert.rejects(() => uc.requestErasure(input), /identity_not_verified/);
    assert.equal(audit.entries.length, 0);
  });

  it('returns only the verified customer case status', async () => {
    const { uc, calls } = makeDeps();
    const status = await uc.getErasureStatus({ ...input, caseId: 'case-1' });
    assert.equal(status.id, 'case-1');
    assert.deepEqual(calls.erasureFind, { companyId: 'co-1', customerId: 'cust-1', caseId: 'case-1' });
  });

  it('404s when a case is not owned by the verified customer', async () => {
    const { uc } = makeDeps({ selfService: { erasureStatus: null } });
    await assert.rejects(() => uc.getErasureStatus({ ...input, caseId: 'other-case' }), /not found/i);
  });
});
