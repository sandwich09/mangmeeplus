export function ExpenseCertificateCorrectionNote({ onReopen, busy = false }: { onReopen?: () => void; busy?: boolean }) {
  if (!onReopen) return null;
  return <div className="text-sm leading-6 text-gray-700 sm:col-span-2">
    <span>ถ้าส่วนนี้ผิด </span>
    {onReopen && <button type="button" className="min-h-11 underline underline-offset-2" disabled={busy} aria-busy={busy} onClick={onReopen}>แก้ไขเอกสาร</button>}
  </div>;
}
