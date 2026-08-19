'use client';

import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { useLocale } from '@/common/i18n/use-locale';

export default function NotFound() {
  const [locale] = useLocale();
  const th = locale === 'th';
  return (
    <BrandedState
      eyebrow="404"
      title={th ? 'ไม่พบหน้าที่คุณต้องการ' : 'Page not found'}
      description={th ? 'ลิงก์นี้อาจไม่ถูกต้องหรือหน้าดังกล่าวถูกย้ายแล้ว' : 'The link may be incorrect or the page may have moved.'}
    >
      <Link href="/login" className="inline-flex h-11 items-center justify-center sm:h-10 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-800">
        {th ? 'กลับหน้าหลัก' : 'Back to home'}
      </Link>
    </BrandedState>
  );
}
