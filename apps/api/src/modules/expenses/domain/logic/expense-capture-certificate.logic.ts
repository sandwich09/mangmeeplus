/**
 * W06 — may this derived source have a substitute-receipt certificate, and what is it waiting for?
 *
 * Source of truth: spec §12.1 (evidence decision per reviewed source), §12.2 (per source, never on
 * the capture-only parent), §14.3 (reserve the allocation before anything consequential, show
 * per-source progress) and appendix §7 (D04). Acceptance A17–A20, A23, A34, A40.
 *
 * Pure: the caller loads the group, the accepted allocation and the assembled facts. Nothing here
 * decides the ORDINARY eligibility of an expense — `collectSubstituteReceiptEligibilityIssues`
 * still owns that, unchanged, and these are the capture-only additions on top of it.
 */
import type { CaptureFactsView } from '@watchdog-bms/contracts';

/** §12.1 row 1: the company already holds a usable document, so no certificate is offered. */
const USABLE_RECEIPT_KINDS = new Set(['RECEIPT', 'TAX_INVOICE', 'ABBREVIATED_TAX_INVOICE']);

export type CaptureCertificateRefusal = {
  code: 'substitute_capture_allocation_superseded'
  | 'substitute_capture_unpaid_evidence'
  | 'substitute_capture_document_mismatch'
  | 'substitute_capture_funding_route_mismatch';
  /** 409 when the world moved under the request, 422 when the facts do not support the document. */
  status: 409 | 422;
  message: string;
};

export type CaptureCertificateGate =
  | { outcome: 'available' }
  /** A18/A19: this scope has its own receipt. The group never offers a certificate for it. */
  | { outcome: 'receipt_present' }
  | ({ outcome: 'refused' } & CaptureCertificateRefusal);

export type CaptureCertificateGateInput = {
  /** The group the derived source came from. */
  group: { handoffState: string; acceptedAllocationId: string | null };
  /** The lineage columns of the derived source itself. */
  source: { captureAllocationId: string | null; captureScopeKey: string | null };
  facts: Pick<CaptureFactsView, 'documents'> | null;
};

const REFUSALS: Record<CaptureCertificateRefusal['code'], CaptureCertificateRefusal> = {
  substitute_capture_allocation_superseded: {
    code: 'substitute_capture_allocation_superseded', status: 409,
    message: 'การจัดส่วนเปลี่ยนไปแล้ว กรุณาสร้างรายการใหม่ก่อนทำใบรับรอง',
  },
  substitute_capture_unpaid_evidence: {
    code: 'substitute_capture_unpaid_evidence', status: 422,
    message: 'หลักฐานของร้านนี้ยังไม่แสดงว่าจ่ายเงินแล้ว (เช่น คำสั่งซื้อที่ยังรอชำระ) จึงยังจัดทำใบรับรองแทนใบเสร็จไม่ได้ กรุณาเพิ่มหลักฐานการจ่ายหรือยืนยันการจ่ายในกลุ่มหลักฐานก่อน',
  },
  substitute_capture_document_mismatch: {
    code: 'substitute_capture_document_mismatch', status: 422,
    message: 'ยอดในเอกสารของร้านนี้ยังไม่ตรงกัน กรุณาตรวจจุดที่ไม่ตรงในกลุ่มหลักฐานก่อนจัดทำใบรับรอง',
  },
  substitute_capture_funding_route_mismatch: {
    code: 'substitute_capture_funding_route_mismatch', status: 422,
    message: 'แหล่งเงินในใบรับรองต้องตรงกับผู้จ่ายที่ตรวจแล้วในกลุ่มหลักฐาน กรุณาเลือกให้ตรงกันก่อน',
  },
};

/**
 * A23/A34/A40 in one pass. Order is deliberate: the allocation is the thing being reserved, so a
 * superseded one is answered before anything is read off facts that no longer belong to it.
 */
export function captureCertificateGate(input: CaptureCertificateGateInput): CaptureCertificateGate {
  const { group, source, facts } = input;
  // §3.1 converted expense and §3.2 LINE auto-handoff: no allocation divided this purchase, so
  // there is none to reserve and no company share to validate — the ordinary certificate rules
  // decide exactly as they did before this group existed.
  if (!source.captureAllocationId && !group.acceptedAllocationId) return { outcome: 'available' };
  if (group.handoffState !== 'ACTIVE' || !source.captureAllocationId
    || source.captureAllocationId !== group.acceptedAllocationId) {
    return { outcome: 'refused', ...REFUSALS.substitute_capture_allocation_superseded };
  }
  const documents = (facts?.documents ?? []).filter((document) => document.scopeKey === source.captureScopeKey);
  // No facts for the scope is not a licence to certify: §12.2 requires derived-scope validation.
  if (documents.length === 0) return { outcome: 'refused', ...REFUSALS.substitute_capture_unpaid_evidence };
  if (documents.some((document) => USABLE_RECEIPT_KINDS.has(document.kind) && document.state.documentTotal !== undefined)) {
    return { outcome: 'receipt_present' };
  }
  if (!documents.some((document) => document.state.paymentStatus === 'paid')) {
    return { outcome: 'refused', ...REFUSALS.substitute_capture_unpaid_evidence };
  }
  if (documents.some((document) => document.state.reconciliation === 'mismatch')) {
    return { outcome: 'refused', ...REFUSALS.substitute_capture_document_mismatch };
  }
  return { outcome: 'available' };
}

/**
 * §12.4: the certificate's funding source is the one the group reviewed. A COMPANY certificate on
 * an employee-paid purchase would record the company paying the shop — money that never moved.
 */
export function captureFundingRouteRefusal(
  fundingRoute: string,
  fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE',
): CaptureCertificateRefusal | null {
  if (fundingRoute === 'COMPANY' && fundingSource !== 'COMPANY') return REFUSALS.substitute_capture_funding_route_mismatch;
  if (fundingRoute === 'EMPLOYEE' && fundingSource !== 'PERSONAL_ADVANCE') return REFUSALS.substitute_capture_funding_route_mismatch;
  return null;
}

/** A40: what the group page shows per source, so "ร้าน A ออกแล้ว / ร้าน B รอลงนาม" is one lookup. */
export function captureDerivedNextAction(
  gate: CaptureCertificateGate,
  certificate: { status: string } | null,
): import('@watchdog-bms/contracts').ExpenseCaptureDerivedNextAction {
  if (certificate) {
    return certificate.status === 'ISSUED' ? 'certificate_issued'
      : certificate.status === 'PAYER_CERTIFIED' ? 'certificate_certified'
        : 'certificate_prepared';
  }
  return gate.outcome === 'available' ? 'certificate_available'
    : gate.outcome === 'receipt_present' ? 'receipt_present' : 'blocked';
}
