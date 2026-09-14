import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { civilDateToUtcDate, isCivilDate, type CivilDate } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import { findBranchDuplicates, maskTaxId } from '../../../data-model-core/domain/logic/identity-reconciliation.logic';
import { canLeaveActiveBranch } from '../../../data-model-core/domain/logic/branch.logic';
import { assertNoInFlightReimbursements } from '../../../reimbursements/application/branch-in-flight';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type ResolveTaxIdCommand = {
  commandId: string;
  expectedSourceFingerprint: string;
  chosen: 'COMPANY' | 'PROFILE' | 'MANUAL';
  manualValue?: string;
  resolutionKind: 'LEGAL_CHANGE' | 'DATA_RECONCILIATION';
  effectiveFrom?: CivilDate;
  note: string;
  evidenceRef?: string;
};

export type ResolveBranchDuplicateCommand = {
  commandId: string;
  expectedSourceFingerprint: string;
  action: 'ARCHIVE' | 'EDIT_CODE';
  targetBranchId: string;
  newCode?: string;
};

export type ResolveVatHintCommand = {
  commandId: string;
  expectedSourceFingerprint: string;
  action: 'CONFIRM_FACT' | 'DISMISS_UNKNOWN';
  effectiveFrom?: CivilDate;
  evidenceRef?: string;
};

export type RepairTaxIdCommand = {
  commandId: string;
  manualValue: string;
  note: string;
  evidenceRef?: string;
  expectedLegalIdentityVersion: number;
};

export type ResolveResult = { itemId: string; status: 'RESOLVED'; replayed: boolean };

/**
 * The only route that may change a company's legal tax identity, VAT facts or branch codes from
 * outside the tenant (spec §16). Guarded by system.identity_reconciliation.resolve — CRITICAL,
 * because the holder rewrites those values for ANY company.
 *
 * Every command shares one shape: lock the company, look the command up BEFORE the compare-and-
 * set, verify the source has not moved under it, mutate, close the item, audit — all in one
 * transaction. Lookup before CAS is what makes a retry after a lost response return the original
 * answer instead of a conflict against work the caller already caused.
 */
@Injectable()
export class ResolveIdentityReconciliationUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolveTaxId(ctx: RequestContext, itemId: string, command: ResolveTaxIdCommand): Promise<ResolveResult> {
    if (command.resolutionKind === 'LEGAL_CHANGE' && !isCivilDate(command.effectiveFrom ?? '')) {
      throw new UnprocessableEntityException('effectiveFrom (YYYY-MM-DD) is required for a legal change');
    }
    if (command.chosen === 'MANUAL' && !/^\d{13}$/.test(command.manualValue ?? '')) {
      throw new UnprocessableEntityException('manualValue must be 13 digits');
    }
    if (!command.note?.trim()) throw new UnprocessableEntityException('note is required');

