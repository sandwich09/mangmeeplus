import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { PrismaTaxRepository } from './infrastructure/repositories/prisma-tax.repository';
import { AccountingDocumentSourceAdapter } from './infrastructure/adapters/accounting-document-source.adapter';
import { ExpenseSourceAdapter } from './infrastructure/adapters/expense-source.adapter';
import { SupplierPaymentSourceAdapter } from './infrastructure/adapters/supplier-payment-source.adapter';
import { SetWhtIncomeCategoryStatusUseCase } from './application/use-cases/wht-income-category.use-case';
import { SyncTaxEventsUseCase } from './application/use-cases/sync-tax-events.use-case';
import { GenerateVatReportUseCase } from './application/use-cases/generate-vat-report.use-case';
import { GenerateWhtReportUseCase } from './application/use-cases/generate-wht-report.use-case';
import { GenerateTaxFilingPackageUseCase } from './application/use-cases/generate-tax-filing-package.use-case';
import { CreateWhtCertificateUseCase } from './application/use-cases/create-wht-certificate.use-case';
import { WhtCertificateHandoffUseCase } from './application/use-cases/wht-certificate-handoff.use-case';
import { TaxArtifactRendererService } from './application/services/tax-artifact-renderer.service';
import { GetCitCalendarUseCase } from './application/use-cases/get-cit-calendar.use-case';
import { GetTaxSummaryUseCase } from './application/use-cases/get-tax-summary.use-case';
import { TaxController } from './presentation/http/tax.controller';
import { TransactionTaxController } from './presentation/http/transaction-tax.controller';
import { PrismaTransactionTaxRepository } from './infrastructure/repositories/prisma-transaction-tax.repository';
import { GetCompanyTaxCodeProfileUseCase, GetTransactionTaxAgentSummaryUseCase, TransactionTaxConfigUseCase } from './application/use-cases/transaction-tax-config.use-case';
import { TransactionTaxReconciliationUseCase } from './application/use-cases/transaction-tax-reconciliation.use-case';
import { TaxCodeImportUseCase } from './application/use-cases/tax-code-import.use-case';

@Module({
  // FeatureLaunchModule supplies the guard that fences SYSTEM 50 ทวิ issuance on
  // cap.wht50bis/SYSTEM_INITIAL_ISSUE. It imports only LoggerModule, so there is no cycle back here.
  imports: [AuditModule, DataModelCoreModule, FeatureLaunchModule],
  controllers: [TaxController, TransactionTaxController],
  providers: [
    PrismaTaxRepository,
    AccountingDocumentSourceAdapter,
    ExpenseSourceAdapter,
    SupplierPaymentSourceAdapter,
    SetWhtIncomeCategoryStatusUseCase,
    SyncTaxEventsUseCase,
    GenerateVatReportUseCase,
    GenerateWhtReportUseCase,
    GenerateTaxFilingPackageUseCase,
    CreateWhtCertificateUseCase,
    WhtCertificateHandoffUseCase,
    TaxArtifactRendererService,
    GetCitCalendarUseCase,
    GetTaxSummaryUseCase,
    PrismaTransactionTaxRepository,
    TransactionTaxConfigUseCase,
    GetCompanyTaxCodeProfileUseCase,
    GetTransactionTaxAgentSummaryUseCase,
    TransactionTaxReconciliationUseCase,
    TaxCodeImportUseCase,
  ],
  exports: [PrismaTaxRepository, WhtCertificateHandoffUseCase, GetTaxSummaryUseCase, TransactionTaxConfigUseCase, GetCompanyTaxCodeProfileUseCase, GetTransactionTaxAgentSummaryUseCase],
})
export class TaxModule {}
