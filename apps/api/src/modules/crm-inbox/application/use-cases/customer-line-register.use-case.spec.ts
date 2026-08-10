import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerLineRegisterUseCase } from './customer-line-register.use-case';
import { PDPA_CONSENT_NOTICE_TEXT } from '../../domain/crm-inbox.constants';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { CustomerLineRegisterController } from '../../presentation/http/customer-line-register.controller';

function channel(overrides: Partial<any> = {}) {
  return {
    id: 'ch-1',
    companyId: 'co-from-channel',
    provider: 'LINE_OA',
    lineChannelId: 'line-ch-1',
    status: 'ACTIVE',
    ...overrides,
  } as any;
}

function makeUseCase(overrides: Partial<{
  verifier: any;
  inboxRepo: any;
  crmRepo: any;
  audit: any;
}> = {}) {
  const state = {
    identities: [] as any[],
    customers: [] as any[],
    customerUpdates: [] as any[],
    identityUpdates: [] as any[],
    audits: [] as any[],
  };
  const verifier = overrides.verifier ?? { verify: async () => ({ subject: 'line-user-from-token' }) };
  const inboxRepo = overrides.inboxRepo ?? {
    findActiveChannelByLineChannelId: async () => channel(),
    findIdentity: async (channelId: string, providerUserId: string) =>
      state.identities.find((i) => i.channelId === channelId && i.providerUserId === providerUserId) ?? null,
    createIdentity: async (data: any) => {
      const identity = { id: `idn-${state.identities.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
      state.identities.push(identity);
      return identity;
    },
    updateIdentity: async (id: string, data: any) => {
      state.identityUpdates.push({ id, data });
      const identity = state.identities.find((i) => i.id === id);
      if (identity) Object.assign(identity, data);
      return identity;
    },
    registerExistingIdentityConsent: async (input: any) => {
      const identity = state.identities.find((candidate) => candidate.id === input.identityId);
      if (!identity) throw new Error('line_identity_not_found');
      state.customerUpdates.push({
        companyId: input.companyId,
        id: identity.customerId,
        data: {
          consentStatus: 'GRANTED', consentUpdatedAt: input.now, consentNote: input.consentNote,
          updatedByUserId: input.updatedByUserId,
        },
      });
      if (!identity.verifiedLinkAt || identity.verifiedLinkVia !== 'LIFF') {
        const data = { verifiedLinkAt: input.now, verifiedLinkVia: 'LIFF' };
        state.identityUpdates.push({ id: identity.id, data });
        Object.assign(identity, data);
      }
      return { customerId: identity.customerId };
    },
  };
  const crmRepo = overrides.crmRepo ?? {
    createCustomer: async (data: any) => {
      const customer = { id: `cust-${state.customers.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
      state.customers.push(customer);
      return customer;
    },
    createLineCustomerAndIdentity: async ({ customer: customerData, identity: identityData }: any) => {
      const customer = {
        id: `cust-${state.customers.length + 1}`,
        originSource: 'LINE',
        createdByType: 'SYSTEM',
        ...customerData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.customers.push(customer);
      try {
        const identity = await inboxRepo.createIdentity({
          companyId: customer.companyId,
          customerId: customer.id,
          ...identityData,
        });
        return { customer, identityId: identity.id };
      } catch (error) {
        state.customers.pop(); // mirrors transaction rollback
        throw error;
      }
    },
    updateCustomer: async (companyId: string, id: string, data: any) => {
      state.customerUpdates.push({ companyId, id, data });
      return { id, companyId, ...data };
    },
  };
  const audit = overrides.audit ?? { log: async (entry: any) => { state.audits.push(entry); } };
  return { state, useCase: new CustomerLineRegisterUseCase(verifier, inboxRepo, crmRepo, audit) };
}

describe('CustomerLineRegisterUseCase', () => {
  it('ignores spoofed tenant/user data and creates from the trusted token and channel', async () => {
    const { state, useCase } = makeUseCase();
    const result = await useCase.execute({
      idToken: 'tok',
      lineChannelId: 'line-ch-1',
      consentGranted: true,
      requestId: 'req-1',
      userId: 'client-spoof',
      companyId: 'client-spoof',
    } as any);

    assert.deepEqual(result, { customerId: 'cust-1', alreadyRegistered: false });
    assert.equal(state.customers[0].lineUserId, undefined); // identity table is canonical
    assert.equal(state.customers[0].companyId, 'co-from-channel');
    assert.equal(state.customers[0].displayName, 'ลูกค้า LINE');
    assert.equal(state.customers[0].consentStatus, 'GRANTED');
    assert.equal(state.customers[0].consentNote, PDPA_CONSENT_NOTICE_TEXT);
    assert.equal(state.identities[0].providerUserId, 'line-user-from-token');
    assert.equal(state.customers[0].originSource, 'LINE');
    assert.equal(state.identities[0].companyId, 'co-from-channel');
    assert.equal(state.identities[0].verifiedLinkVia, 'LIFF');
    assert.ok(state.identities[0].verifiedLinkAt instanceof Date);
    assert.equal(state.audits[0].action, AuditAction.ACCESS_CRM_CUSTOMER_SELF_REGISTER_SUCCESS);
    // CUST-01: the awaited register audit rides the customer id on actorRefId, never the User FK — won't 500 on real Postgres.
    assert.equal(state.audits[0].actorType, 'CRM_CUSTOMER');
    assert.equal(state.audits[0].actorRefId, 'cust-1');
    assert.equal(state.audits[0].actorUserId, undefined);
  });

  it('uses a trimmed, length-capped verified LINE name when creating a customer', async () => {
    const verifiedName = `  คุณฝ้าย${'ก'.repeat(200)}  `;
    const { state, useCase } = makeUseCase({
      verifier: { verify: async () => ({ subject: 'line-user-from-token', name: verifiedName }) },
    });

    await useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: true } as any);

    assert.equal(state.customers[0].displayName, verifiedName.trim().slice(0, 160));
  });

  it('falls back to the LINE customer placeholder when the verified name is absent', async () => {
    const { state, useCase } = makeUseCase();

    await useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: true } as any);

    assert.equal(state.customers[0].displayName, 'ลูกค้า LINE');
  });

  it('updates consent and verified link for an existing identity without duplicating', async () => {
    const { state, useCase } = makeUseCase({
      verifier: { verify: async () => ({ subject: 'line-user-from-token', name: 'ชื่อใหม่จาก LINE' }) },
    });
    state.identities.push({
      id: 'idn-1',
      companyId: 'co-from-channel',
      channelId: 'ch-1',
      customerId: 'cust-existing',
      providerUserId: 'line-user-from-token',
      verifiedLinkAt: null,
      verifiedLinkVia: null,
    });

    const result = await useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: true } as any);

    assert.deepEqual(result, { customerId: 'cust-existing', alreadyRegistered: true });
    assert.equal(state.customers.length, 0);
    assert.equal(state.customerUpdates[0].companyId, 'co-from-channel');
    assert.equal(state.customerUpdates[0].id, 'cust-existing');
    assert.equal(state.customerUpdates[0].data.consentStatus, 'GRANTED');
    assert.equal('displayName' in state.customerUpdates[0].data, false);
    assert.equal(state.identityUpdates[0].data.verifiedLinkVia, 'LIFF');
  });

  it('returns and audits the canonical customer resolved after a concurrent merge', async () => {
    const snapshot = {
      id: 'idn-1', companyId: 'co-from-channel', channelId: 'ch-1', customerId: 'cust-secondary',
      providerUserId: 'line-user-from-token', verifiedLinkAt: null, verifiedLinkVia: null,
    };
    const { state, useCase } = makeUseCase({
      inboxRepo: {
        findActiveChannelByLineChannelId: async () => channel(),
        findIdentity: async () => snapshot,
        registerExistingIdentityConsent: async () => ({ customerId: 'cust-primary' }),
      },
      crmRepo: { updateCustomer: async () => { throw new Error('must be atomic in inbox repository'); } },
    });

    const result = await useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: true } as any);

    assert.deepEqual(result, { customerId: 'cust-primary', alreadyRegistered: true });
    assert.equal(state.audits[0].targetId, 'cust-primary');
    assert.equal(state.audits[0].actorType, 'CRM_CUSTOMER');
    assert.equal(state.audits[0].actorRefId, 'cust-primary');
    assert.equal(state.audits[0].actorUserId, undefined);
  });

  it('requires explicit consent before verifying or creating anything', async () => {
    let verified = false;
    const { state, useCase } = makeUseCase({ verifier: { verify: async () => { verified = true; } } });

    await assert.rejects(
      () => useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: false } as any),
      BadRequestException,
    );

    assert.equal(verified, false);
    assert.equal(state.customers.length, 0);
    assert.equal(state.identities.length, 0);
    // CUST-01: failure before a customer exists audits as SYSTEM, never a User FK.
    assert.equal(state.audits[0].action, AuditAction.ACCESS_CRM_CUSTOMER_SELF_REGISTER_FAILURE);
    assert.equal(state.audits[0].actorType, 'SYSTEM');
    assert.equal(state.audits[0].actorRefId, 'crm-self-register');
    assert.equal(state.audits[0].actorUserId, undefined);
  });

  it('rejects an unknown or disabled channel after token verification', async () => {
    const { state, useCase } = makeUseCase({
      inboxRepo: {
        findActiveChannelByLineChannelId: async () => null,
        findIdentity: async () => { throw new Error('should not lookup identity'); },
      },
    });

    await assert.rejects(
      () => useCase.execute({ idToken: 'tok', lineChannelId: 'missing', consentGranted: true } as any),
      NotFoundException,
    );
    assert.equal(state.customers.length, 0);
  });

  it('surfaces verifier failure and creates nothing', async () => {
    const { state, useCase } = makeUseCase({
      verifier: { verify: async () => { throw new UnauthorizedException('bad_token'); } },
    });

    await assert.rejects(
      () => useCase.execute({ idToken: 'bad', lineChannelId: 'line-ch-1', consentGranted: true } as any),
      UnauthorizedException,
    );
    assert.equal(state.customers.length, 0);
    assert.equal(state.identities.length, 0);
  });

  it('uses the P2002 race winner and updates its consent', async () => {
    const state = {
      identities: [] as any[],
      customers: [] as any[],
      customerUpdates: [] as any[],
      identityUpdates: [] as any[],
      audits: [] as any[],
    };
    const inboxRepo = {
      findActiveChannelByLineChannelId: async () => channel(),
      findIdentity: async () => state.identities[0] ?? null,
      createIdentity: async (_data: any): Promise<any> => {
        state.identities.push({
          id: 'idn-winner',
          companyId: 'co-from-channel',
          channelId: 'ch-1',
          customerId: 'cust-winner',
          providerUserId: 'line-user-from-token',
          verifiedLinkAt: null,
          verifiedLinkVia: null,
        });
        const err = new Error('unique');
        (err as any).code = 'P2002';
        throw err;
      },
      updateIdentity: async (id: string, data: any) => { state.identityUpdates.push({ id, data }); return { id, ...data }; },
      registerExistingIdentityConsent: async (input: any) => {
        const identity = state.identities.find((candidate) => candidate.id === input.identityId)!;
        state.customerUpdates.push({ companyId: input.companyId, id: identity.customerId, data: { consentStatus: 'GRANTED' } });
        state.identityUpdates.push({ id: identity.id, data: { verifiedLinkVia: 'LIFF', verifiedLinkAt: input.now } });
        return { customerId: identity.customerId };
      },
    };
    const crmRepo = {
      createLineCustomerAndIdentity: async ({ customer: data, identity: identityData }: any) => {
        const customer = { id: 'cust-loser', ...data };
        state.customers.push(customer);
        try {
          const identity = await inboxRepo.createIdentity({ companyId: customer.companyId, customerId: customer.id, ...identityData });
          return { customer, identityId: identity.id };
        } catch (error) {
          state.customers.pop();
          throw error;
        }
      },
      updateCustomer: async (companyId: string, id: string, data: any) => {
        state.customerUpdates.push({ companyId, id, data });
        return { id, companyId, ...data };
      },
    };
    const useCase = new CustomerLineRegisterUseCase(
      { verify: async () => ({ subject: 'line-user-from-token' }) } as any,
      inboxRepo as any,
      crmRepo as any,
      { log: async (entry: any) => { state.audits.push(entry); } } as any,
    );

    const result = await useCase.execute({ idToken: 'tok', lineChannelId: 'line-ch-1', consentGranted: true } as any);

    assert.deepEqual(result, { customerId: 'cust-winner', alreadyRegistered: true });
    assert.equal(state.customers.length, 0); // losing customer transaction rolled back
    assert.equal(state.customerUpdates[0].id, 'cust-winner');
    assert.equal(state.identityUpdates[0].id, 'idn-winner');
    assert.equal(state.audits[0].targetId, 'cust-winner');
  });
});

