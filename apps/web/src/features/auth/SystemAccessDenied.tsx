'use client';

import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { useLocale } from '@/common/i18n/use-locale';

export default function SystemAccessDenied() {
  const [locale] = useLocale();
  const th = locale === 'th';
  return (
    <BrandedState
      eyebrow={th ? 'สิทธิ์ผู้ดูแลระบบ' : 'Platform access'}
      title={th ? 'ไม่มีสิทธิ์เข้าถึง' : 'Access denied'}
      description={th
        ? 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงส่วนผู้ดูแลแพลตฟอร์ม กรุณาติดต่อผู้ดูแลระบบหากคิดว่าเกิดข้อผิดพลาด'
        : 'This account cannot access the platform admin area. Contact a system administrator if you believe this is incorrect.'}
    >
      <Link href="/login" className="inline-flex h-10 items-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-800">
        {th ? 'กลับไปยังพื้นที่ทำงาน' : 'Back to workspace'}
      </Link>
    </BrandedState>
  );
}
