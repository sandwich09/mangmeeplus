import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PartnerAiBudgetBucket,
  PartnerAiRequestKind,
  PartnerAiUsageBasis,
  PartnerAiUsageBreakdownDto,
  PartnerAiUsageDto,
  PartnerAiUsageMeasuresDto,
  PartnerAiUsageMonthDto,
  PartnerOcrUsageMonthDto,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { Prisma } from '../../../../generated/prisma/client';
import { partnerAiAdjustmentHistory } from '../partner-ai-adjustment-history';
import {
  bangkokMonthKey,
  previousBangkokMonthKey,
  resolvePlatformAiBudget,
} from '../../../line-ai/application/company-ai-usage-meter';
import { resolveAiBudgetPolicy, toPartnerAiBudgetPolicyDto } from '../../../line-ai/application/company-ai-budget-policy';
import { readAiBudgetMonthSnapshot } from '../../../line-ai/application/company-ai-budget-reservation';

const MONTH_SELECT = {
  monthKey: true,
  costSatang: true,
  callCount: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadInputTokens: true,
  cacheWriteInputTokens: true,
} as const;

const OCR_SOURCE_ROUTES = ['receipt-ocr-web', 'receipt-ocr-line', 'bank-statement-extract'] as const;
const RECEIPT_UPLOAD_PURPOSES = ['expense.receipt.primary', 'expense.receipt.supporting'] as const;

const REQUEST_KINDS: PartnerAiRequestKind[] = ['TEXT', 'IMAGE', 'OTHER', 'UNKNOWN'];
const BUDGET_BUCKETS: PartnerAiBudgetBucket[] = ['CHAT', 'OCR', 'UNKNOWN'];
// `OPERATOR_CHARGED_AT_BOUND` (hold spec §4.2) rides the SAME fold as the two provider bases, and
// its rows are `COST_ADJUSTMENT`, so `addRow` already keeps them out of `calls` and `coverage`
// while their cost still reconciles with `total` (J-07). UNKNOWN stays LAST: `foldBy` folds an
// unrecognised stored value into the final key.
const USAGE_BASES: PartnerAiUsageBasis[] = ['PROVIDER_REPORTED', 'CONSERVATIVE_ESTIMATE', 'OPERATOR_CHARGED_AT_BOUND', 'UNKNOWN'];
const TOP_TAG_LIMIT = 10;

/**
 * One grouped row of the current month's event ledger. Grouping on the four metadata columns plus
 * the tag keeps the result set tiny (tags × a handful of metadata combinations) while letting every
 * breakdown be folded from the SAME rows — so the slices cannot drift apart or double count.
 */
type AiUsageBreakdownRow = {
  usageTag: string;
  requestKind: string | null;
  budgetBucket: string | null;
  usageBasis: string | null;
  eventKind: string;
  rows: number;
  costSatang: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  /** NULL when no row in the group carries a pricing snapshot — UNAVAILABLE, not zero. */
  cacheReadSatang: number | null;
  cacheWriteSatang: number | null;
  firstAt: Date;
};

type MeasureAccumulator = Omit<PartnerAiUsageMeasuresDto, 'cacheCostSatang'>
  & { cacheReadSatang: number | null; cacheWriteSatang: number | null };

const emptyMeasures = (): MeasureAccumulator => ({
  costSatang: 0, calls: 0, inputTokens: 0, outputTokens: 0,
  cacheReadInputTokens: 0, cacheWriteInputTokens: 0, cacheReadSatang: null, cacheWriteSatang: null,
});

function addRow(acc: MeasureAccumulator, row: AiUsageBreakdownRow): MeasureAccumulator {
  acc.costSatang += row.costSatang;
  // A COST_ADJUSTMENT moves money and counters but is not a provider call (spec §11.2).
  if (row.eventKind === 'MODEL_CALL') acc.calls += row.rows;
  acc.inputTokens += row.inputTokens;
  acc.outputTokens += row.outputTokens;
  acc.cacheReadInputTokens += row.cacheReadInputTokens;
  acc.cacheWriteInputTokens += row.cacheWriteInputTokens;
  if (row.cacheReadSatang !== null) acc.cacheReadSatang = (acc.cacheReadSatang ?? 0) + row.cacheReadSatang;
  if (row.cacheWriteSatang !== null) acc.cacheWriteSatang = (acc.cacheWriteSatang ?? 0) + row.cacheWriteSatang;
  return acc;
}

