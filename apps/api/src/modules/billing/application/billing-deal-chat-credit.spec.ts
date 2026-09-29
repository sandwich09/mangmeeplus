import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDealRequest } from './billing-package-request';
import type { DealSource } from '../domain/deal-offer';

const paidAt = new Date('2026-09-23T03:00:00.000Z');
const serviceEnd = new Date('2026-10-23T03:00:00.000Z');
const deal = (creditScope: 'CHAT' | 'TOTAL', amount: number | null): DealSource => ({
  requestId: 'deal_1', snapshotHash: 'pinned', months: 1, salesUserId: 'sales_1',
  aiMonthlyBudgetSatang: amount, creditScope,
});

test('new deal writes only its CHAT override and preserves the admin total budget', async () => {
  let aiWrite: any;
  const tx = {
    packageChangeRequest: {
      findFirst: async () => ({ id: 'deal_1', status: 'APPROVED', renewalOfRequestId: 'previous_deal' }),
      updateMany: async () => ({ count: 1 }),
    },
    companyAiConfiguration: { upsert: async (write: any) => { aiWrite = write; } },
    auditLog: { create: async () => ({}) },
  } as any;
  await applyDealRequest(tx, { companyId: 'company_1', invoiceId: 'invoice_1',
    deal: deal('CHAT', 12_000), priceSatang: 49_900, paidAt, serviceEnd });
  assert.deepEqual(aiWrite.create, { companyId: 'company_1', salesDealChatCreditSatang: 12_000,
    salesDealChatCreditEndsAt: serviceEnd });
  assert.deepEqual(aiWrite.update, { salesDealChatCreditSatang: 12_000, salesDealChatCreditEndsAt: serviceEnd });

  await applyDealRequest(tx, { companyId: 'company_1', invoiceId: 'invoice_2',
    deal: deal('CHAT', null), priceSatang: 49_900, paidAt, serviceEnd });
  assert.deepEqual(aiWrite.update, { salesDealChatCreditSatang: null, salesDealChatCreditEndsAt: serviceEnd });
});

test('old approved deal still writes its legacy TOTAL override, and the chat credit it always meant', async () => {
  let aiWrite: any, chatWrite: any;
  const tx = {
    packageChangeRequest: {
      findFirst: async () => ({ id: 'deal_1', status: 'APPROVED', renewalOfRequestId: 'previous_deal' }),
      updateMany: async () => ({ count: 1 }),
    },
    companyAiConfiguration: { upsert: async (write: any) => { aiWrite = write; }, updateMany: async (write: any) => { chatWrite = write; } },
    auditLog: { create: async () => ({}) },
  } as any;
  await applyDealRequest(tx, { companyId: 'company_1', invoiceId: 'invoice_1',
    deal: deal('TOTAL', 12_000), priceSatang: 49_900, paidAt });
  assert.deepEqual(aiWrite.update, { monthlyBudgetSatang: 12_000 });
  // Admin tab rework: the TOTAL is only the safety ceiling now, so a SHARED row gets the chat credit too.
  assert.deepEqual(chatWrite, { where: { companyId: 'company_1', budgetMode: 'SHARED' }, data: { chatMonthlyBudgetSatang: 12_000 } });
});
