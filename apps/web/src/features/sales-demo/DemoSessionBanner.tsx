import Link from 'next/link';
import { formatThaiDateTime } from '@/common/i18n/thai-date';

export function DemoSessionBanner({ expiresAt }: { expiresAt?: string }) {
  return (
    <div className="sticky top-[var(--app-header-h)] z-20 flex min-w-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 sm:text-sm" role="note">
      <span className="shrink-0 whitespace-nowrap">ระบบจำลอง ข้อมูลเป็นตัวอย่าง</span>
      <span className="min-w-0 flex-1 truncate py-1" title={`ใช้ได้ถึง ${formatThaiDateTime(expiresAt)}`}>· ใช้ได้ถึง {formatThaiDateTime(expiresAt)}</span>
      <Link href="/" className="mangmee-btn mangmee-btn-secondary shrink-0">เปิดร้านจริงฟรี</Link>
    </div>
  );
}