/** Same rules as {@link addRow}, but folding an already-summed slice (the `otherTags` remainder). */
function mergeMeasures(acc: MeasureAccumulator, other: MeasureAccumulator): MeasureAccumulator {
  acc.costSatang += other.costSatang;
  acc.calls += other.calls;
  acc.inputTokens += other.inputTokens;
  acc.outputTokens += other.outputTokens;
  acc.cacheReadInputTokens += other.cacheReadInputTokens;
  acc.cacheWriteInputTokens += other.cacheWriteInputTokens;
  if (other.cacheReadSatang !== null) acc.cacheReadSatang = (acc.cacheReadSatang ?? 0) + other.cacheReadSatang;
  if (other.cacheWriteSatang !== null) acc.cacheWriteSatang = (acc.cacheWriteSatang ?? 0) + other.cacheWriteSatang;
  return acc;
}

function toMeasures(acc: MeasureAccumulator): PartnerAiUsageMeasuresDto {
  const { cacheReadSatang, cacheWriteSatang, ...rest } = acc;
  return {
    ...rest,
    cacheCostSatang: cacheReadSatang === null && cacheWriteSatang === null
      ? null
      : { read: cacheReadSatang ?? 0, write: cacheWriteSatang ?? 0 },
  };
}

/**
 * Folds one slice from the row set, always emitting the full key list so UNKNOWN is never dropped
 * and the slice reconciles with the total. A stored value outside `keys` (which the column CHECK
 * constraints already prevent) folds into the last key — UNKNOWN — rather than disappearing.
 */
function foldBy<K extends string>(
  rows: AiUsageBreakdownRow[],
  keys: K[],
  column: (row: AiUsageBreakdownRow) => string | null,
): Array<{ key: K } & PartnerAiUsageMeasuresDto> {
  const unknown = keys[keys.length - 1]!;
  const buckets = new Map<K, MeasureAccumulator>(keys.map((key) => [key, emptyMeasures()]));
  for (const row of rows) {
    const value = column(row) as K | null;
    addRow(buckets.get(value !== null && buckets.has(value) ? value : unknown)!, row);
  }
  return keys.map((key) => ({ key, ...toMeasures(buckets.get(key)!) }));
}

