/**
 * The document is not in baht, so the number the AI read is not a baht amount.
 *
 * UAT 2026-08-29: a $200.00 USD invoice was recorded as 200 บาท — silently wrong by the exchange
 * rate. This warns and never converts: an FX rate this page does not have would be worse than the
 * warning, and the reviewer can still edit the amount and save. It adds no gate.
 *
 * Reads the currency the OCR reported, which rides on the draft inside
 * `aiVerificationSummaryJson.recognizedFields` (ReceiptOcrFieldResult.currency). An absent,
 * malformed, or THB code renders nothing at all.
 */
export function ForeignCurrencyNotice({ summary }: { summary: Record<string, unknown> | null }) {
  const recognized = summary?.['recognizedFields'];
  const raw = recognized && typeof recognized === 'object' && !Array.isArray(recognized)
    ? (recognized as Record<string, unknown>)['currency']
    : undefined;
  // The gateway already bounds this, but it crosses a service boundary before it is printed here.
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code) || code === 'THB') return null;
  return (
    <div role="alert" className="rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm font-medium text-warning-700">
      ⚠ เอกสารนี้เป็นสกุลเงิน {code} ยอดที่อ่านได้อาจไม่ใช่จำนวนเงินบาท กรุณาตรวจและแก้ยอดเป็นเงินบาทก่อนบันทึก
    </div>
  );
}
