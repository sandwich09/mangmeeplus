import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { assertFeatureEnabled, evaluateEntitledFeatureKeys, loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { sharedEntitlementLock } from '../../feature-launch/application/execution-attempt.service';

const REPORTS_FEATURE_KEY = 'reports';

export type ReportEntitlementStamp = {
  present: boolean;
  epoch: number | null;
  lastSeq: number | null;
};

type EntitlementRow = {
  featureKey: string;
  enabled: boolean;
  epoch: number | null;
  lastSeq: number | null;
};

function reportStamp(rows: readonly EntitlementRow[]): ReportEntitlementStamp {
  const row = rows.find((candidate) => candidate.featureKey === REPORTS_FEATURE_KEY);
  return row
    ? { present: true, epoch: row.epoch, lastSeq: row.lastSeq }
    : { present: false, epoch: null, lastSeq: null };
}

function sameStamp(left: ReportEntitlementStamp, right: ReportEntitlementStamp): boolean {
  return left.present === right.present && left.epoch === right.epoch && left.lastSeq === right.lastSeq;
}

@Injectable()
export class ReportEntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(companyId: string): Promise<boolean> {
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    return entitled === null || entitled.has(REPORTS_FEATURE_KEY);
  }

  async assertEnabled(companyId: string): Promise<ReportEntitlementStamp> {
    const rows = await this.prisma.client.companyFeatureEntitlement.findMany({
      where: { companyId },
      select: { featureKey: true, enabled: true, epoch: true, lastSeq: true },
    });
    assertFeatureEnabled(evaluateEntitledFeatureKeys(rows), REPORTS_FEATURE_KEY);
    return reportStamp(rows);
  }

  /** Serializes the final root write against OFF and rejects work from a pre-OFF generation. */
  async withEnabledFence<T>(
    companyId: string,
    expected: ReportEntitlementStamp,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(sharedEntitlementLock(companyId));
      const rows = await tx.companyFeatureEntitlement.findMany({
        where: { companyId },
        select: { featureKey: true, enabled: true, epoch: true, lastSeq: true },
      });
      assertFeatureEnabled(evaluateEntitledFeatureKeys(rows), REPORTS_FEATURE_KEY);
      if (!sameStamp(expected, reportStamp(rows))) {
        throw new ConflictException({
          code: 'report_entitlement_changed',
          featureKey: REPORTS_FEATURE_KEY,
          message: 'Report availability changed while this request was running. Please try again.',
        });
      }
      return write(tx);
    });
  }
}
