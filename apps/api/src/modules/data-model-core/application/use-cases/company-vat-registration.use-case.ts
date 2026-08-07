import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  civilDateToUtcDate,
  isCivilDate,
  todayCivilDate,
  utcDateToCivilDate,
  type CivilDate,
  type PutVatRegistrationRequest,
  type VatRegistrationView,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { canonicalFingerprint } from '../../../../common/security/canonical-fingerprint';
import { isPeriodLocked } from '../../../tax/domain/logic/tax-period.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  effectiveVatStatus,
  planVatFactChange,
  type LockedPeriod,
  type VatFactRow,
} from '../../domain/logic/company-vat-registration.logic';

/**
 * VAT registration as CC4 State/Command/Fact (spec §5).
 *
 * The command registry is looked up BEFORE the compare-and-set, not after. A caller whose
 * response was lost retries with the same commandId and gets the original answer; checking the
 * version first would answer 409 against work that caller itself already caused.
 *
 * The payload fingerprint is computed here from the normalized intent and never accepted from a
 * client — otherwise the same commandId could carry a different payload and replay an answer
 * nobody gave.
 */
@Injectable()
export class CompanyVatRegistrationUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string, asOf?: string): Promise<VatRegistrationView> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    if (!company) throw new NotFoundException(`Company ${companyId} not found`);
    if (asOf !== undefined && !isCivilDate(asOf)) {
      throw new UnprocessableEntityException('asOf must be YYYY-MM-DD');
    }

    const [facts, state] = await Promise.all([
      this.loadFacts(this.prisma.client, companyId),
      this.prisma.client.companyVatRegistrationState.findUnique({ where: { companyId } }),
    ]);
    const on = (asOf as CivilDate | undefined) ?? todayCivilDate(company.timezone);
    const status = effectiveVatStatus(facts, on);
    const current = facts.find(
      (fact) => !fact.supersededAt && fact.effectiveFrom <= on && (fact.effectiveTo === null || on < fact.effectiveTo),
    );

    return {
      status,
      ...(current ? { effectiveFrom: current.effectiveFrom } : {}),
      ...(current?.effectiveTo ? { effectiveTo: current.effectiveTo } : {}),
      version: state?.version ?? 0,
      // Deprecated tuple for the pre-CC4 wire. It is a stored bit and may lag; nothing in the
      // runtime reads it to decide anything.
      vatRegistered: status === 'REGISTERED',
      vatEffectiveDate: current?.effectiveFrom ?? null,
    };
  }

  async put(ctx: RequestContext, companyId: string, body: PutVatRegistrationRequest) {
    const fingerprint = this.fingerprintOf(companyId, body);

    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:vat-registration`}))`;

      const prior = await tx.companyVatRegistrationCommand.findFirst({
        where: { companyId, commandId: body.commandId },
        select: { payloadFingerprint: true, resultStateVersion: true, resultKind: true },
      });
      if (prior) {
        if (prior.payloadFingerprint !== fingerprint) {
          throw new ConflictException('this commandId was already used with a different payload');
        }
        return { version: prior.resultStateVersion, resultKind: prior.resultKind, replayed: true };
      }

      const company = await tx.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
      if (!company) throw new NotFoundException(`Company ${companyId} not found`);
      const state = await tx.companyVatRegistrationState.findUnique({ where: { companyId } });
      const currentVersion = state?.version ?? 0;
      if (currentVersion !== body.expectedVersion) {
        throw new ConflictException('expectedVersion is stale; reload and retry');
      }

      const today = todayCivilDate(company.timezone);
      const facts = await this.loadFacts(tx, companyId);
      const plan = planVatFactChange(body.command, facts, {
        today,
        lockedPeriods: await this.loadLockedPeriods(tx, companyId),
      });
      if ('code' in plan) {
        throw plan.code === 'validation'
          ? new UnprocessableEntityException(plan.reason)
          : new UnprocessableEntityException({ code: plan.code, message: plan.reason });
      }

      const nextVersion = currentVersion + 1;
      let resultFactId: string | null = null;

      if (plan.kind === 'APPLY') {
        for (const factId of plan.supersedeFactIds) {
          await tx.companyVatRegistrationFact.update({
            where: { id: factId },
            data: { supersededAt: new Date(), supersededByCommandId: body.commandId },
          });
        }
        if (plan.closeFact) {
          await tx.companyVatRegistrationFact.update({
            where: { id: plan.closeFact.id },
            data: { effectiveTo: civilDateToUtcDate(plan.closeFact.effectiveTo) },
          });
        }
        if (plan.reopenFactId) {
          await tx.companyVatRegistrationFact.update({
            where: { id: plan.reopenFactId },
            data: { effectiveTo: null },
          });
        }
        if (plan.insertFact) {
          const created = await tx.companyVatRegistrationFact.create({
            data: {
              companyId,
              status: plan.insertFact.status,
              effectiveFrom: civilDateToUtcDate(plan.insertFact.effectiveFrom),
              source: 'USER_ANSWER',
              actorId: ctx.userId,
            },
            select: { id: true },
          });
          resultFactId = created.id;
        }
      }

      await tx.companyVatRegistrationState.upsert({
        where: { companyId },
        create: { companyId, version: nextVersion },
        update: { version: nextVersion },
      });
      await tx.companyVatRegistrationCommand.create({
        data: {
          companyId,
          commandId: body.commandId,
          payloadFingerprint: fingerprint,
          expectedStateVersion: currentVersion,
          resultStateVersion: nextVersion,
          resultFactId,
          resultKind: plan.kind === 'NO_OP' ? 'NO_OP' : body.command.kind,
          actorUserId: ctx.userId,
        },
      });

      // Mirror maintained here and nowhere else (§5.2): there is no boundary worker, so the bit
      // is a last-known value that may lag when a dated fact starts on its own. Every runtime
      // reader uses the accessor instead.
      const after = await this.loadFacts(tx, companyId);
      const statusNow = effectiveVatStatus(after, today);
      await tx.company.update({ where: { id: companyId }, data: { vatRegistered: statusNow === 'REGISTERED' } });

      await this.audit.log(
        {
          companyId,
          actorUserId: ctx.userId,
          action: 'company.vat_registration.put',
          targetType: 'company',
          targetId: companyId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            statusPrev: effectiveVatStatus(facts, today),
            statusNext: statusNow,
            effectiveFrom: body.command.kind === 'UPSERT_FACT' ? body.command.effectiveFrom : null,
            resultKind: plan.kind === 'NO_OP' ? 'NO_OP' : body.command.kind,
          },
        },
        tx,
      );

      return { version: nextVersion, resultKind: plan.kind === 'NO_OP' ? 'NO_OP' : body.command.kind, replayed: false };
    });
  }

  /** §12.1 field list, fixed for the life of the feature. */
  private fingerprintOf(companyId: string, body: PutVatRegistrationRequest): string {
    if (body.command.kind === 'UPSERT_FACT') {
      if (!isCivilDate(body.command.effectiveFrom)) {
        throw new UnprocessableEntityException('effectiveFrom must be YYYY-MM-DD');
      }
      return canonicalFingerprint({
        companyId,
        kind: 'UPSERT_FACT',
        status: body.command.status,
        effectiveFrom: body.command.effectiveFrom,
        replaceFactId: body.command.replaceFactId ?? null,
      });
    }
    return canonicalFingerprint({
      companyId,
      kind: 'CANCEL_FUTURE',
      replaceFactId: body.command.replaceFactId,
    });
  }

  private async loadFacts(db: any, companyId: string): Promise<VatFactRow[]> {
    // Ordered in the query, not just in the accessor: `findMany` without `orderBy` returns rows in
    // whatever order Postgres happens to have them, which changes after the UPDATEs this command
    // issues. `answeredAt` is selected because it is the accessor's tiebreak.
    const rows = await db.companyVatRegistrationFact.findMany({
      where: { companyId },
      select: { id: true, status: true, effectiveFrom: true, effectiveTo: true, supersededAt: true, answeredAt: true },
      orderBy: [{ effectiveFrom: 'asc' }, { answeredAt: 'asc' }],
    });
    return rows.map((row: any) => ({
      id: row.id,
      status: row.status,
      effectiveFrom: utcDateToCivilDate(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? utcDateToCivilDate(row.effectiveTo) : null,
      supersededAt: row.supersededAt,
      answeredAt: row.answeredAt,
    }));
  }

  /**
   * Filed periods, from the rows that exist. Locked status comes from the tax module's own
   * helper rather than a copy of the list here — a second list would drift the day AMENDED
   * changes meaning. When `thai_tax` is off there are no rows, and the absence of evidence is
   * not evidence of a filing.
   */
  private async loadLockedPeriods(db: any, companyId: string): Promise<LockedPeriod[]> {
    const periods = await db.taxPeriod.findMany({
      where: { companyId, taxType: 'VAT' },
      select: { periodKey: true, status: true },
    });
    return periods
      .filter((period: any) => isPeriodLocked(period.status))
      .map((period: any) => monthRange(period.periodKey))
      .filter((range: LockedPeriod | null): range is LockedPeriod => range !== null);
  }
}

/** `YYYY-MM` -> the half-open civil range of that month. */
function monthRange(periodKey: string): LockedPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const from = `${match[1]}-${match[2]}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01` : `${match[1]}-${String(month + 1).padStart(2, '0')}`;
  return { from, to: `${nextMonth}-01` };
}
