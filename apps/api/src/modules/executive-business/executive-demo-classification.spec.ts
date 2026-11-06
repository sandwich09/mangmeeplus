import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutiveReportReadService } from './application/executive-report-read.service';
import { PLATFORM_TENANT_ID } from '../sales-console/application/sales-context';
import type { RequestContext } from '../auth/domain/models/request-context.model';

it('excludes DEMO from executive customers and includes its money in the excluded counter', async () => {
  const when = new Date('2026-10-03T02:30:00Z');
  const since = new Date('2026-08-01T00:00:00Z');
  const profiles = ['CUSTOMER', 'DEMO'].map((reportClassification, i) => ({
    companyId: `company-${i}`, reportClassification, companyCreatedAt: since,
    companyStatus: 'ACTIVE', planState: 'ACTIVE', planTierKey: 'STARTER_249',
    industryGroup: 'FOOD_ACCOMMODATION', provinceCode: null, discovery: 'OTHER',
    signupRail: 'official-site', referrerKind: 'NONE', creditedSalesUserId: null,
    referrerSalesUserId: null, referralSource: null, receiptAdoption: 'NEVER',
    expenseReceiptCountLifetime: 0, firstActivityAt: null, lastActivityAt: null,
    lastWebEntryAt: null, lastLineActivityAt: null, salesCreditPaidAt: null,
  }));
  const rows = profiles.map(profile => ({
    companyId: profile.companyId, reportClassification: profile.reportClassification,
    month: '2026-09', paidEver: 'YES', paidEverReason: null, fullyRefunded: false,
    usageGroup: 'ACTIVE', usageUnassessedReason: null,
    receiptsSatang: 2500, refundsSatang: 0, feesSatang: 12, aiCostSatang: 4, taxSatang: 0,
    activeDays: 1, activeUsers: 1, confirmedExpensesLine: 0, confirmedExpensesWeb: 1,
    issuedDocuments: 0, aiRequests: 0, expenseReceiptsLine: 0, expenseReceiptsWeb: 0,
    moneyByPurchaseKind: {}, disputedInvoiceCount: 0, countersHeld: false,
  }));
  const build = {
    id: 'build', asOf: when, definitionVersion: 'fixture-version', dimensionVersion: '1',
    unclassifiedCount: 0, billingSince: since, billingDataThrough: when, aiUsageSince: since,
  };
  const tx: any = {
    $queryRaw: async () => [],
    executiveReportBuild: { findFirst: async () => build },
    executiveReportMonth: {
      findFirst: async () => ({ month: '2026-08' }),
      findUnique: async () => ({ revision: 1, revisedAt: null, asOf: when, billingCoveredThrough: when,
        untiedCount: 0, untiedReceiptsSatang: 0, untiedRefundsSatang: 0, untiedOtherSatang: 0, beforeFirstBuild: false }),
      findMany: async () => [],
    },
    executiveCompanyMonth: { findMany: async () => rows, groupBy: async () => [] },
    executiveCompanyProfile: { findMany: async () => profiles },
    company: { findMany: async () => profiles.map(profile => ({ id: profile.companyId, name: 'ร้านตัวอย่าง' })) },
    companySignupRequest: { findMany: async () => [] },
    user: { findMany: async () => [] },
    salesAgentProfile: { findMany: async () => [] },
  };
  const permissions = ['system.executive.read'];
  const service = new ExecutiveReportReadService({ client: {
    ...tx, $transaction: async (read: (db: any) => Promise<any>) => read(tx),
  } } as any, { log: async () => undefined } as any, {} as any, { resolveAccess: async () => ({ permissions }) } as any, {} as any);
  service.clock = () => when;
  const context: RequestContext = {
    requestId: 'request', authSubject: 'executive', userId: 'executive',
    companyId: PLATFORM_TENANT_ID, membershipId: 'member', roles: [], permissions,
    scopes: {}, authProvider: 'watchdog',
  };
  const overview = await service.overview(context, { month: '2026-09' });
  assert.equal(overview.metrics.companies.value, 1);
  assert.equal(overview.population.excludedTestInternalCount, 1);
  assert.equal(overview.population.excludedTestInternalNetReceiptsSatang, 2500);
});
