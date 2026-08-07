import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { CompanyVatRegistrationUseCase } from '../../../data-model-core/application/use-cases/company-vat-registration.use-case';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { capturePolicyDate, expenseCaptureMode, type ExpenseCaptureMode } from '../../domain/logic/expense-capture-policy.logic';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import type { VatRegistrationStatus } from '@watchdog-bms/contracts';

export type ExpenseCapturePolicyView = {
  mode: ExpenseCaptureMode;
  /**
   * `HIDDEN` when the caller may not read the registration fact. `mode` alone is enough to render
   * the form, so a clerk gets a correct screen without learning the company's tax status.
   */
  vatStatus: VatRegistrationStatus | 'HIDDEN';
  canAnswerVatStatus: boolean;
  /**
   * Whether this caller may run the tax setup wizard. Answered here so the Tax Code selector can
   * stop offering a "ตั้งค่าภาษี" link to users who cannot follow it, without threading permissions
   * through every component that renders one.
   */
  canConfigureTax: boolean;
};

/**
 * Whether expense capture asks Thai VAT questions, for one document date (spec §9).
 *
 * `on` is the DOCUMENT's date, not today: an expense dated before the company's VAT effective
 * date must not be offered input VAT. The caller always knows the date it is rendering — as a
 * civil date or as the instant the API rendered that date as, so both shapes are accepted here
 * and narrowed to one day before the fact accessor sees them.
 */
@Injectable()
export class GetExpenseCapturePolicyUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vatRegistration: CompanyVatRegistrationUseCase,
  ) {}

  async execute(ctx: RequestContext, on?: string): Promise<ExpenseCapturePolicyView> {
    const asOf = on === undefined ? undefined : capturePolicyDate(on);
    if (asOf === null) throw new UnprocessableEntityException('on must be YYYY-MM-DD or an ISO datetime');

    // Reuses the VAT read: it resolves the company timezone default and applies the interval
    // accessor. Duplicating the fact load here would let the two drift.
    const [view, entitled] = await Promise.all([
      this.vatRegistration.get(ctx.companyId, asOf),
      loadEntitledFeatureKeys(this.prisma, ctx.companyId),
    ]);
    // `null` is the legacy fail-open sentinel — an unconfigured company is treated as entitled,
    // the same way the permission resolver reads it.
    const thaiTaxEnabled = entitled === null || entitled.has('thai_tax');

    return {
      mode: expenseCaptureMode({ vatStatus: view.status, thaiTaxEnabled }),
      vatStatus: ctx.permissions.includes('company.vat_registration.read') ? view.status : 'HIDDEN',
      canAnswerVatStatus: ctx.permissions.includes('company.vat_registration.manage'),
      canConfigureTax: ctx.permissions.includes('tax.config.manage'),
    };
  }
}