/** Everything the console shows about the current month, derived from the event rows alone. */
export function buildAiUsageBreakdown(monthKey: string, rows: AiUsageBreakdownRow[]): {
  breakdown: PartnerAiUsageBreakdownDto;
  topTags: PartnerAiUsageDto['topTags'];
  otherTags: PartnerAiUsageDto['otherTags'];
} {
  const tagged = new Map<string, MeasureAccumulator>();
  for (const row of rows) {
    if (!tagged.has(row.usageTag)) tagged.set(row.usageTag, emptyMeasures());
    addRow(tagged.get(row.usageTag)!, row);
  }
  const ranked = [...tagged].sort((a, b) => b[1].costSatang - a[1].costSatang || a[0].localeCompare(b[0]));
  const topTags = ranked.slice(0, TOP_TAG_LIMIT).map(([tag, acc]) => ({ tag, ...toMeasures(acc) }));
  const remainder = ranked.slice(TOP_TAG_LIMIT);
  const otherTags = {
    tags: remainder.length,
    ...toMeasures(remainder.reduce((acc, [, tag]) => mergeMeasures(acc, tag), emptyMeasures())),
  };

  const modelCalls = rows.filter((row) => row.eventKind === 'MODEL_CALL');
  const calls = modelCalls.reduce((sum, row) => sum + row.rows, 0);
  const withMetadata = modelCalls.filter((row) => row.requestKind !== null);
  const callsWithMetadata = withMetadata.reduce((sum, row) => sum + row.rows, 0);
  const firstMetadataAt = withMetadata.reduce<Date | null>(
    (earliest, row) => (earliest === null || row.firstAt < earliest ? row.firstAt : earliest), null);
  const adjustmentRows = rows.filter((row) => row.eventKind === 'COST_ADJUSTMENT');

  return {
    topTags,
    otherTags,
    breakdown: {
      monthKey,
      total: toMeasures(rows.reduce(addRow, emptyMeasures())),
      byRequestKind: foldBy(rows, REQUEST_KINDS, (row) => row.requestKind)
        .map(({ key, ...measures }) => ({ requestKind: key, ...measures })),
      byBudgetBucket: foldBy(rows, BUDGET_BUCKETS, (row) => row.budgetBucket)
        .map(({ key, ...measures }) => ({ budgetBucket: key, ...measures })),
      byUsageBasis: foldBy(rows, USAGE_BASES, (row) => row.usageBasis)
        .map(({ key, ...measures }) => ({ usageBasis: key, ...measures })),
      adjustments: {
        costSatang: adjustmentRows.reduce((sum, row) => sum + row.costSatang, 0),
        rows: adjustmentRows.reduce((sum, row) => sum + row.rows, 0),
      },
      coverage: {
        status: calls === 0 || callsWithMetadata === 0 ? 'none' : callsWithMetadata === calls ? 'complete' : 'partial',
        calls,
        callsWithMetadata,
        firstMetadataAt: firstMetadataAt?.toISOString() ?? null,
      },
    },
  };
}

function bangkokMonthRange(monthKey: string): { gte: Date; lt: Date } {
  const [year, month] = monthKey.split('-').map(Number);
  const bangkokOffsetMs = 7 * 60 * 60 * 1_000;
  return {
    gte: new Date(Date.UTC(year!, month! - 1, 1) - bangkokOffsetMs),
    lt: new Date(Date.UTC(year!, month!, 1) - bangkokOffsetMs),
  };
}

