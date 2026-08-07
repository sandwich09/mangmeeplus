import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import {
  generateFindings,
  type ReconciliationFinding,
} from '../../../data-model-core/domain/logic/identity-reconciliation.logic';

export type GenerateReconciliationResult = {
  companyId: string;
  created: number;
  updated: number;
  closed: number;
  pending: number;
};

/**
 * The generator, as an OPERATIONAL COMMAND — not a migration step (spec §4.6).
 *
 * Two properties it must keep, and the reasons:
 *  - It never writes Company, CompanyTaxProfile, a branch or a revision. Every domain mutation
 *    goes through a resolver command with its own compare-and-set, revision and CRITICAL audit,
 *    so a change to a company's legal tax identity always has a named human behind it.
 *  - It is re-runnable. Operators run it, resolve what it finds, and run it again until nothing
 *    is pending; a generator that duplicated its own findings would never reach zero.
 */
@Injectable()
export class GenerateIdentityReconciliationUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string): Promise<GenerateReconciliationResult> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true, taxId: true, vatRegistered: true },
    });
    if (!company) throw new NotFoundException(`Company ${companyId} not found`);

    const [profile, branches, liveFactCount] = await Promise.all([
      this.prisma.client.companyTaxProfile.findUnique({
        where: { companyId },
        select: { taxId: true, vatRegistered: true, vatEffectiveDate: true },
      }),
      this.prisma.client.branch.findMany({
        where: { companyId },
        select: { id: true, type: true, status: true, taxBranchCode: true },
      }),
      this.prisma.client.companyVatRegistrationFact.count({ where: { companyId, supersededAt: null } }),
    ]);

    const findings = generateFindings({
      companyTaxId: company.taxId,
      profileTaxId: profile?.taxId ?? null,
      companyVatRegistered: company.vatRegistered,
      profileVatRegistered: profile?.vatRegistered ?? false,
      profileVatEffectiveDate: profile?.vatEffectiveDate ?? null,
      hasLiveVatFact: liveFactCount > 0,
      branches,
    });

    return this.persist(companyId, findings);
  }

  private async persist(companyId: string, findings: ReconciliationFinding[]): Promise<GenerateReconciliationResult> {
    return this.prisma.client.$transaction(async (tx) => {
      // One generator at a time per company. The identity of a pending item is a PARTIAL unique
      // index, which Prisma cannot express as an upsert target, so the read-decide-write below
      // has to be serialized rather than left to a constraint retry.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:identity-reconciliation`}))`;

      const open = await tx.companyIdentityReconciliationItem.findMany({
        where: { companyId, status: 'PENDING' },
        select: { id: true, kind: true, discriminator: true, sourceFingerprint: true },
      });
      const keyOf = (item: { kind: string; discriminator: string }) => `${item.kind}::${item.discriminator}`;
      const openByKey = new Map(open.map((item) => [keyOf(item), item]));

      let created = 0;
      let updated = 0;
      for (const finding of findings) {
        const existing = openByKey.get(keyOf(finding));
        if (!existing) {
          // No open row: create one even if a RESOLVED row exists for the same key. Reopening
          // the resolved row instead would overwrite the record of a decision somebody made.
          await tx.companyIdentityReconciliationItem.create({
            data: {
              companyId,
              kind: finding.kind,
              discriminator: finding.discriminator,
              sourceState: finding.sourceState,
              sourceFingerprint: finding.sourceFingerprint,
              payloadMaskedJson: finding.payloadMaskedJson as Prisma.InputJsonValue,
            },
          });
          created += 1;
          continue;
        }
        if (existing.sourceFingerprint !== finding.sourceFingerprint) {
          await tx.companyIdentityReconciliationItem.update({
            where: { id: existing.id },
            data: {
              sourceState: finding.sourceState,
              sourceFingerprint: finding.sourceFingerprint,
              payloadMaskedJson: finding.payloadMaskedJson as Prisma.InputJsonValue,
            },
          });
          updated += 1;
        }
      }

      // Drift that disappeared closes its own item. Without this the ops window could never
      // reach "pending = 0" for anything fixed outside the resolver — and pending = 0 is the
      // precondition the Release B1 constraints are gated on.
      const stillFound = new Set(findings.map(keyOf));
      const vanished = open.filter((item) => !stillFound.has(keyOf(item)));
      for (const item of vanished) {
        await tx.companyIdentityReconciliationItem.update({
          where: { id: item.id },
          data: {
            status: 'RESOLVED',
            sourceState: 'ALIGNED',
            resolvedAt: new Date(),
            resolutionJson: { resolvedBy: 'GENERATOR_ALIGNED' },
          },
        });
      }

      return {
        companyId,
        created,
        updated,
        closed: vanished.length,
        pending: findings.length,
      };
    });
  }
}
