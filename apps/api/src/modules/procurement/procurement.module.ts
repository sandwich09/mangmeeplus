import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaProcurementRepository } from './infrastructure/prisma-procurement.repository';

import { CreateSupplierUseCase, UpdateSupplierUseCase, GetSupplierUseCase, ListSuppliersUseCase, ListSupplierBankAccountsUseCase, CreateSupplierBankAccountUseCase } from './application/use-cases/supplier.use-case';
import { CreatePurchaseRequestUseCase, GetPurchaseRequestUseCase, ListPurchaseRequestsUseCase, SubmitPurchaseRequestUseCase, ApprovePurchaseRequestUseCase, RejectPurchaseRequestUseCase, CancelPurchaseRequestUseCase } from './application/use-cases/purchase-request.use-case';
import { CreatePurchaseOrderUseCase, GetPurchaseOrderUseCase, ListPurchaseOrdersUseCase, ApprovePurchaseOrderUseCase, IssuePurchaseOrderUseCase, RejectPurchaseOrderUseCase, CancelPurchaseOrderUseCase, ClosePurchaseOrderUseCase } from './application/use-cases/purchase-order.use-case';
import { CreateGoodsReceiptUseCase, GetGoodsReceiptUseCase, ListGoodsReceiptsUseCase, PostGoodsReceiptUseCase, VoidGoodsReceiptUseCase } from './application/use-cases/goods-receipt.use-case';
import { CreateVendorBillUseCase, GetVendorBillUseCase, ListVendorBillsUseCase, MatchVendorBillUseCase, OverrideVendorBillMatchUseCase, SubmitVendorBillUseCase, ApproveVendorBillUseCase, RejectVendorBillUseCase, VoidVendorBillUseCase, GetVendorBillPostingSourceUseCase, GetVendorBillPp36PostingSourceUseCase, UpdateVendorBillTaxEvidenceUseCase, ReviewVendorBillTaxEvidenceUseCase } from './application/use-cases/vendor-bill.use-case';
import { TaxModule } from '../tax/tax.module';
import { CreateSupplierPaymentUseCase, GetSupplierPaymentPp36PostingSourceUseCase, GetSupplierPaymentPostingSourceUseCase, GetSupplierPaymentUseCase, ListSupplierPaymentsUseCase, VoidSupplierPaymentUseCase } from './application/use-cases/supplier-payment.use-case';
import { GetProcurementApprovalPolicyUseCase, UpdateProcurementApprovalPolicyUseCase } from './application/use-cases/approval-policy.use-case';
import { GetApAgingUseCase, GetSupplierStatementUseCase } from './application/use-cases/ap-reporting.use-case';
import { ListWhtIncomeCategoriesUseCase } from './application/use-cases/wht-income-category.use-case';

import { SupplierController } from './presentation/http/supplier.controller';
import { PurchaseRequestController } from './presentation/http/purchase-request.controller';
import { PurchaseOrderController } from './presentation/http/purchase-order.controller';
import { GoodsReceiptController } from './presentation/http/goods-receipt.controller';
import { VendorBillController } from './presentation/http/vendor-bill.controller';
import { SupplierPaymentController } from './presentation/http/supplier-payment.controller';
import { Pp36InputClaimController } from './presentation/http/pp36-input-claim.controller';
import { ReleasePp36InputVatClaimUseCase } from './application/use-cases/pp36-input-claim.use-case';

@Module({
  imports: [AuditModule, DataModelCoreModule, InventoryModule, TaxModule],
  controllers: [
    SupplierController,
    PurchaseRequestController,
    PurchaseOrderController,
    GoodsReceiptController,
    VendorBillController,
    SupplierPaymentController,
    Pp36InputClaimController,
  ],
  providers: [
    PrismaProcurementRepository,
    // Supplier
    CreateSupplierUseCase,
    UpdateSupplierUseCase,
    GetSupplierUseCase,
    ListSuppliersUseCase,
    ListSupplierBankAccountsUseCase,
    CreateSupplierBankAccountUseCase,
    // Purchase Request
    CreatePurchaseRequestUseCase,
    GetPurchaseRequestUseCase,
    ListPurchaseRequestsUseCase,
    SubmitPurchaseRequestUseCase,
    ApprovePurchaseRequestUseCase,
    RejectPurchaseRequestUseCase,
    CancelPurchaseRequestUseCase,
    // Purchase Order
    CreatePurchaseOrderUseCase,
    GetPurchaseOrderUseCase,
    ListPurchaseOrdersUseCase,
    ApprovePurchaseOrderUseCase,
    IssuePurchaseOrderUseCase,
    RejectPurchaseOrderUseCase,
    CancelPurchaseOrderUseCase,
    ClosePurchaseOrderUseCase,
    // Goods Receipt
    CreateGoodsReceiptUseCase,
    GetGoodsReceiptUseCase,
    ListGoodsReceiptsUseCase,
    PostGoodsReceiptUseCase,
    VoidGoodsReceiptUseCase,
    // Vendor Bill
    CreateVendorBillUseCase,
    GetVendorBillUseCase,
    UpdateVendorBillTaxEvidenceUseCase,
    ReviewVendorBillTaxEvidenceUseCase,
    ListVendorBillsUseCase,
    MatchVendorBillUseCase,
    OverrideVendorBillMatchUseCase,
    SubmitVendorBillUseCase,
    ApproveVendorBillUseCase,
    RejectVendorBillUseCase,
    VoidVendorBillUseCase,
    GetVendorBillPostingSourceUseCase,
    GetVendorBillPp36PostingSourceUseCase,
    // H-07 approval policy
    GetProcurementApprovalPolicyUseCase,
    UpdateProcurementApprovalPolicyUseCase,
    // Supplier Payment
    CreateSupplierPaymentUseCase,
    GetSupplierPaymentUseCase,
    GetSupplierPaymentPostingSourceUseCase,
    GetSupplierPaymentPp36PostingSourceUseCase,
    ListSupplierPaymentsUseCase,
    VoidSupplierPaymentUseCase,
    ReleasePp36InputVatClaimUseCase,
    // AP Reporting
    GetApAgingUseCase,
    ListWhtIncomeCategoriesUseCase,
    GetSupplierStatementUseCase,
  ],
  exports: [
    PrismaProcurementRepository,
    GetSupplierUseCase,
    ListSuppliersUseCase,
    GetPurchaseOrderUseCase,
    ListPurchaseOrdersUseCase,
    // LINE รายการรออนุมัติ card counts the pending PR queue through this permission-checked use case.
    ListPurchaseRequestsUseCase,
    // LINE AI AP-outstanding tool reads through this permission-checked use case.
    GetApAgingUseCase,
    ListWhtIncomeCategoriesUseCase,
    GetVendorBillPostingSourceUseCase,
  ],
})
export class ProcurementModule {}
