import { Injectable } from '@nestjs/common';
import { REPORT_INDUSTRY_GROUP_VERSION, planTermState, reportIndustryGroupOf, salesCreditState,
  type SalesAttributionSource, type SalesDeductionKind } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma, type ExecutiveCompanyMonth, type PrismaClient } from '../../../generated/prisma/client';
import { BillingCashMovementsService, billingCoveredThrough, type BillingCashMovement } from '../../billing/application/billing-cash-movements.service';
import { evaluateEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { reportClassificationOf } from '../../system-partner-management/domain/logic/report-labels.logic';
import { aggregateReport } from '../../sales-console/domain/sales-attribution.logic';
import { EXECUTIVE_DEFINITION_VERSION, NO_USAGE, USAGE_COUNTERS, bangkokDayStart, decideDiscovery, decidePaidEver, decideReceiptAdoption,
  decideReferrer, decideSignupRail, decideUsageGroup, executiveMonthOf, executiveMonthRange, executiveMonths, figuresKey, int32,
  keepLargerCounters, nextRevision, type CompanyMonthFigures, type MoneyByKind, type UsageCounters } from '../domain/executive-report.logic';

export type ExecutiveRebuildResult =
  | { status: 'SKIPPED' }
  | { status: 'BUILT'; buildId: string; kind: 'HOURLY' | 'FULL'; months: string[]; companyCount: number };

type CompanyRow = { id: string; createdAt: Date; status: string; businessTypeCode: string | null; businessTypeOther: string | null; reportClassification: string | null;
  reportIndustryGroup: string | null; referralSalesUserId: string | null; referralSource: string | null; province: string | null };
type SignupRow = { companyId: string; source: string; discoverySource: string | null; createdAt: Date };
type ActivityRow = { companyId: string; firstAt: Date; lastAt: Date; lastLineAt: Date | null; aiRequests30: number } &
  Omit<UsageCounters, 'expenseReceiptsLine' | 'expenseReceiptsWeb'>;
type Money = { receiptsSatang: number; refundsSatang: number; feesSatang: number; taxSatang: number };
const noMoney = (): Money => ({ receiptsSatang: 0, refundsSatang: 0, feesSatang: 0, taxSatang: 0 });
const earlier = (a: Date | null | undefined, b: Date | null | undefined) => (!a ? b ?? null : !b ? a : a < b ? a : b);
const later = (a: Date | null | undefined, b: Date | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);
/** One INSERT carries at most 65,535 values; a company-month row has about 40. */
const chunks = <T>(rows: T[], size = 500): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const group = groups.get(key(row)); if (group) group.push(row); else groups.set(key(row), [row]); }
  return groups;
}

/**
 * Builds the executive report's summary tables (executive backend spec §12.3).
 *
 * One round: take the one advisory lock (a round that finds it taken skips), read every source as
 * a set with no lock on any billing or customer row, then write the whole round in one go. A read
 * that fails writes nothing, so the old set stays and the build pointer does not move.
 *
 * The lock lives in the transaction that also writes, opened first so that the lock spans the
 * round; it is idle while the sets are read through other connections and holds row locks only
 * for the final statements.
 *
 * ponytail: every round reads all balance movements and all receipt-evidence rows again. Fine at
 * a thousand companies; read only what is newer than the stored set when the round's duration
 * says so.
 */
