import Link from 'next/link';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { HOME_CONTACT_URL } from '@/features/public-home/home-content';
import { DemoRetryButton } from '@/features/sales-demo/DemoRetryButton';

export const dynamic = 'force-dynamic';

export default async function DemoExpiredPage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const unavailable = (await searchParams).reason === 'unavailable';
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-amber-50 p-6 text-center">
      <img src="/home/mangmee-reviewing.webp" width="240" height="160" alt="น้องมั่งมี" />
      <h1 className="text-xl font-semibold leading-relaxed text-gray-900">{unavailable
        ? 'ตอนนี้เปิดเดโม่ไม่ได้ชั่วคราวค่ะ ลองกดลิงก์เดิมอีกครั้งในอีกสักครู่นะคะ'
        : 'ลิงก์เดโม่นี้หมดอายุแล้วค่ะ'}</h1>
      <ActionGroup align="center">
        <Link href="/" className="mangmee-btn mangmee-btn-quiet">เปิดร้านจริงฟรี</Link>
        <a href={HOME_CONTACT_URL} className={`mangmee-btn mangmee-btn-${unavailable ? 'secondary' : 'primary'}`}>คุยกับทีมดูแล</a>
        {unavailable && <DemoRetryButton />}
      </ActionGroup>
    </main>
  );
}
