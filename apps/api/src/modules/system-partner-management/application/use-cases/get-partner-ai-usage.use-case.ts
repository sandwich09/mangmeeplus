import { Injectable, NotFoundException } from '@nestjs/common';
import type { PartnerAiUsageDto, PartnerAiUsageMonthDto, PartnerOcrUsageMonthDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { Prisma } from '../../../../generated/prisma/client';
import { partnerAiAdjustmentHistory } from '../partner-ai-adjustment-history';
import {
  bangkokMonthKey,
  previousBangkokMonthKey,
  resolvePlatformAiBudget,
} from '../../../line-ai/application/company-ai-usage-meter';

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
        },
      });
      const tagGroups = await tx.aiUsageEvent.groupBy({
        by: ['usageTag'],
        where: { companyId, monthKey },
        _sum: { costSatang: true },
        _count: { _all: true },
        orderBy: { _sum: { costSatang: 'desc' } },
        take: 10,
      });
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
      return { company, months, configuration, tagGroups, platform, ocrMonths, ocrSources, currentUploads, previousUploads };
    }, {
      isolationLevel: 'RepeatableRead',
      maxWait: 5_000,
      timeout: 15_000,
    });

    const { company, months, configuration, tagGroups, platform, ocrMonths, ocrSources, currentUploads, previousUploads } = reads;

    if (!company) throw new NotFoundException(`Partner company "${companyId}" not found.`);

    const overrideSatang = configuration?.monthlyBudgetSatang ?? null;
    const defaultSatang = platform.monthlyBudgetSatang;
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
      },
      topTags: tagGroups.map((group) => ({
        tag: group.usageTag,
        costSatang: group._sum.costSatang ?? 0,
        calls: group._count._all,
      })),
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
