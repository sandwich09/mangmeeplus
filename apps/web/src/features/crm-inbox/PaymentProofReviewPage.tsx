'use client';

// A9 web review — accountant/finance view of LINE-captured payment-proof evidence.
// Lists flagged proofs (A3 backend), previews through the finance-only purpose-checked
// content route, and deep-links to the conversation for full context.
// Verification of the payment itself stays in items 08/09/13 — this is the review surface.
import { useCallback, useEffect, useState } from 'react';
import { listPaymentProofs, type PaymentProofItem } from './crm-inbox.api';
import { paymentProofContentUrl } from './crm-inbox.logic';
import { ForbiddenState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';

function fmtWhen(v: string) {
  return formatThaiDateTime(v);
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PaymentProofReviewPage({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<PaymentProofItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listPaymentProofs(companyId);
      setItems(r.items);
      setError(null);
    } catch (e) {
      // `authedApiFetch` throws a plain Error carrying `status`, never an `ApiError` with
      // `statusCode` — reading the wrong shape meant this forbidden state never rendered.
      if ((e as { status?: number } | null)?.status === 403) setForbidden(true);
      else setError(apiErrorMessage(e));
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  if (forbidden) return <div className="p-6"><ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์ดูหลักฐานการชำระเงิน" /></div>;

  return (
    <div className="space-y-4 p-6">
      <div>
        <a href={`/companies/${companyId}/inbox`} className="text-sm text-brand-700 hover:underline">‹ กล่องข้อความ</a>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">หลักฐานการชำระเงิน (รอตรวจสอบ)</h1>
        <p className="mt-1 text-sm text-gray-500">ภาพที่พนักงานตั้งค่าจากแชท LINE ว่าเป็นหลักฐานการโอน — ตรวจสอบและออกเอกสารการเงินตามขั้นตอน</p>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!items && !error && <div className="text-sm text-gray-400">กำลังโหลด...</div>}
      {items && items.length === 0 && (
        <div className="rounded border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400">ยังไม่มีหลักฐานการชำระเงินที่รอตรวจสอบ</div>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const isImage = p.mimeType.startsWith('image/');
            const previewUrl = p.messageId ? paymentProofContentUrl(companyId, p.conversationId, p.messageId) : null;
            return (
              <div key={p.attachmentId} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="flex h-48 items-center justify-center bg-gray-50">
                  {isImage && previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- streamed from our cookie-authed API
                    <a href={previewUrl} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม"><img src={previewUrl} alt={p.fileName} className="max-h-48 max-w-full object-contain" /></a>
                  ) : (
                    <span className="text-4xl">📎</span>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="truncate text-sm font-semibold text-gray-800">{p.customerName ?? 'ลูกค้า LINE'}</div>
                  <div className="truncate text-xs text-gray-400">{p.fileName} · {fmtSize(p.byteSize)}</div>
                  <div className="text-xs text-gray-400">ตั้งค่าเมื่อ {fmtWhen(p.flaggedAt)}</div>
                  <div className="flex items-center gap-2 pt-1.5">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">รอตรวจสอบ</span>
                    <a href={`/companies/${companyId}/inbox?conversation=${p.conversationId}`} className="text-xs font-medium text-brand-700 hover:underline">เปิดแชท</a>
                    {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline">ดาวน์โหลด</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
