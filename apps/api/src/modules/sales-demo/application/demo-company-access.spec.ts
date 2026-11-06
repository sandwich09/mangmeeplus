import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { assertNotDemoCompany, assertNotDemoEmailRecipient } from './demo-company-access';
import { BillingService } from '../../billing/application/billing.service';
import { EmailDeliveryService } from '../../auth/application/email-delivery.service';
import { LegalAcceptanceService } from '../../auth/application/legal-acceptance.service';
import { ROLE_GRANTS } from '../../auth/permission-registry';
import { reportClassificationOf } from '../../system-partner-management/domain/logic/report-labels.logic';

const unavailable = (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403
  && JSON.stringify(error.getResponse()) === JSON.stringify({ code: 'demo_action_unavailable' });
const demoDb: any = { company: { findUnique: async () => ({ reportClassification: 'DEMO' }), findFirst: async () => ({ id: 'demo' }) } };
function client<T extends object>(prototype: T): T {
  return Object.assign(Object.create(prototype), { prisma: { client: demoDb } });
}

describe('DEMO service walls', () => {
  it('shares the refusal and preserves CUSTOMER and legacy-company calls', async () => {
    await assert.rejects(assertNotDemoCompany(demoDb, 'demo'), unavailable);
    await assert.rejects(assertNotDemoEmailRecipient(demoDb, 'owner@example.test'), unavailable);
    for (const company of [{ reportClassification: 'CUSTOMER' }, { reportClassification: null }, null]) {
      await assertNotDemoCompany({ company: { findUnique: async () => company } } as any, 'customer');
    }
  });
  it('blocks checkout before validation, Stripe or persistence', async () => {
    await assert.rejects(client(BillingService.prototype).checkout({ companyId: 'demo' } as any, {} as any, ''), unavailable);
  });
  it('blocks prepared and queued email even when the recipient belongs to another company', async () => {
    const db = { ...demoDb, emailSendAttempt: { findUnique: async () => ({ id: 'attempt', companyId: 'demo', recipient: 'external@example.test', status: 'READY' }) } };
    let sends = 0;
    const mail = new EmailDeliveryService({ client: db } as any, {} as any, { send: async () => { sends++; } } as any);
    await assert.rejects(mail.prepare({ companyId: 'demo', purpose: 'billing_status', recipient: 'external@example.test' }, db as any), unavailable);
    await assert.rejects(mail.send({ id: 'attempt' } as any, { subject: '', text: '', html: '' }), unavailable);
    await assert.rejects(mail.prepareReviewedBilling({ companyId: 'demo', recipient: 'external@example.test', intentKey: 'billing-notice:one', expectedLatestId: null }, db as any), unavailable);
    assert.equal(sends, 0);
  });
  it('blocks legacy tenantless emails addressed to DEMO users', async () => {
    const db = { ...demoDb, emailSendAttempt: { findUnique: async () => ({ id: 'attempt', companyId: null, recipient: 'demo@example.test', status: 'READY' }) } };
    const mail = new EmailDeliveryService({ client: db } as any, {} as any, {} as any);
    await assert.rejects(mail.send({ id: 'attempt' } as any, { subject: '', text: '', html: '' }), unavailable);
  });
  it('bypasses the demo legal gate without manufacturing legal acceptance records', async () => {
    const db = { companyMembership: { findFirst: async () => ({ id: 'member', companyId: 'demo', company: { name: 'ตัวอย่าง', reportClassification: 'DEMO' }, roles: [{ role: { key: 'OWNER' } }] }) } };
    const legal = new LegalAcceptanceService({ client: db } as any, {} as any);
    const status = await legal.getStatus({ userId: 'demo-owner', companyId: 'demo', membershipId: 'member' });
    assert.equal(status.required, false); assert.equal(status.acceptedAt, null);
  });
  it('grants mint authority only to the two sales roles and the sales-managing system admin', () => {
    assert.deepEqual(Object.entries(ROLE_GRANTS).filter(([, keys]) => keys.includes('sales.demo_link.create')).map(([role]) => role).sort(), ['MANGMEE_SALES', 'MANGMEE_SALES_LEAD', 'SYSTEM_ADMIN']);
  });
  it('keeps DEMO classified and outside the executive CUSTOMER population', () => {
    const companies = ['DEMO', 'CUSTOMER', 'TEST', 'INTERNAL'].map(reportClassification => ({ id: reportClassification, reportClassification }));
    assert.equal(reportClassificationOf(companies[0]), 'DEMO');
    assert.deepEqual(companies.filter(company => (reportClassificationOf(company) ?? 'CUSTOMER') === 'CUSTOMER').map(company => company.id), ['CUSTOMER']);
  });
});