    return this.prisma.client.$transaction(async (tx) => {
      const item = await this.lockAndLoadItem(tx, itemId, 'TAX_ID');
      const replay = this.replayOrConflict(item, command.commandId);
      if (replay) return replay;
      this.assertSourceUnchanged(item, command.expectedSourceFingerprint);

      const company = await tx.company.findUniqueOrThrow({
        where: { id: item.companyId },
        select: { id: true, taxId: true, registeredName: true, addressJson: true, legalIdentityVersion: true },
      });
      const profile = await tx.companyTaxProfile.findUnique({
        where: { companyId: item.companyId },
        select: { taxId: true },
      });

      const winner =
        command.chosen === 'COMPANY' ? company.taxId : command.chosen === 'PROFILE' ? profile?.taxId ?? null : command.manualValue!;
      if (!winner) throw new UnprocessableEntityException(`the ${command.chosen} side has no tax id to choose`);

      const nextVersion = company.legalIdentityVersion + 1;
      await tx.company.update({
        where: { id: item.companyId },
        data: {
          taxId: winner,
          legalIdentityVersion: nextVersion,
          // A legal change moves the fence date. A data reconciliation deliberately does NOT:
          // the number never changed in law, only the record of it, and fencing every earlier
          // document behind a typo fix would block reissuing documents that were always correct.
          ...(command.resolutionKind === 'LEGAL_CHANGE'
            ? { lastLegalChangeEffectiveDate: civilDateToUtcDate(command.effectiveFrom!) }
            : {}),
        },
      });
      // Documented legacy mirror, Release A through B1 only: WHT certificates still read the
      // profile first, so leaving it behind would hand an auditor two different numbers.
      await tx.companyTaxProfile.upsert({
        where: { companyId: item.companyId },
        create: { companyId: item.companyId, taxId: winner, updatedByUserId: ctx.userId },
        update: { taxId: winner, updatedByUserId: ctx.userId },
      });

      await tx.companyLegalIdentityRevision.create({
        data: {
          companyId: item.companyId,
          legalIdentityVersion: nextVersion,
          snapshotJson: {
            taxId: winner,
            registeredName: company.registeredName,
            addressJson: company.addressJson ?? null,
          },
          changeKind: command.resolutionKind === 'LEGAL_CHANGE' ? 'LEGAL_CHANGE' : 'RECONCILIATION_CORRECTION',
          effectiveFrom: command.resolutionKind === 'LEGAL_CHANGE' ? civilDateToUtcDate(command.effectiveFrom!) : null,
          reconciliationItemId: item.id,
          note: command.note,
          evidenceRef: command.evidenceRef ?? null,
          actorUserId: ctx.userId,
        },
      });

      await this.closeItem(tx, item.id, command.commandId, {
        chosen: command.chosen,
        resolutionKind: command.resolutionKind,
        winnerLast4: maskTaxId(winner),
      }, ctx.userId);

      await this.auditResolve(ctx, item, 'resolveTaxId', {
        chosen: command.chosen,
        resolutionKind: command.resolutionKind,
        winnerLast4: maskTaxId(winner),
      }, tx);

      // Postcondition: both sides now read the winner. Asserted rather than assumed because the
      // whole point of this command is that they disagreed.
      const [after, afterProfile] = await Promise.all([
        tx.company.findUniqueOrThrow({ where: { id: item.companyId }, select: { taxId: true } }),
        tx.companyTaxProfile.findUnique({ where: { companyId: item.companyId }, select: { taxId: true } }),
      ]);
      if (after.taxId !== winner || afterProfile?.taxId !== winner) {
        throw new ConflictException('postcondition failed: company and profile tax id still disagree');
      }

      return { itemId: item.id, status: 'RESOLVED' as const, replayed: false };
    });
  }

  async resolveBranchDuplicate(
    ctx: RequestContext,
    itemId: string,
    command: ResolveBranchDuplicateCommand,
  ): Promise<ResolveResult> {
    if (command.action === 'EDIT_CODE' && !/^\d{5}$/.test(command.newCode ?? '')) {
      throw new UnprocessableEntityException('newCode must be 5 digits');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const item = await this.lockAndLoadItem(tx, itemId, 'BRANCH_DUP');
      const replay = this.replayOrConflict(item, command.commandId);
      if (replay) return replay;
      await lockPlanTermCompany(tx, item.companyId);
      this.assertSourceUnchanged(item, command.expectedSourceFingerprint);
      const branches = await tx.branch.findMany({ where: { companyId: item.companyId }, select: { id: true, type: true, status: true, taxBranchCode: true } });
      const source = findBranchDuplicates(branches).find(finding => finding.discriminator === item.discriminator);
      if (!source || source.sourceFingerprint !== item.sourceFingerprint) throw new ConflictException('Branch source changed; regenerate and review the item.');

      const target = await tx.branch.findFirst({
        where: { id: command.targetBranchId, companyId: item.companyId },
        select: { id: true, taxBranchCode: true, type: true, status: true },
      });
      if (!target) throw new NotFoundException(`Branch ${command.targetBranchId} not found in this company`);
      if (target.status !== 'ACTIVE' || (item.discriminator.startsWith('__') ? target.type !== 'HEAD_OFFICE' : target.taxBranchCode !== item.discriminator))
        throw new ConflictException('Target is not part of this active duplicate identity.');

      if (command.action === 'ARCHIVE') {
        const active = branches.filter(branch => branch.status === 'ACTIVE');
        const refusal = canLeaveActiveBranch(target, active.filter(branch => branch.type === 'HEAD_OFFICE').length, active.length);
        if (refusal) throw new UnprocessableEntityException(refusal);
        await assertNoInFlightReimbursements({ client: tx }, item.companyId, target.id);
        await tx.branch.update({ where: { id: target.id }, data: { status: 'ARCHIVED', updatedByUserId: ctx.userId } });
      } else {
        if (branches.some(branch => branch.id !== target.id && branch.status === 'ACTIVE' && branch.taxBranchCode === command.newCode))
          throw new ConflictException('The replacement tax branch code already belongs to an active branch.');
        await tx.branch.update({
          where: { id: target.id },
          data: { taxBranchCode: command.newCode!, isVatEstablishment: true, updatedByUserId: ctx.userId },
        });
      }

      // Postcondition: the duplicate this item named is gone. A resolver that reported success
      // while the Release B1 constraint would still fail is worse than one that refuses.
      const remaining = await this.countDuplicates(tx, item.companyId, item.discriminator);
      if (remaining > 1) {
        throw new ConflictException(`postcondition failed: ${remaining} active branches still share this identity`);
      }

      await this.closeItem(tx, item.id, command.commandId, { action: command.action, targetBranchId: target.id }, ctx.userId);
      await this.auditResolve(ctx, item, 'resolveBranchDuplicate', { action: command.action, targetBranchId: target.id }, tx);
      return { itemId: item.id, status: 'RESOLVED' as const, replayed: false };
    });
  }

  async resolveVatHint(ctx: RequestContext, itemId: string, command: ResolveVatHintCommand): Promise<ResolveResult> {
    if (command.action === 'CONFIRM_FACT' && !isCivilDate(command.effectiveFrom ?? '')) {
      throw new UnprocessableEntityException('effectiveFrom (YYYY-MM-DD) is required to confirm a fact');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const item = await this.lockAndLoadItem(tx, itemId, 'VAT_HINT');
      const replay = this.replayOrConflict(item, command.commandId);
      if (replay) return replay;
      this.assertSourceUnchanged(item, command.expectedSourceFingerprint);

      if (command.action === 'CONFIRM_FACT') {
        const state = await tx.companyVatRegistrationState.findUnique({ where: { companyId: item.companyId } });
        const nextVersion = (state?.version ?? 0) + 1;
        const fact = await tx.companyVatRegistrationFact.create({
          data: {
            companyId: item.companyId,
            status: 'REGISTERED',
            effectiveFrom: civilDateToUtcDate(command.effectiveFrom!),
            source: 'RECONCILIATION',
            evidenceRef: command.evidenceRef ?? null,
            actorId: ctx.userId,
          },
        });
        await tx.companyVatRegistrationState.upsert({
          where: { companyId: item.companyId },
          create: { companyId: item.companyId, version: nextVersion },
          update: { version: nextVersion },
        });
        await tx.companyVatRegistrationCommand.create({
          data: {
            companyId: item.companyId,
            commandId: command.commandId,
            payloadFingerprint: canonicalFingerprint({
              companyId: item.companyId,
              itemId: item.id,
              action: command.action,
              effectiveFrom: command.effectiveFrom ?? null,
              evidenceRef: command.evidenceRef ?? null,
            }),
            expectedStateVersion: state?.version ?? 0,
            resultStateVersion: nextVersion,
            resultFactId: fact.id,
            resultKind: 'RECONCILIATION_CONFIRM',
            actorUserId: ctx.userId,
          },
        });
        // Mirror maintained at write time (§5.2). The fact is open-ended from a past date, so
        // today reads REGISTERED; a future-dated confirmation is not reachable from this route.
        await tx.company.update({ where: { id: item.companyId }, data: { vatRegistered: true } });
      }
      // DISMISS_UNKNOWN writes nothing. The hint was unusable and the status stays UNKNOWN —
      // recording "not registered" here would invent the very answer the hint failed to supply.

      await this.closeItem(tx, item.id, command.commandId, { action: command.action }, ctx.userId);
      await this.auditResolve(ctx, item, 'resolveVatHint', { action: command.action }, tx);
      return { itemId: item.id, status: 'RESOLVED' as const, replayed: false };
    });
  }

  /**
   * The post-B2 repair route (§4.6). Once the reconciliation lane is retired there are no items
   * left, but a typo in a tax id still has to be fixable — and after the capture window closes
   * and the latch sets, the only other option is LEGAL_CHANGE, which would fence every document
   * issued before it for a number that never changed in law.
   */
  async repairTaxId(ctx: RequestContext, companyId: string, command: RepairTaxIdCommand): Promise<{ legalIdentityVersion: number; replayed: boolean }> {
    if (!/^\d{13}$/.test(command.manualValue)) throw new UnprocessableEntityException('manualValue must be 13 digits');
    if (!command.note?.trim()) throw new UnprocessableEntityException('note is required');

    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:identity-reconciliation`}))`;

      // Replay is keyed on the repair command itself, enforced by a unique index rather than by
      // this read alone — two concurrent retries must not both append a revision.
      const existing = await tx.companyLegalIdentityRevision.findFirst({
        where: { companyId, repairCommandId: command.commandId },
        select: { legalIdentityVersion: true },
      });
      if (existing) return { legalIdentityVersion: existing.legalIdentityVersion, replayed: true };

      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { taxId: true, registeredName: true, addressJson: true, legalIdentityVersion: true },
      });
      if (company.legalIdentityVersion !== command.expectedLegalIdentityVersion) {
        throw new ConflictException('legalIdentityVersion is stale');
      }

      const nextVersion = company.legalIdentityVersion + 1;
      await tx.company.update({
        where: { id: companyId },
        data: { taxId: command.manualValue, legalIdentityVersion: nextVersion },
      });
      await tx.companyLegalIdentityRevision.create({
        data: {
          companyId,
          legalIdentityVersion: nextVersion,
          snapshotJson: {
            taxId: command.manualValue,
            registeredName: company.registeredName,
            addressJson: company.addressJson ?? null,
          },
          changeKind: 'RECONCILIATION_CORRECTION',
          repairCommandId: command.commandId,
          note: command.note,
          evidenceRef: command.evidenceRef ?? null,
          actorUserId: ctx.userId,
        },
      });
      await this.audit.log(
        {
          companyId,
          actorUserId: ctx.userId,
          action: 'system.identity_reconciliation.repair_tax_id',
          targetType: 'company',
          targetId: companyId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { subjectLast4Prev: maskTaxId(company.taxId), subjectLast4Next: maskTaxId(command.manualValue) },
        },
        tx,
      );

      return { legalIdentityVersion: nextVersion, replayed: false };
    });
  }

  // ── shared ────────────────────────────────────────────────────────────────

  private async lockAndLoadItem(tx: any, itemId: string, expectedKind: string) {
    const item = await tx.companyIdentityReconciliationItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Reconciliation item ${itemId} not found`);
    if (item.kind !== expectedKind) {
      throw new UnprocessableEntityException(`item ${itemId} is a ${item.kind} item, not ${expectedKind}`);
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${item.companyId}:identity-reconciliation`}))`;
    // Re-read under the lock: the row that mattered is the one nobody else is holding.
    return tx.companyIdentityReconciliationItem.findUniqueOrThrow({ where: { id: itemId } });
  }

  /** Same command on a closed item is the original answer; a different one is a conflict. */
  private replayOrConflict(item: { id: string; status: string; resolutionCommandId: string | null }, commandId: string): ResolveResult | null {
    if (item.status !== 'RESOLVED') return null;
    if (item.resolutionCommandId === commandId) return { itemId: item.id, status: 'RESOLVED', replayed: true };
    throw new ConflictException('this reconciliation item was already resolved by a different command');
  }

  private assertSourceUnchanged(item: { sourceFingerprint: string }, expected: string): void {
    if (item.sourceFingerprint !== expected) {
      throw new ConflictException('the underlying data changed since this item was generated; regenerate and retry');
    }
  }

  private async closeItem(
    tx: any,
    itemId: string,
    commandId: string,
    resolutionJson: Record<string, unknown>,
    userId: string | null,
  ): Promise<void> {
    await tx.companyIdentityReconciliationItem.update({
      where: { id: itemId },
      data: {
        status: 'RESOLVED',
        resolutionCommandId: commandId,
        resolutionJson,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
  }

  private async countDuplicates(tx: any, companyId: string, discriminator: string): Promise<number> {
    if (discriminator.startsWith('__')) {
      return tx.branch.count({ where: { companyId, status: 'ACTIVE', type: 'HEAD_OFFICE' } });
    }
    return tx.branch.count({ where: { companyId, status: 'ACTIVE', taxBranchCode: discriminator } });
  }

  private async auditResolve(
    ctx: RequestContext,
    item: { id: string; companyId: string; kind: string },
    action: string,
    metadata: Record<string, unknown>,
    tx: any,
  ): Promise<void> {
    await this.audit.log(
      {
        companyId: item.companyId,
        actorUserId: ctx.userId,
        action: `system.identity_reconciliation.${action}`,
        targetType: 'company_identity_reconciliation_item',
        targetId: item.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'CRITICAL',
        metadataJson: { kind: item.kind, itemId: item.id, ...metadata },
      },
      tx,
    );
  }
}