/** Read half of the partner-console AI meter (metering spec §7.7) — system-admin surface only. */
@Injectable()
export class GetPartnerAiUsageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  history(companyId:string, cursor?:string) {
    return this.prisma.client.$transaction(tx => partnerAiAdjustmentHistory(tx, companyId, cursor), {isolationLevel:'RepeatableRead'});
  }

  async execute(companyId: string): Promise<PartnerAiUsageDto> {
    const monthKey = bangkokMonthKey();
    const previousMonthKey = previousBangkokMonthKey();

    const reads = await this.prisma.client.$transaction(async (tx) => {
      // Establish one MVCC snapshot before reading the event-derived breakdown. Without this,
      // a concurrent admission can make aggregate.usedCount and sourceCounts describe different moments.
      const ocrMonths = await tx.companyOcrMonthlyUsage.findMany({
        where: { companyId, monthKey: { in: [monthKey, previousMonthKey] } },
        select: { monthKey: true, usedCount: true },
      });
      const txPrisma = { client: tx } as PrismaService;
      // PrismaPg uses one connection for an interactive transaction; keep these sequential so the
      // adapter never receives overlapping client.query calls while preserving the same snapshot.
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, planTerm: { select: { billingReceiptAccountId: true } } } });
      const months = await tx.companyAiMonthlyUsage.findMany({
        where: { companyId, monthKey: { in: [monthKey, previousMonthKey] } },
        select: MONTH_SELECT,
      });
      const configuration = await tx.companyAiConfiguration.findUnique({
        where: { companyId },
        select: {
          monthlyBudgetSatang: true,
          ocrEnabled: true,
          ocrMonthlyLimit: true,
          receiptQuotaEnforced: true,
          ocrConfigVersion: true,
          updatedAt: true,
          // Split policy (spec §12.5): read inside the SAME RepeatableRead snapshot as the spend
          // it will be shown next to, so the console cannot quote a cap from one moment and the
          // spend from another.
          budgetMode: true,
          chatMonthlyBudgetSatang: true,
          ocrMonthlyBudgetSatang: true,
          budgetConfigVersion: true,
          pendingBudgetPolicy: true,
        },
      });
      // One grouped read feeds tags, kinds, buckets, basis, adjustments and coverage, so every
      // slice reconciles with the same snapshot by construction. Component cost lives inside
      // `pricingSnapshot`, which `groupBy` cannot sum — hence raw SQL (parameters are bound, and
      // the two values are a route parameter and a server-derived month key).
      const breakdownRows = await tx.$queryRaw<AiUsageBreakdownRow[]>`
        SELECT "usageTag", "requestKind", "budgetBucket", "usageBasis", "eventKind",
          COUNT(*)::int AS "rows",
          COALESCE(SUM("costSatang"), 0)::int AS "costSatang",
          COALESCE(SUM("inputTokens"), 0)::int AS "inputTokens",
          COALESCE(SUM("outputTokens"), 0)::int AS "outputTokens",
          COALESCE(SUM("cacheReadInputTokens"), 0)::int AS "cacheReadInputTokens",
          COALESCE(SUM("cacheWriteInputTokens"), 0)::int AS "cacheWriteInputTokens",
          -- A snapshot whose component is not a JSON number contributes NULL instead of aborting
          -- the cast: one malformed row (a future writer, a manual fix) must not take the whole
          -- admin page down. SUM over nothing stays NULL, which is how UNAVAILABLE is reported.
          ROUND(SUM(CASE WHEN jsonb_typeof("pricingSnapshot" #> '{componentSatang,cacheRead}') = 'number'
            THEN ("pricingSnapshot" #>> '{componentSatang,cacheRead}')::numeric END))::int AS "cacheReadSatang",
          ROUND(SUM(CASE WHEN jsonb_typeof("pricingSnapshot" #> '{componentSatang,cacheWrite}') = 'number'
            THEN ("pricingSnapshot" #>> '{componentSatang,cacheWrite}')::numeric END))::int AS "cacheWriteSatang",
          MIN("createdAt") AS "firstAt"
        FROM "AiUsageEvent"
        WHERE "companyId" = ${companyId} AND "monthKey" = ${monthKey}
        GROUP BY "usageTag", "requestKind", "budgetBucket", "usageBasis", "eventKind"
      `;
      // The console must quote what a company actually inherits, which is the platform settings
      // row when one exists — the same value the five enforcement seams compare against.
      const platform = await resolvePlatformAiBudget(txPrisma, this.config, true);
      const ocrSources = await tx.companyOcrUsageEvent.groupBy({
        by: ['monthKey', 'sourceRoute'],
        where: { companyId, monthKey: { in: [monthKey, previousMonthKey] } },
        _count: { _all: true },
      });
      const currentUploads = await this.countUploadedReceipts(tx, companyId, monthKey);
      const previousUploads = await this.countUploadedReceipts(tx, companyId, previousMonthKey);
      // Spend, live holds and the breach flag from the SAME RepeatableRead snapshot as the caps
      // they are shown next to, so the console cannot quote a balance from a different moment.
      const budgetPosition = await readAiBudgetMonthSnapshot(tx, companyId, monthKey);
      return { company, months, configuration, breakdownRows, platform, ocrMonths, ocrSources, currentUploads, previousUploads, budgetPosition };
    }, {
      isolationLevel: 'RepeatableRead',
      maxWait: 5_000,
      timeout: 15_000,
    });

    const { company, months, configuration, breakdownRows, platform, ocrMonths, ocrSources, currentUploads, previousUploads, budgetPosition } = reads;

    if (!company) throw new NotFoundException(`Partner company "${companyId}" not found.`);

    const { breakdown, topTags, otherTags } = buildAiUsageBreakdown(monthKey, breakdownRows ?? []);

    const overrideSatang = configuration?.monthlyBudgetSatang ?? null;
    const defaultSatang = platform.monthlyBudgetSatang;
    const policy = resolveAiBudgetPolicy({
      row: configuration, totalSatang: overrideSatang ?? defaultSatang,
      override: overrideSatang !== null, monthKey,
    });
    // `cap - spent - reserved`, floored at 0. A SHARED bucket has no cap to subtract from, so its
    // `available` is null — "not set", never "unlimited" (spec §12.1).
    const scope = (capSatang: number | null, spentSatang: number, reservedSatang: number) => ({
      spentSatang, reservedSatang,
      availableSatang: capSatang === null ? null : Math.max(0, capSatang - spentSatang - reservedSatang),
    });
    const month = (key: string): PartnerAiUsageMonthDto | null => months.find((m) => m.monthKey === key) ?? null;
    const ocrMonth = (key: string, uploadedReceiptDocumentCount: number): PartnerOcrUsageMonthDto => ({
      monthKey: key,
      usedCount: ocrMonths.find((item) => item.monthKey === key)?.usedCount ?? 0,
      uploadedReceiptDocumentCount,
      sourceCounts: OCR_SOURCE_ROUTES.map((sourceRoute) => ({
        sourceRoute,
        reads: ocrSources.find((item) => item.monthKey === key && item.sourceRoute === sourceRoute)?._count._all ?? 0,
      })),
    });

    return {
      current: month(monthKey),
      previous: month(previousMonthKey),
      budget: {
        effectiveSatang: overrideSatang ?? defaultSatang,
        overrideSatang,
        defaultSatang,
        ceilingSatang: platform.ceilingSatang,
        // The SAME resolver admission uses (spec §12.5) — the console can never describe a policy
        // differently from the gate.
        policy: toPartnerAiBudgetPolicyDto(policy, this.config.aiBudgetSplitActivationEnabled === true),
        position: {
          total: scope(overrideSatang ?? defaultSatang, budgetPosition.spent.TOTAL, budgetPosition.reserved.TOTAL),
          chat: scope(policy.mode === 'SPLIT' ? policy.chatCapSatang : null, budgetPosition.spent.CHAT, budgetPosition.reserved.CHAT),
          ocr: scope(policy.mode === 'SPLIT' ? policy.ocrCapSatang : null, budgetPosition.spent.OCR, budgetPosition.reserved.OCR),
          unresolvedHolds: budgetPosition.unresolvedHolds,
          breach: budgetPosition.breach,
        },
      },
      topTags,
      otherTags,
      breakdown,
      ocr: {
        config: {
          enabled: configuration?.ocrEnabled ?? true,
          monthlyLimit: configuration?.ocrMonthlyLimit ?? null,
          receiptQuotaEnforced: configuration?.receiptQuotaEnforced ?? null,
          version: configuration?.ocrConfigVersion ?? 0,
          updatedAt: configuration?.updatedAt.toISOString() ?? null,
        },
        planQuota: {
          enforced: company.planTerm?.billingReceiptAccountId ? true : (configuration?.receiptQuotaEnforced ?? this.config.receiptQuotaEnforced) === true,
          source: company.planTerm?.billingReceiptAccountId ? 'PAID_GRANTS' : configuration?.receiptQuotaEnforced == null ? 'DEFAULT' : 'COMPANY',
          defaultEnforced: this.config.receiptQuotaEnforced === true,
        },
        current: ocrMonth(monthKey, currentUploads),
        previous: ocrMonth(previousMonthKey, previousUploads),
      },
    };
  }

  private countUploadedReceipts(tx: Prisma.TransactionClient, companyId: string, monthKey: string): Promise<number> {
    const uploadedAt = bangkokMonthRange(monthKey);
    return tx.attachmentObject.count({
      where: {
        companyId,
        status: 'ACTIVE',
        uploadedAt,
        links: {
          some: {
            companyId,
            targetType: 'expense.record',
            purpose: { in: [...RECEIPT_UPLOAD_PURPOSES] },
          },
        },
      },
    });
  }
}
