import { cx } from './mangmee';

export function PrototypeDataNotice({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm font-semibold text-warning-700 shadow-[var(--shadow-theme-sm)]',
        className,
      )}
    >
      หน้านี้แสดงข้อมูลตัวอย่าง (prototype) — ยังไม่เชื่อมต่อข้อมูลจริง
    </div>
  );
}
