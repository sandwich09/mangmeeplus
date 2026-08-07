import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { ReconciliationKind, ReconciliationStatus } from '@watchdog-bms/contracts';

const MAX_PAGE_SIZE = 200;

export type ListItemsQuery = {
  status?: ReconciliationStatus;
  kind?: ReconciliationKind;
  companyId?: string;
  cursor?: string;
  pageSize?: number;
};

/**
 * Reads for the operator running the reconciliation window. Cursor paging rather than
 * offset/limit: the operator resolves items while paging through them, and an offset page
 * silently skips rows as the set shrinks underneath it.
 */
@Injectable()
export class ReadIdentityReconciliationUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async listItems(query: ListItemsQuery) {
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), MAX_PAGE_SIZE);
    const rows = await this.prisma.client.companyIdentityReconciliationItem.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        companyId: true,
        kind: true,
        discriminator: true,
        sourceState: true,
        status: true,
        sourceFingerprint: true,
        payloadMaskedJson: true,
        resolvedAt: true,
        createdAt: true,
      },
    });

    const page = rows.slice(0, pageSize);
    // TAX_ID items carry the company's identity version so an operator can hand it straight to
    // repair-tax-id as the compare-and-set token without a second round trip (§16).
    const taxIdCompanyIds = [...new Set(page.filter((row) => row.kind === 'TAX_ID').map((row) => row.companyId))];
    const versions = taxIdCompanyIds.length
      ? await this.prisma.client.company.findMany({
          where: { id: { in: taxIdCompanyIds } },
          select: { id: true, legalIdentityVersion: true },
        })
      : [];
    const versionById = new Map(versions.map((row) => [row.id, row.legalIdentityVersion]));

    return {
      items: page.map((row) => ({
        ...row,
        legalIdentityVersion: row.kind === 'TAX_ID' ? versionById.get(row.companyId) ?? null : null,
      })),
      nextCursor: rows.length > pageSize ? page[page.length - 1]?.id ?? null : null,
    };
  }

  /**
   * Reports 2 and 5 (§17). The other four need readiness and issue-observation data that
   * arrives with the endpoint and issue-flow work, and a report that answers with a partial
   * picture is worse than one that is not there yet.
   */
  async report(reportKey: string, companyId?: string) {
    if (reportKey === 'reconciliation-status') return this.reconciliationStatusReport(companyId);
    if (reportKey === 'identity-captures') return this.identityCapturesReport(companyId);
    throw new UnprocessableEntityException(
      `unknown report ${reportKey}; available: reconciliation-status, identity-captures`,
    );
  }

  /** Report 2: pending/resolved per company and kind, masked payloads only. */
  private async reconciliationStatusReport(companyId?: string) {
    const grouped = await this.prisma.client.companyIdentityReconciliationItem.groupBy({
      by: ['companyId', 'kind', 'status'],
      where: companyId ? { companyId } : {},
      _count: { _all: true },
    });
    return {
      reportKey: 'reconciliation-status',
      rows: grouped.map((row) => ({
        companyId: row.companyId,
        kind: row.kind,
        status: row.status,
        count: row._count._all,
      })),
      totalPending: grouped.filter((row) => row.status === 'PENDING').reduce((sum, row) => sum + row._count._all, 0),
    };
  }

  /**
   * Report 5: every INITIAL_CAPTURE and CORRECTION revision. The capture window is the one
   * stretch where a company can rewrite its own identity without creating a fence — this is
   * what stops that being an unwatched hole.
   */
  private async identityCapturesReport(companyId?: string) {
    const revisions = await this.prisma.client.companyLegalIdentityRevision.findMany({
      where: {
        changeKind: { in: ['INITIAL_CAPTURE', 'CORRECTION'] },
        ...(companyId ? { companyId } : {}),
      },
      orderBy: [{ companyId: 'asc' }, { legalIdentityVersion: 'asc' }],
      take: 1000,
      select: {
        companyId: true,
        legalIdentityVersion: true,
        changeKind: true,
        correctionReason: true,
        note: true,
        actorUserId: true,
        createdAt: true,
      },
    });
    return { reportKey: 'identity-captures', rows: revisions, truncated: revisions.length === 1000 };
  }
}
