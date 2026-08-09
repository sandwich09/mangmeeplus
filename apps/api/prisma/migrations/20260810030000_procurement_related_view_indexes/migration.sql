-- Related procurement visibility resolves persisted actors and walks the PR -> PO -> receipt ->
-- vendor bill -> supplier payment graph. Keep actor seeds and every forward/reverse hop indexable.
CREATE INDEX "PurchaseRequest_companyId_createdByUserId_idx" ON "PurchaseRequest"("companyId", "createdByUserId");
CREATE INDEX "PurchaseRequest_companyId_updatedByUserId_idx" ON "PurchaseRequest"("companyId", "updatedByUserId");
CREATE INDEX "PurchaseRequest_companyId_approvedByUserId_idx" ON "PurchaseRequest"("companyId", "approvedByUserId");
CREATE INDEX "PurchaseRequest_companyId_rejectedByUserId_idx" ON "PurchaseRequest"("companyId", "rejectedByUserId");
CREATE INDEX "PurchaseRequest_companyId_convertedPurchaseOrderId_idx" ON "PurchaseRequest"("companyId", "convertedPurchaseOrderId");

CREATE INDEX "PurchaseOrder_companyId_sourcePurchaseRequestId_idx" ON "PurchaseOrder"("companyId", "sourcePurchaseRequestId");
CREATE INDEX "PurchaseOrder_companyId_createdByUserId_idx" ON "PurchaseOrder"("companyId", "createdByUserId");
CREATE INDEX "PurchaseOrder_companyId_updatedByUserId_idx" ON "PurchaseOrder"("companyId", "updatedByUserId");
CREATE INDEX "PurchaseOrder_companyId_approvedByUserId_idx" ON "PurchaseOrder"("companyId", "approvedByUserId");
CREATE INDEX "PurchaseOrder_companyId_rejectedByUserId_idx" ON "PurchaseOrder"("companyId", "rejectedByUserId");
CREATE INDEX "PurchaseOrder_companyId_issuedByUserId_idx" ON "PurchaseOrder"("companyId", "issuedByUserId");
CREATE INDEX "PurchaseOrder_companyId_cancelledByUserId_idx" ON "PurchaseOrder"("companyId", "cancelledByUserId");
CREATE INDEX "PurchaseOrder_companyId_closedByUserId_idx" ON "PurchaseOrder"("companyId", "closedByUserId");

CREATE INDEX "GoodsReceipt_companyId_receivedByUserId_idx" ON "GoodsReceipt"("companyId", "receivedByUserId");
CREATE INDEX "GoodsReceipt_companyId_createdByUserId_idx" ON "GoodsReceipt"("companyId", "createdByUserId");
CREATE INDEX "GoodsReceipt_companyId_updatedByUserId_idx" ON "GoodsReceipt"("companyId", "updatedByUserId");
CREATE INDEX "GoodsReceipt_companyId_voidedByUserId_idx" ON "GoodsReceipt"("companyId", "voidedByUserId");

CREATE INDEX "VendorBill_companyId_purchaseOrderId_idx" ON "VendorBill"("companyId", "purchaseOrderId");
CREATE INDEX "VendorBill_companyId_goodsReceiptId_idx" ON "VendorBill"("companyId", "goodsReceiptId");
CREATE INDEX "VendorBill_companyId_createdByUserId_idx" ON "VendorBill"("companyId", "createdByUserId");
CREATE INDEX "VendorBill_companyId_updatedByUserId_idx" ON "VendorBill"("companyId", "updatedByUserId");
CREATE INDEX "VendorBill_companyId_approvedByUserId_idx" ON "VendorBill"("companyId", "approvedByUserId");
CREATE INDEX "VendorBill_companyId_voidedByUserId_idx" ON "VendorBill"("companyId", "voidedByUserId");
CREATE INDEX "VendorBill_companyId_taxEvidenceReviewedByUserId_idx" ON "VendorBill"("companyId", "taxEvidenceReviewedByUserId");
CREATE INDEX "VendorBillMatch_companyId_overriddenByUserId_idx" ON "VendorBillMatch"("companyId", "overriddenByUserId");

CREATE INDEX "SupplierPayment_companyId_createdByUserId_idx" ON "SupplierPayment"("companyId", "createdByUserId");
CREATE INDEX "SupplierPayment_companyId_updatedByUserId_idx" ON "SupplierPayment"("companyId", "updatedByUserId");
CREATE INDEX "SupplierPayment_companyId_recordedByUserId_idx" ON "SupplierPayment"("companyId", "recordedByUserId");
CREATE INDEX "SupplierPayment_companyId_voidedByUserId_idx" ON "SupplierPayment"("companyId", "voidedByUserId");
CREATE INDEX "SupplierPaymentAllocation_companyId_supplierPaymentId_idx" ON "SupplierPaymentAllocation"("companyId", "supplierPaymentId");
CREATE INDEX "SupplierPaymentAllocation_companyId_createdByUserId_idx" ON "SupplierPaymentAllocation"("companyId", "createdByUserId");
CREATE INDEX "SupplierPaymentAllocation_companyId_pp36ReversedByUserId_idx" ON "SupplierPaymentAllocation"("companyId", "pp36ReversedByUserId");
CREATE INDEX "PurchaseApprovalEvent_companyId_actorUserId_idx" ON "PurchaseApprovalEvent"("companyId", "actorUserId");
CREATE INDEX "AuditLog_companyId_actorUserId_targetType_targetId_idx" ON "AuditLog"("companyId", "actorUserId", "targetType", "targetId");
