import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type { LinkExternalWhtCertificateDto, SetWhtHandoffPayeeAddressDto, WhtCertificateHandoffDto, WhtCertificateDto, CreateSupplierPaymentDto, CreateVendorBillDto, ReviewVendorBillTaxEvidenceDto, SupplierPaymentDetail, SupplierPaymentSummary, TransactionTaxContext, UpdateVendorBillTaxEvidenceDto, VendorBillDetail, VendorBillSummary } from '@watchdog-bms/contracts';
import type { TaxExportArtifact } from '../tax/tax.api';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- Vendor Bills ----

export function listVendorBills(companyId: string, params?: { status?: string; supplierId?: string; matchingStatus?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }) {
  return apiFetch<{ data: VendorBillSummary[]; total: number; page: number; pageSize: number }>(`/companies/${companyId}/accounts-payable/vendor-bills${qs(params)}`);
}

export function getVendorBill(companyId: string, id: string) {
  return apiFetch<VendorBillDetail>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}`);
}

export function createVendorBill(companyId: string, body: Omit<CreateVendorBillDto, 'lines'> & { lines: Array<CreateVendorBillDto['lines'][number] & { transactionContext?: TransactionTaxContext }> }) {
  return apiFetch<VendorBillDetail>(`/companies/${companyId}/accounts-payable/vendor-bills`, { method: 'POST', body: JSON.stringify(body) });
}

export function matchVendorBill(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/match`, { method: 'POST', body: '{}' });
}

export function overrideVendorBillMatch(companyId: string, id: string, overrideReason: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/match/override`, { method: 'POST', body: JSON.stringify({ overrideReason }) });
}

export function submitVendorBill(companyId: string, id: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/submit`, { method: 'POST', body: '{}' });
}

export function approveVendorBill(companyId: string, id: string, note?: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/approve`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function updateVendorBillTaxEvidence(companyId: string, id: string, body: UpdateVendorBillTaxEvidenceDto) {
  return apiFetch<VendorBillDetail>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/tax-evidence`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function reviewVendorBillTaxEvidence(companyId: string, id: string, body: ReviewVendorBillTaxEvidenceDto) {
  return apiFetch<VendorBillDetail>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/tax-evidence/review`, { method: 'POST', body: JSON.stringify(body) });
}

// H-07 maker-checker approval policy
export type ProcurementApprovalPolicy = { id: string; companyId: string; allowSelfApproval: boolean; dualApprovalThresholdAmount: string | null };

export function getApprovalPolicy(companyId: string) {
  return apiFetch<ProcurementApprovalPolicy>(`/companies/${companyId}/accounts-payable/vendor-bills/approval-policy`);
}

export function updateApprovalPolicy(companyId: string, body: { allowSelfApproval?: boolean; dualApprovalThresholdAmount?: string | null }) {
  return apiFetch<ProcurementApprovalPolicy>(`/companies/${companyId}/accounts-payable/vendor-bills/approval-policy`, { method: 'PUT', body: JSON.stringify(body) });
}

export function rejectVendorBill(companyId: string, id: string, note: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
}

export function voidVendorBill(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/vendor-bills/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Supplier Payments ----

export function listSupplierPayments(companyId: string, params?: { status?: string; supplierId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }) {
  return apiFetch<{ data: SupplierPaymentSummary[]; total: number; page: number; pageSize: number }>(`/companies/${companyId}/accounts-payable/payments${qs(params)}`);
}

export function getSupplierPayment(companyId: string, id: string) {
  return apiFetch<SupplierPaymentDetail>(`/companies/${companyId}/accounts-payable/payments/${id}`);
}

export function createSupplierPayment(companyId: string, body: CreateSupplierPaymentDto) {
  return apiFetch<SupplierPaymentDetail>(`/companies/${companyId}/accounts-payable/payments`, { method: 'POST', body: JSON.stringify(body) });
}

export type WhtIncomeCategoryOption = { code: string; nameTh: string; formType: string; defaultRate: string };

/**
 * ACTIVE income categories only. The catalog ships DRAFT pending accountant review, so an empty
 * list means withholding is not set up yet — not that the endpoint failed.
 */
export function listWhtIncomeCategories(companyId: string) {
  return apiFetch<WhtIncomeCategoryOption[]>(`/companies/${companyId}/accounts-payable/wht-income-categories`);
}

export function voidSupplierPayment(companyId: string, id: string, reason: string) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/payments/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function generateSourceJournal(companyId: string, sourceType: string, sourceId: string, sourceEventType?: string) {
  return apiFetch(`/companies/${companyId}/posting/generate`, { method: 'POST', body: JSON.stringify({ sourceType, sourceId, sourceEventType }) });
}

export function releasePp36InputClaim(companyId: string, vendorBillId: string, lineId: string, body: { supplierPaymentId?: string; evidenceId: string; claimDate: string; reason: string }) {
  return apiFetch<{ adjustmentId: string; idempotent: boolean }>(`/companies/${companyId}/accounts-payable/vendor-bills/${vendorBillId}/lines/${lineId}/pp36-input-claim`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- AP Reports ----

export function getApAging(companyId: string, params?: { asOfDate?: string; supplierId?: string }) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/aging${qs(params)}`);
}

export function getSupplierStatement(companyId: string, supplierId: string, params?: { fromDate?: string; toDate?: string }) {
  return apiFetch<any>(`/companies/${companyId}/accounts-payable/suppliers/${supplierId}/statement${qs(params)}`);
}

// ── 50 ทวิ external handoff ───────────────────────────────────────────────────
// Reachable without `thai_tax`: while the system cannot issue the certificate itself, the operator
// gets the prefilled facts here and links the externally issued document back.

export function listWhtHandoffs(companyId: string, params?: { status?: string }) {
  return apiFetch<WhtCertificateHandoffDto[]>(`/companies/${companyId}/wht/payment-handoffs${qs(params)}`);
}

export function linkExternalWhtCertificate(companyId: string, handoffId: string, body: LinkExternalWhtCertificateDto) {
  return apiFetch<WhtCertificateHandoffDto>(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/external-certificate`, { method: 'POST', body: JSON.stringify(body) });
}

/** §10: the address lands beside the frozen prefill, so the response carries it as its own field. */
export function setWhtHandoffPayeeAddress(companyId: string, handoffId: string, body: SetWhtHandoffPayeeAddressDto) {
  return apiFetch<WhtCertificateHandoffDto>(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/payee-address`, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * WHT certificate system issuance plan §2.3/§4.1: mints the certificate directly, in the system.
 * The PDF is returned inline (`pdfArtifact`) — nothing ever populates `WhtCertificate.pdfAttachmentId`
 * (confirmed against the Tax-workspace issue path too), so this response is the only place the bytes
 * exist; the caller must save them immediately.
 */
export function issueSystemWhtCertificate(companyId: string, handoffId: string) {
  return apiFetch<WhtCertificateDto & { pdfArtifact: TaxExportArtifact }>(`/companies/${companyId}/wht/payment-handoffs/${handoffId}/system-certificate`, { method: 'POST' });
}