@Injectable()
export class ExecutiveReportBuildUseCase {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingCashMovementsService) {}

  /** `now` and `definitionVersion` are parameters for tests; the worker endpoint passes neither. */
  rebuild(now: Date = new Date(), definitionVersion: number = EXECUTIVE_DEFINITION_VERSION): Promise<ExecutiveRebuildResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended('executive-report-build', 0)) AS locked`;
      return lock?.locked ? this.round(tx, now, definitionVersion) : { status: 'SKIPPED' as const };
    }, { maxWait: 10_000, timeout: 15 * 60_000 });
  }

  private async round(tx: Prisma.TransactionClient, asOf: Date, definitionVersion: number): Promise<ExecutiveRebuildResult> {
    const db = this.prisma.client, startedAt = new Date(), currentMonth = executiveMonthOf(asOf);

    // Once a day (Bangkok) a round goes back to the first month with data; a new definition version has no such round yet.
    const fullToday = await db.executiveReportBuild.findFirst({ where: { definitionVersion, kind: 'FULL', asOf: { gte: bangkokDayStart(asOf) } }, select: { id: true } });
    const kind = fullToday ? 'HOURLY' as const : 'FULL' as const;

    const since7 = new Date(bangkokDayStart(asOf).getTime() - 6 * 86_400_000), since30 = new Date(bangkokDayStart(asOf).getTime() - 29 * 86_400_000);

    // ── Current facts, one set each ──
    const [companies, terms, signups, provinces, discoverySince, aiSince, ocrSince, firstBuild, members, branches, entitlementRows,
      attributions, deductions, webEntries, receiptEvidence, storedProfiles, movements, coverage, payments, receiptFacts, storedSnapshots] = await Promise.all([
      db.$queryRaw<CompanyRow[]>`SELECT c.id, c."createdAt", c.status::text AS status, c."businessTypeCode", c."businessTypeOther", c."reportClassification", c."reportIndustryGroup",
          c."referralSalesUserId", c."referralSource", c."addressJson"->>'province' AS province FROM "Company" c WHERE c."createdAt" < ${asOf}`,
      db.companyPlanTerm.findMany({ select: { companyId: true, tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } }),
      // The original signup of a company: its earliest linked request. A later request never replaces it (spec §15).
      db.$queryRaw<SignupRow[]>`SELECT DISTINCT ON ("companyId") "companyId", source, "discoverySource", "createdAt"
          FROM "CompanySignupRequest" WHERE "companyId" IS NOT NULL ORDER BY "companyId", "createdAt", id`,
      db.$queryRaw<Array<{ provinceTh: string; provinceCode: string }>>`SELECT DISTINCT "provinceTh", "provinceCode" FROM "ThaiAddressMaster"`,
      db.companySignupRequest.aggregate({ where: { discoverySource: { not: null } }, _min: { createdAt: true } }),
      db.aiUsageEvent.aggregate({ _min: { createdAt: true } }),
      db.companyOcrUsageEvent.aggregate({ _min: { createdAt: true } }),
      db.executiveReportBuild.aggregate({ _min: { asOf: true } }),
      db.companyMembership.groupBy({ by: ['companyId'], where: { status: 'ACTIVE', user: { status: 'ACTIVE' } }, _count: { _all: true } }),
      db.branch.groupBy({ by: ['companyId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
      db.companyFeatureEntitlement.findMany({ select: { companyId: true, featureKey: true, enabled: true } }),
      db.salesAttribution.findMany({ select: { id: true, companyId: true, salesUserId: true, source: true, amountSatang: true, refundedSatang: true,
        paidAt: true, flags: true, flagReviewedAt: true } }),
      db.salesAttributionDeduction.findMany({ select: { attributionId: true, kind: true, amountSatang: true, occurredAt: true, createdAt: true } }),
      // Last web entry (spec §13.1): a session of an ACTIVE member who belongs to this company only, or
      // the audit row of a LINE-to-web entry. ponytail: walks AuditLog by action once per round.
      db.$queryRaw<Array<{ companyId: string; at: Date }>>`
        SELECT "companyId", MAX(at) AS at FROM (
          SELECT m."companyId", s."issuedAt" AS at FROM "CompanyMembership" m
            JOIN (SELECT "userId" FROM "CompanyMembership" WHERE status = 'ACTIVE' GROUP BY "userId" HAVING COUNT(*) = 1) one ON one."userId" = m."userId"
            JOIN (SELECT "userId", MAX("issuedAt") AS "issuedAt" FROM "AuthSession" WHERE "issuedAt" < ${asOf} GROUP BY "userId") s ON s."userId" = m."userId"
           WHERE m.status = 'ACTIVE'
          UNION ALL
          SELECT "companyId", MAX("createdAt") FROM "AuditLog"
           WHERE action IN ('auth.line.liff_session', 'auth.line_handoff.exchange') AND "companyId" IS NOT NULL AND "createdAt" < ${asOf} GROUP BY "companyId"
        ) entries GROUP BY "companyId"`,
      // Positive evidence that a receipt was ever added (spec §13.4). Each source can lose rows, so none proves "never".
      db.$queryRaw<Array<{ companyId: string }>>`
        SELECT "companyId" FROM "ExpenseRecord" WHERE "captureSource" IN ('WEB_UPLOAD', 'LINE_UPLOAD')
        UNION SELECT "companyId" FROM "AttachmentLink" WHERE purpose = 'expense.receipt.primary'
        UNION SELECT "companyId" FROM "CompanyOcrUsageEvent" WHERE "sourceRoute" IN ('receipt-ocr-web', 'receipt-ocr-line')`,
      db.executiveCompanyProfile.findMany({ select: { companyId: true, firstActivityAt: true, lastActivityAt: true, lastLineActivityAt: true,
        lastWebEntryAt: true, receiptAdoption: true, expenseReceiptCountLifetime: true, sheetFacts: true } }),
      this.billing.movements({ start: new Date(0), end: asOf }),
      this.billing.coverage(),
      this.billing.companyPayments(),
      db.$queryRaw<Array<{ companyId: string; firstReceiptAt: Date; lastReceiptAt: Date; receipts7: number; receipts30: number; receiptDays30: number; confirmed: number; pending: number; draft: number; sourceCount: number }>>`
        SELECT "companyId", MIN("createdAt") AS "firstReceiptAt", MAX("createdAt") AS "lastReceiptAt", COUNT(*)::int AS "sourceCount",
          COUNT(*) FILTER (WHERE "createdAt" >= ${since7})::int AS "receipts7",
          COUNT(*) FILTER (WHERE "createdAt" >= ${since30})::int AS "receipts30",
          COUNT(DISTINCT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date) FILTER (WHERE "createdAt" >= ${since30})::int AS "receiptDays30",
          COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed,
          COUNT(*) FILTER (WHERE status IN ('EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'))::int AS pending,
          COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft
        FROM "ExpenseRecord" WHERE "createdAt" < ${asOf} AND "captureSource" IN ('WEB_UPLOAD', 'LINE_UPLOAD') GROUP BY "companyId"`,
      db.executiveCompanyMonth.findMany({ where: { definitionVersion }, select: { companyId: true, month: true, lastActivityAt: true, activeDays: true, activitySnapshotReady: true } }),
    ]);
    const referrerIds = [...new Set(companies.flatMap((company) => company.referralSalesUserId ? [company.referralSalesUserId] : []))];
    const salesProfiles = new Set((referrerIds.length ? await db.salesAgentProfile.findMany({ where: { userId: { in: referrerIds } }, select: { userId: true } }) : [])
      .map((profile) => profile.userId));

    const companyIds = new Set(companies.map((company) => company.id));
    const termOf = new Map(terms.map((term) => [term.companyId, term]));
    const signupOf = new Map(signups.map((signup) => [signup.companyId, signup]));
    const provinceCodeOf = new Map(provinces.map((row) => [row.provinceTh, row.provinceCode]));
    const memberCount = new Map(members.map((row) => [row.companyId, row._count._all]));
    const branchCount = new Map(branches.map((row) => [row.companyId, row._count._all]));
    const entitlementsOf = groupBy(entitlementRows, (row) => row.companyId);
    const webEntryOf = new Map(webEntries.map((row) => [row.companyId, row.at]));
    const hasReceiptEvidence = new Set(receiptEvidence.map((row) => row.companyId));
    const storedProfileOf = new Map(storedProfiles.map((profile) => [profile.companyId, profile]));
    const heldReceiptMonthsOf = new Map(storedProfiles.map(profile => [profile.companyId, new Set((profile.sheetFacts as { purgedReceiptMonths?: string[] } | null)?.purgedReceiptMonths ?? [])]));
    const attributionOf = new Map(attributions.map((row) => [row.companyId, row]));
    const deductionsOf = groupBy(deductions, (row) => row.attributionId);

    // ── Money: every movement once, tied to a known company or kept apart ──
    const tiedOf = new Map<string, BillingCashMovement[]>(), untied: BillingCashMovement[] = [], unsuccessfulRefunds: BillingCashMovement[] = [];
    for (const movement of movements) {
      if (movement.tie === 'COMPANY' && movement.companyId && companyIds.has(movement.companyId) && movement.currency === 'THB') {
        const list = tiedOf.get(movement.companyId);
        if (list) list.push(movement); else tiedOf.set(movement.companyId, [movement]);
      } else if (movement.tie === 'EXCLUDED') { if (movement.kind === 'REFUND') unsuccessfulRefunds.push(movement); }
      // Money matched to a company that is no longer there is not dropped: it joins the money no company answers for.
      else untied.push(movement);
    }
    const firstUntiedReceiptAt = untied.filter((movement) => movement.kind === 'RECEIPT').reduce<Date | null>((first, movement) => earlier(first, movement.occurredAt), null);
    const unmatchedMoneyMonths = [...new Set(untied.map(movement => executiveMonthOf(movement.occurredAt)))].sort();
    const billingReadThrough = coverage.since ? billingCoveredThrough(coverage.ranges, coverage.since) : null;

    // ── Sales credit by month, by the sales module's own rules (spec §14.3) ──
    const creditOf = new Map<string, Map<string, { satang: number; activations: number; waiting: number }>>();
    for (const row of attributions) {
      const months = aggregateReport(
        [{ salesUserId: row.salesUserId, source: row.source as SalesAttributionSource, amountSatang: row.amountSatang, refundedSatang: row.refundedSatang,
          paidAt: row.paidAt, flags: row.flags, flagReviewedAt: row.flagReviewedAt }],
        (deductionsOf.get(row.id) ?? []).map((item) => ({ kind: item.kind as SalesDeductionKind, amountSatang: item.amountSatang, occurredAt: item.occurredAt,
          recordedAt: item.createdAt, companyName: '', row })),
        () => ({ displayName: '', teamLeadUserId: null, teamLeadDisplayName: null }));
      creditOf.set(row.companyId, new Map(months.map((month) => [month.monthKey, { satang: month.rows.reduce((sum, agent) => sum + agent.amountSatang, 0),
        activations: month.rows.reduce((sum, agent) => sum + agent.dealActivations + agent.referralActivations, 0),
        waiting: month.rows.reduce((sum, agent) => sum + agent.flaggedCount, 0) }])));
    }

    // ── The months of this round ──
    const firstCompanyAt = companies.reduce<Date | null>((first, company) => earlier(first, company.createdAt), null);
    const firstMonth = firstCompanyAt ? executiveMonthOf(firstCompanyAt) : currentMonth;
    const previousMonth = executiveMonthOf(new Date(executiveMonthRange(currentMonth).start.getTime() - 1));
    const months = kind === 'FULL' ? executiveMonths(firstMonth, currentMonth) : executiveMonths(previousMonth < firstMonth ? firstMonth : previousMonth, currentMonth);
    const firstBuildAt = firstBuild._min.asOf ?? asOf;

    // A company nobody labelled yet counts as a customer, so the report shows every account by default; TEST, INTERNAL and DEMO take one out.
    const classificationOf = (company: CompanyRow) => reportClassificationOf(company) ?? 'CUSTOMER';
    const monthRows: Prisma.ExecutiveCompanyMonthCreateManyInput[] = [], monthHeaders: Prisma.ExecutiveReportMonthCreateManyInput[] = [];
    const activityOf = new Map<string, { firstAt: Date | null; lastAt: Date | null; lastLineAt: Date | null; aiRequests30: number }>();
    const paidNow = new Map<string, { paidEver: string; paidEverReason: string | null; fullyRefunded: boolean }>();

    // Oldest month first, so a later month can ask "was there a counted action before my cutoff" of the months before it.
    const usageOf = new Map<string, Awaited<ReturnType<typeof readMonthSources>>>();
    for (const month of months) {
      const sources = await readMonthSources(db, month, asOf, definitionVersion);
      usageOf.set(month, sources);
      for (const row of sources.activity) {
        const seen = activityOf.get(row.companyId);
        activityOf.set(row.companyId, { firstAt: earlier(seen?.firstAt, row.firstAt), lastAt: later(seen?.lastAt, row.lastAt), lastLineAt: later(seen?.lastLineAt, row.lastLineAt), aiRequests30: int32((seen?.aiRequests30 ?? 0) + row.aiRequests30, 'aiRequests30') });
      }
    }
    const lastUseOf = new Map<string, Date | null>();
    const uncertainLastUse = new Map<string, Date>();
    for (const row of storedSnapshots) if (row.month < months[0]!) {
      lastUseOf.set(row.companyId, later(lastUseOf.get(row.companyId), row.lastActivityAt));
      if (!row.activitySnapshotReady && row.activeDays > 0) uncertainLastUse.set(row.companyId, later(uncertainLastUse.get(row.companyId), executiveMonthRange(row.month).end)!);
    }
    const firstActivityOf = (companyId: string) => earlier(storedProfileOf.get(companyId)?.firstActivityAt, activityOf.get(companyId)?.firstAt);

    for (const month of months) {
      const range = executiveMonthRange(month), running = asOf < range.end, cutoff = running ? asOf : range.end;
      const sources = usageOf.get(month)!;
      const activity = new Map(sources.activity.map((row) => [row.companyId, row]));
      const receipts = new Map(sources.receipts.map((row) => [row.companyId, row]));
      const aiCost = new Map(sources.aiCost.map((row) => [row.companyId, Number(row.costSatang)]));
      const inMonth = (movement: BillingCashMovement) => movement.occurredAt >= range.start && movement.occurredAt < cutoff;
      // Every usage source kept rows for the whole month; null = the source holds no row at all, so nothing was missed.
      const monthHistoryComplete = !aiSince._min.createdAt || aiSince._min.createdAt <= range.start;
      const billingReadToCutoff = !coverage.since || (billingReadThrough !== null && billingReadThrough >= cutoff);
      const untiedReceiptBeforeCutoff = firstUntiedReceiptAt !== null && firstUntiedReceiptAt < cutoff;
      // The stored answer of this month can only be revised once it was final: the month had ended, and the provider had
      // been read to its end (or no online payment could exist in it). Until then the last day's money is still on its way.
      const old = sources.storedHeader;
      const wasFinished = !!old && old.asOf >= range.end
        && (!coverage.since || coverage.since >= range.end || (!!old.billingCoveredThrough && old.billingCoveredThrough >= range.end));
      let changed = old === null;

      const present = new Set<string>();
      for (const company of companies) {
        if (company.createdAt >= cutoff) continue; // not yet registered in this month (NOT_YET_REGISTERED)
        present.add(company.id);
        const tied = tiedOf.get(company.id) ?? [], payment = payments.get(company.id), term = termOf.get(company.id) ?? null;

        const money = noMoney(), byKind: MoneyByKind = {}, disputed = new Set<string>();
        for (const movement of tied.filter(inMonth)) {
          const kindMoney = byKind[movement.purchaseKind] ??= noMoney();
          for (const target of [money, kindMoney]) {
            if (movement.kind === 'RECEIPT') { target.receiptsSatang += movement.amountSatang; target.taxSatang += movement.taxSatang ?? 0; }
            else target.refundsSatang += movement.amountSatang;
            target.feesSatang += movement.feeSatang;
          }
          if (movement.kind === 'RECEIPT' && movement.invoiceDisputed && movement.invoiceId) disputed.add(movement.invoiceId);
        }
        const before = tied.filter((movement) => movement.occurredAt < cutoff);
        const receiptsBefore = before.filter((movement) => movement.kind === 'RECEIPT').reduce((sum, movement) => sum + movement.amountSatang, 0);
        const refundsBefore = before.filter((movement) => movement.kind === 'REFUND').reduce((sum, movement) => sum + movement.amountSatang, 0);

        const paidEver = decidePaidEver({ receiptBeforeCutoff: before.some((movement) => movement.kind === 'RECEIPT'),
          paidInvoiceNow: payment?.paidInvoice ?? false, monthIsCurrent: running, billingReadToCutoff, untiedReceiptBeforeCutoff,
          sourceWithoutInvoice: payment?.sourceWithoutInvoice ?? null, term });
        // Paid, and everything paid has gone back (Q19): by the dated movements, and for today also by billing's own invoice totals.
        const fullyRefunded = paidEver.value === 'YES' && ((receiptsBefore > 0 && refundsBefore >= receiptsBefore)
          || (running && !!payment?.paidInvoice && payment.invoiceRefundedSatang >= payment.invoicePaidSatang));

        const stored = sources.stored.get(company.id) ?? null, seen = activity.get(company.id), receipt = receipts.get(company.id);
        const heldReceiptMonths = heldReceiptMonthsOf.get(company.id) ?? new Set<string>();
        if ((stored?.expenseReceiptsLine ?? 0) + (stored?.expenseReceiptsWeb ?? 0) > (receipt?.expenseReceiptsLine ?? 0) + (receipt?.expenseReceiptsWeb ?? 0)) heldReceiptMonths.add(month);
        else heldReceiptMonths.delete(month);
        heldReceiptMonthsOf.set(company.id, heldReceiptMonths);
        const { counters, held } = keepLargerCounters({ ...NO_USAGE, ...(seen ? pickCounters(seen) : {}),
          expenseReceiptsLine: receipt?.expenseReceiptsLine ?? 0, expenseReceiptsWeb: receipt?.expenseReceiptsWeb ?? 0 }, stored);
        const firstActivityAt = firstActivityOf(company.id);
        const usage = decideUsageGroup({ paidEver: paidEver.value, fullyRefunded, activeInMonth: counters.activeDays > 0,
          usedBeforeCutoff: !!firstActivityAt && firstActivityAt < cutoff, monthHistoryComplete,
          historyCompleteSinceSignup: !aiSince._min.createdAt || aiSince._min.createdAt <= company.createdAt });
        const credit = creditOf.get(company.id)?.get(month);

        const lastActivityAt = later(lastUseOf.get(company.id), later(seen?.lastAt, stored?.activitySnapshotReady ? stored.lastActivityAt : null));
        lastUseOf.set(company.id, lastActivityAt);
        // A held count cannot reconstruct the dates of actions deleted before the first snapshot.
        if (counters.activeDays > (seen?.activeDays ?? 0) && !stored?.activitySnapshotReady) uncertainLastUse.set(company.id, cutoff);
        const uncertainThrough = uncertainLastUse.get(company.id);
        if (uncertainThrough && lastActivityAt && lastActivityAt >= uncertainThrough) uncertainLastUse.delete(company.id);
        const activityHistorySince = later(firstBuildAt, aiSince._min.createdAt);
        const activitySnapshotReady = !uncertainLastUse.has(company.id);
        const figures: CompanyMonthFigures = { ...counters, lastActivityAt, activityHistorySince, activitySnapshotReady, reportClassification: classificationOf(company),
          receiptsSatang: money.receiptsSatang, refundsSatang: money.refundsSatang, feesSatang: money.feesSatang, taxSatang: money.taxSatang,
          moneyByPurchaseKind: byKind, disputedInvoiceCount: disputed.size, aiCostSatang: aiCost.get(company.id) ?? 0, countersHeld: held,
          paidEver: paidEver.value, paidEverReason: paidEver.reason, fullyRefunded, usageGroup: usage.usageGroup, usageUnassessedReason: usage.reason,
          salesCreditSatang: credit?.satang ?? 0, salesCreditActivations: credit?.activations ?? 0, salesCreditWaiting: credit?.waiting ?? 0 };
        for (const [name, value] of Object.entries(figures)) if (typeof value === 'number') int32(value, name);
        for (const kindMoney of Object.values(byKind)) for (const [name, value] of Object.entries(kindMoney)) int32(value, name);

        // Only a row of this definition version is an earlier answer; a row of an older version only lent its counters.
        const earlierAnswer = stored?.definitionVersion === definitionVersion ? stored : null;
        const rowChanged = !earlierAnswer || figuresKey(storedFigures(earlierAnswer)) !== figuresKey(figures);
        if (rowChanged) changed = true;
        monthRows.push({ ...figures, moneyByPurchaseKind: byKind as Prisma.InputJsonValue, companyId: company.id, month, definitionVersion, buildId: '',
          ...nextRevision(earlierAnswer ? { revision: earlierAnswer.revision, revisedAt: earlierAnswer.revisedAt, wasFinished } : null, rowChanged, asOf) });
        if (running) paidNow.set(company.id, { paidEver: paidEver.value, paidEverReason: paidEver.reason, fullyRefunded });
      }
      if ([...sources.stored.values()].some((row) => row.definitionVersion === definitionVersion && !present.has(row.companyId))) changed = true;

      const untiedInMonth = untied.filter(inMonth);
      const sum = (kindOf: BillingCashMovement['kind'][]) => untiedInMonth.filter((movement) => kindOf.includes(movement.kind) && movement.currency === 'THB')
        .reduce((total, movement) => total + movement.amountSatang, 0);
      const header = { billingCoveredThrough: billingCoveredThrough(coverage.ranges, range.start), untiedCount: untiedInMonth.length,
        untiedReceiptsSatang: int32(sum(['RECEIPT']), 'untiedReceiptsSatang'), untiedRefundsSatang: int32(sum(['REFUND']), 'untiedRefundsSatang'),
        untiedOtherSatang: int32(sum(['OTHER']), 'untiedOtherSatang'), unsuccessfulRefundCount: unsuccessfulRefunds.filter(inMonth).length };
      if (old && (['untiedCount', 'untiedReceiptsSatang', 'untiedRefundsSatang', 'untiedOtherSatang', 'unsuccessfulRefundCount'] as const).some((key) => old[key] !== header[key])) changed = true;
      monthHeaders.push({ ...header, month, definitionVersion, buildId: '', asOf, beforeFirstBuild: range.start < firstBuildAt,
        ...nextRevision(old ? { revision: old.revision, revisedAt: old.revisedAt, wasFinished } : null, changed, asOf) });
    }

    // ── One profile per company: the dimensions as they are now and the values of its whole life ──
    const receiptFactsOf = new Map(receiptFacts.map(row => [row.companyId, row]));
    const profiles: Prisma.ExecutiveCompanyProfileCreateManyInput[] = companies.map((company) => {
      const signup = signupOf.get(company.id) ?? null, term = termOf.get(company.id) ?? null, stored = storedProfileOf.get(company.id);
      const discovery = decideDiscovery(signup, discoverySince._min.createdAt), industry = reportIndustryGroupOf(company);
      const referrerKind = decideReferrer({ referralSalesUserId: company.referralSalesUserId, discovery,
        salesProfileExists: !!company.referralSalesUserId && salesProfiles.has(company.referralSalesUserId) });
      const tied = tiedOf.get(company.id) ?? [], attribution = attributionOf.get(company.id), seen = activityOf.get(company.id);
      const entitled = evaluateEntitledFeatureKeys(entitlementsOf.get(company.id) ?? []);
      const province = company.province?.trim().replace(/^(จังหวัด|จ\.)\s*/, '') ?? '';
      const paid = paidNow.get(company.id)!;
      const receipt = receiptFactsOf.get(company.id), oldFacts = stored?.sheetFacts as { firstReceiptAt?: string | null; lastReceiptAt?: string | null } | null;
      const storedReceiptCount = [...usageOf.values()].reduce((n, source) => n + (source.stored.get(company.id)?.expenseReceiptsLine ?? 0) + (source.stored.get(company.id)?.expenseReceiptsWeb ?? 0), 0);
      const receiptCountersHeld = (receipt?.sourceCount ?? 0) < Math.max(storedReceiptCount, stored?.expenseReceiptCountLifetime ?? 0);
      const purgedReceiptMonths = receiptCountersHeld ? [...(heldReceiptMonthsOf.get(company.id) ?? [])].sort() : [];
      const firstReceiptAt = earlier(receipt?.firstReceiptAt, oldFacts?.firstReceiptAt ? new Date(oldFacts.firstReceiptAt) : null);
      const lastReceiptAt = later(receipt?.lastReceiptAt, oldFacts?.lastReceiptAt ? new Date(oldFacts.lastReceiptAt) : null);
      const knownRecent = (since: Date) => lastReceiptAt && lastReceiptAt >= since ? 1 : 0;
      const knownDays30 = knownRecent(since30) && firstReceiptAt && firstReceiptAt >= since30 && lastReceiptAt && bangkokDayStart(firstReceiptAt) < bangkokDayStart(lastReceiptAt) ? 2 : knownRecent(since30);
      const sheetFacts = {
        unmatchedMoneyMonths,
        aiRequests30: seen?.aiRequests30 ?? 0, aiUsageSince: aiSince._min.createdAt?.toISOString() ?? null,
        firstReceiptAt: firstReceiptAt?.toISOString() ?? null,
        lastReceiptAt: lastReceiptAt?.toISOString() ?? null,
        ...Object.fromEntries(['receipts7', 'receipts30', 'receiptDays30', 'confirmed', 'pending', 'draft', 'sourceCount'].map(key => [key, int32(receipt?.[key as 'receipts7'] ?? 0, key)])),
        receipts7: Math.max(receipt?.receipts7 ?? 0, knownRecent(since7)), receipts30: Math.max(receipt?.receipts30 ?? 0, knownRecent(since30)), receiptDays30: Math.max(receipt?.receiptDays30 ?? 0, knownDays30),
        activitySnapshotReady: !uncertainLastUse.has(company.id), activityHistorySince: later(firstBuildAt, aiSince._min.createdAt)?.toISOString() ?? null, receiptHistorySince: later(firstBuildAt, ocrSince._min.createdAt)?.toISOString() ?? null, receiptCountersHeld, purgedReceiptMonths };
      return {
        companyId: company.id, buildId: '', companyCreatedAt: company.createdAt, companyStatus: company.status, reportClassification: classificationOf(company),
        industryGroup: industry?.group ?? null, industryGroupSource: industry?.source ?? null, provinceCode: provinceCodeOf.get(province) ?? null,
        discovery, signupRail: decideSignupRail(signup), referrerKind, referrerSalesUserId: company.referralSalesUserId,
        referralSource: company.referralSalesUserId ? company.referralSource : null,
        creditedSalesUserId: attribution?.salesUserId ?? null, salesCreditPaidAt: attribution?.paidAt ?? null,
        salesCreditState: attribution ? salesCreditState(attribution.flags, attribution.flagReviewedAt) : null,
        planState: planTermState(term, asOf, company.status), planTierKey: term?.tierKey ?? null, planEndsAt: term?.termEndsAt ?? null,
        ...paid,
        lifetimeReceiptsSatang: int32(tied.filter((movement) => movement.kind === 'RECEIPT').reduce((sum, movement) => sum + movement.amountSatang, 0), 'lifetimeReceiptsSatang'),
        lifetimeRefundsSatang: int32(tied.filter((movement) => movement.kind === 'REFUND').reduce((sum, movement) => sum + movement.amountSatang, 0), 'lifetimeRefundsSatang'),
        firstActivityAt: firstActivityOf(company.id), lastActivityAt: later(stored?.lastActivityAt, seen?.lastAt),
        lastLineActivityAt: later(stored?.lastLineActivityAt, seen?.lastLineAt), lastWebEntryAt: later(stored?.lastWebEntryAt, webEntryOf.get(company.id)),
        receiptAdoption: decideReceiptAdoption({ evidence: hasReceiptEvidence.has(company.id) || stored?.receiptAdoption === 'EVER',
          entitled: entitled === null || entitled.has('expenses'), createdAt: company.createdAt, ocrUsageSince: ocrSince._min.createdAt }),
        sheetFacts, businessTypeCode: company.businessTypeCode, businessTypeOther: company.businessTypeOther,
        activeMemberCount: memberCount.get(company.id) ?? 0, branchCount: branchCount.get(company.id) ?? 0,
      };
    });

    // ── The write: the whole round, or nothing ──
    const build = await tx.executiveReportBuild.create({ data: { kind, definitionVersion, dimensionVersion: REPORT_INDUSTRY_GROUP_VERSION, asOf, startedAt,
      finishedAt: new Date(), firstMonth: months[0]!, lastMonth: months.at(-1)!, companyCount: companies.length,
      unclassifiedCount: companies.filter((company) => !reportClassificationOf(company)).length, billingDataThrough: coverage.dataThrough, billingSince: coverage.since,
      aiUsageSince: aiSince._min.createdAt, ocrUsageSince: ocrSince._min.createdAt, discoverySince: discoverySince._min.createdAt } });
    const stamped = <T extends { buildId: string }>(rows: T[]) => rows.map((row) => ({ ...row, buildId: build.id }));
    await tx.executiveCompanyProfile.deleteMany({});
    for (const rows of chunks(stamped(profiles))) await tx.executiveCompanyProfile.createMany({ data: rows });
    await tx.executiveCompanyMonth.deleteMany({ where: { month: { in: months }, definitionVersion } });
    for (const rows of chunks(stamped(monthRows))) await tx.executiveCompanyMonth.createMany({ data: rows });
    await tx.executiveReportMonth.deleteMany({ where: { month: { in: months }, definitionVersion } });
    await tx.executiveReportMonth.createMany({ data: stamped(monthHeaders) });
    // Spec §13.4: the lifetime receipt count is the sum of the stored months, never a recount of what is left.
    await tx.$executeRaw`UPDATE "ExecutiveCompanyProfile" p SET "expenseReceiptCountLifetime" = s.total
      FROM (SELECT "companyId", SUM("expenseReceiptsLine" + "expenseReceiptsWeb")::int AS total FROM "ExecutiveCompanyMonth"
             WHERE "definitionVersion" = ${definitionVersion} GROUP BY "companyId") s WHERE s."companyId" = p."companyId"`;
    return { status: 'BUILT', buildId: build.id, kind, months, companyCount: companies.length };
  }
}

/** What one month needs from the transaction tables, and what was stored for it. Boundaries are UTC instants (spec §12.1). */
async function readMonthSources(db: PrismaClient, month: string, asOf: Date, definitionVersion: number) {
  const range = executiveMonthRange(month), start = range.start, end = asOf < range.end ? asOf : range.end;
  const [activity, receipts, aiCost, storedRows, storedHeader] = await Promise.all([
    // The three counted actions (spec §13.3) as one list, then one row per company. The acting user must be a member
    // of the company (any status), which leaves out the system and platform staff; the join is on a unique key.
    // A Bangkok calendar day is only ever `(col AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date`.
    db.$queryRaw<ActivityRow[]>`
      WITH atoms AS (
        SELECT e."companyId", e."confirmedAt" AS at, e."confirmedByUserId" AS "userId",
               CASE WHEN e."captureSource" = 'LINE_UPLOAD' THEN 'LINE' ELSE 'WEB' END AS channel, 'EXPENSE' AS kind, e.id AS ref
          FROM "ExpenseRecord" e JOIN "CompanyMembership" m ON m."companyId" = e."companyId" AND m."userId" = e."confirmedByUserId"
         WHERE e."confirmedAt" >= ${start} AND e."confirmedAt" < ${end} AND e."captureSource" <> 'API_INTERNAL'
        UNION ALL
        SELECT d."companyId", d."issuedAt", d."createdByUserId", 'WEB', 'DOCUMENT', d.id
          FROM "AccountingDocument" d JOIN "CompanyMembership" m ON m."companyId" = d."companyId" AND m."userId" = d."createdByUserId"
         WHERE d."issuedAt" >= ${start} AND d."issuedAt" < ${end}
        UNION ALL
        SELECT a."companyId", a."createdAt", NULL::text, 'LINE', 'AI', COALESCE(a."requestId", a.id)
          FROM "AiUsageEvent" a
         WHERE a."createdAt" >= ${start} AND a."createdAt" < ${end} AND a."sourceRoute" = 'line-turn' AND a."eventKind" = 'MODEL_CALL' AND a.ok
      )
      SELECT "companyId",
             COUNT(DISTINCT day)::int AS "activeDays",
             COUNT(DISTINCT day) FILTER (WHERE channel = 'LINE')::int AS "activeDaysLine",
             COUNT(DISTINCT day) FILTER (WHERE channel = 'WEB')::int AS "activeDaysWeb",
             COUNT(DISTINCT "userId")::int AS "activeUsers",
             COUNT(DISTINCT "userId") FILTER (WHERE channel = 'LINE')::int AS "activeUsersLine",
             COUNT(DISTINCT "userId") FILTER (WHERE channel = 'WEB')::int AS "activeUsersWeb",
             COUNT(*) FILTER (WHERE kind = 'EXPENSE' AND channel = 'LINE')::int AS "confirmedExpensesLine",
             COUNT(*) FILTER (WHERE kind = 'EXPENSE' AND channel = 'WEB')::int AS "confirmedExpensesWeb",
             COUNT(*) FILTER (WHERE kind = 'DOCUMENT')::int AS "issuedDocuments",
             COUNT(DISTINCT ref) FILTER (WHERE kind = 'AI')::int AS "aiRequests",
             COUNT(DISTINCT ref) FILTER (WHERE kind = 'AI' AND at >= ${new Date(bangkokDayStart(asOf).getTime() - 29 * 86_400_000)})::int AS "aiRequests30",
             MIN(at) AS "firstAt", MAX(at) AS "lastAt", MAX(at) FILTER (WHERE channel = 'LINE') AS "lastLineAt"
        FROM (SELECT *, (at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date AS day FROM atoms) dated
       GROUP BY "companyId"`,
    // One expense added by sending a receipt is one receipt, whatever happened to it later (spec §13.4).
    db.$queryRaw<Array<{ companyId: string; expenseReceiptsLine: number; expenseReceiptsWeb: number }>>`
      SELECT "companyId", COUNT(*) FILTER (WHERE "captureSource" = 'LINE_UPLOAD')::int AS "expenseReceiptsLine",
             COUNT(*) FILTER (WHERE "captureSource" = 'WEB_UPLOAD')::int AS "expenseReceiptsWeb"
        FROM "ExpenseRecord" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "captureSource" IN ('LINE_UPLOAD', 'WEB_UPLOAD')
       GROUP BY "companyId"`,
    // AI cost belongs to the month the meter filed it in (`monthKey`), corrections included (spec §13.1).
    db.$queryRaw<Array<{ companyId: string; costSatang: bigint }>>`
      SELECT "companyId", SUM("costSatang")::bigint AS "costSatang" FROM "AiUsageEvent" WHERE "monthKey" = ${month} AND "createdAt" < ${asOf} GROUP BY "companyId"`,
    db.executiveCompanyMonth.findMany({ where: { month, definitionVersion: { lte: definitionVersion } }, orderBy: { definitionVersion: 'desc' } }),
    db.executiveReportMonth.findUnique({ where: { month_definitionVersion: { month, definitionVersion } } }),
  ]);
  // The row of this version, or failing that the newest older version: its counters are the floor of the recount.
  const stored = new Map<string, ExecutiveCompanyMonth>();
  for (const row of storedRows) if (!stored.has(row.companyId)) stored.set(row.companyId, row);
  return { activity, receipts, aiCost, stored, storedHeader };
}

function pickCounters(row: ActivityRow): Partial<UsageCounters> {
  return Object.fromEntries(USAGE_COUNTERS.filter((key) => key in row).map((key) => [key, row[key as keyof ActivityRow] as number]));
}
function storedFigures(row: ExecutiveCompanyMonth): CompanyMonthFigures {
  return { ...row, moneyByPurchaseKind: (row.moneyByPurchaseKind ?? {}) as MoneyByKind };
}