describe('CustomerLineRegisterController', () => {
  it('renders the server-resolved company name HTML-escaped in the page title and header', async () => {
    const companyName = `บริษัท & <ร้าน> "ดี" 'จริง'`;
    const lookups: string[] = [];
    const controller = new CustomerLineRegisterController(
      { lineLiffId: 'liff-1' } as any,
      {} as any,
      {} as any,
      { findActiveChannelByLineChannelId: async (id: string) => { lookups.push(id); return channel(); } } as any,
      { findCompany: async (companyId: string) => { lookups.push(companyId); return { brandName: companyName, name: 'Legal name' }; } } as any,
    );

    const html = await controller.customerRegisterPage({
      url: '/v1/auth/line/customer-register-page?lineChannelId=line-ch-1',
      headers: {},
      protocol: 'https',
      get: () => 'api.example.test',
    } as any);

    const escapedName = 'บริษัท &amp; &lt;ร้าน&gt; &quot;ดี&quot; &#39;จริง&#39;';
    assert.deepEqual(lookups, ['line-ch-1', 'co-from-channel']);
    assert.ok(html.includes(`<title>${escapedName} LINE Customer Registration</title>`));
    assert.ok(html.includes(`<h1>ลงทะเบียนลูกค้า LINE — ${escapedName}</h1>`));
    assert.equal(html.includes(companyName), false);
    assert.equal(html.includes('WatchDog'), false);
  });

  it('keeps the generic page for an unknown or disabled channel', async () => {
    const controller = new CustomerLineRegisterController(
      { lineLiffId: 'liff-1' } as any,
      {} as any,
      {} as any,
      { findActiveChannelByLineChannelId: async () => null } as any,
      { findCompany: async () => { throw new Error('should not resolve company'); } } as any,
    );

    const html = await controller.customerRegisterPage({
      url: '/v1/auth/line/customer-register-page?lineChannelId=missing',
      headers: {},
      protocol: 'https',
      get: () => 'api.example.test',
    } as any);

    assert.ok(html.includes('<title>มั่งมีพลัส LINE Customer Registration</title>'));
  });
});
