import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { deriveWhtIncomeBase } from '../../domain/logic/wht-report.logic';
import { counterpartyAddressText } from '../../../accounting-documents/domain/logic/vendor-counterparty-match.logic';
import type { SupplierPaymentWhtSourceRow } from '../../domain/ports/source-reader.port';

/**
 * RA-20: the seam where an SME most often withholds tax — paying a vendor — reaching the ภ.ง.ด.
 * forms. Expenses record withholding when the cost is captured (expense-source.adapter.ts); this
 * records it when the money actually leaves, which is when the obligation to the RD arises.
 *
 * Unlike the expense adapter this needs no unit translation: `SupplierPayment.whtRate` is already
 * the percent every WHT consumer means.
 */
@Injectable()
export class SupplierPaymentSourceAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async findRecordedWithWhtByCompany(companyId: string, since?: Date): Promise<SupplierPaymentWhtSourceRow[]> {
    const rows = await this.prisma.client.supplierPayment.findMany({
      where: {
        companyId,
        // RECORDED only: a DRAFT has not settled anything and a VOIDED payment's events are
        // reversed inside the void, not re-derived here.
        status: 'RECORDED',
        whtAmount: { gt: 0 },
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      include: {
        supplier: {
          select: {
            legalNameSnapshot: true, displayNameSnapshot: true, taxId: true, branchCode: true, supplierType: true,
            // GAP-2 / §10: the counterparty registry row every supplier profile points at
            // (`counterpartyId` is a required unique relation) — the typed read the payment side
            // was waiting on. Never `supplier.addressJson`: that is free-form procurement data
            // (CON-9), and printing it raw would re-create BUG-1.
            counterparty: { select: { billingAddressJson: true } },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    return rows.map((row) => {
      const whtAmount = String(row.whtAmount ?? '0');
      const whtRate = row.whtRate != null ? String(row.whtRate) : null;
      return {
        id: row.id,
        companyId: row.companyId,
        branchId: row.branchId ?? null,
        paymentDate: row.paymentDate,
        whtAmount,
        // Never `row.grossAmount`: that settles bills and includes VAT, which is not income to the
        // payee. Null when the rate is missing (pre-feature rows) so review sees an unknown base
        // rather than a wrong one.
        grossAmount: deriveWhtIncomeBase(whtAmount, whtRate),
        payeeName: row.supplier?.legalNameSnapshot ?? row.supplier?.displayNameSnapshot ?? null,
        payeeTaxId: row.supplier?.taxId ?? null,
        payeeBranchCode: row.supplier?.branchCode ?? null,
        payeeAddress: counterpartyAddressText(row.supplier?.counterparty?.billingAddressJson ?? null),
        supplierType: row.supplier?.supplierType ?? null,
        incomeCategoryCode: row.whtCategoryCode ?? null,
        whtRate,
        currency: row.currency ?? 'THB',
        updatedAt: row.updatedAt,
      };
    });
  }
}
