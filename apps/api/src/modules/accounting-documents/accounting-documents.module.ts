import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { PrismaAccountingRepository } from './infrastructure/prisma-accounting.repository';
import {
  CreateCounterpartyUseCase,
  UpdateCounterpartyUseCase,
  GetCounterpartyUseCase,
  ListCounterpartiesUseCase,
} from './application/use-cases/counterparty.use-case';
import { EnsureCustomerCounterpartyUseCase } from './application/use-cases/ensure-customer-counterparty.use-case';
import {
  CreateDocumentUseCase,
  GetDocumentUseCase,
  ListDocumentsUseCase,
  IssueDocumentUseCase,
  VoidDocumentUseCase,
  SubmitQuotationApprovalUseCase,
  ApproveQuotationUseCase,
  RejectQuotationUseCase,
  ConvertDocumentUseCase,
} from './application/use-cases/document.use-case';
import {
  CreatePaymentUseCase,
  GetPaymentUseCase,
  ListPaymentsUseCase,
  VoidPaymentUseCase,
} from './application/use-cases/payment.use-case';
import { SumReceivedPaymentsByCounterpartyUseCase } from './application/use-cases/sum-received-payments-by-counterparty.use-case';
import { GetDocumentPostingSourceUseCase } from './application/use-cases/posting-source.use-case';
import { CounterpartyController } from './presentation/http/counterparty.controller';
import { AccountingDocumentController } from './presentation/http/accounting-document.controller';
import { AccountingPaymentController } from './presentation/http/accounting-payment.controller';
import { TaxModule } from '../tax/tax.module';

@Module({
  imports: [AuditModule, DataModelCoreModule, TaxModule],
  controllers: [
    CounterpartyController,
    AccountingDocumentController,
    AccountingPaymentController,
  ],
  providers: [
    PrismaAccountingRepository,
    // Counterparty
    CreateCounterpartyUseCase,
    UpdateCounterpartyUseCase,
    GetCounterpartyUseCase,
    ListCounterpartiesUseCase,
    EnsureCustomerCounterpartyUseCase,
    // Document
    CreateDocumentUseCase,
    GetDocumentUseCase,
    ListDocumentsUseCase,
    IssueDocumentUseCase,
    VoidDocumentUseCase,
    SubmitQuotationApprovalUseCase,
    ApproveQuotationUseCase,
    RejectQuotationUseCase,
    ConvertDocumentUseCase,
    // Payment
    CreatePaymentUseCase,
    GetPaymentUseCase,
    ListPaymentsUseCase,
    VoidPaymentUseCase,
    SumReceivedPaymentsByCounterpartyUseCase,
    // Posting source
    GetDocumentPostingSourceUseCase,
  ],
  exports: [
    PrismaAccountingRepository,
    GetDocumentPostingSourceUseCase,
    // Item 15 CRM links quotation drafts through these permission-checked use cases.
    CreateDocumentUseCase,
    GetDocumentUseCase,
    // CRM sale seam auto-links customers to accounting counterparties after quotation authorization.
    EnsureCustomerCounterpartyUseCase,
    // LINE AI accounting tools read through this permission-checked use case.
    ListDocumentsUseCase,
    // CRM reports consume aggregate revenue under crm.report.read, not raw documents.
    SumReceivedPaymentsByCounterpartyUseCase,
  ],
})
export class AccountingDocumentsModule {}
