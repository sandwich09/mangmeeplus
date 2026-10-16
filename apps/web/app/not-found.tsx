'use client';

import Link from 'next/link';
import { primaryButtonClass } from '@/common/components/button';
import { BrandedState } from '@/common/components/state';
import { useLocale } from '@/common/i18n/use-locale';

export default function NotFound() {
  const [locale] = useLocale();
  const th = locale === 'th';
  return (
    <BrandedState
      // No "404": a code is not for the person (thai-ux-standard §1.4); the title says it.
      eyebrow=""
      title={th ? 'ไม่พบหน้านี้' : 'Page not found'}
      description={th ? 'ลิงก์อาจไม่ครบ หรือหน้านี้ถูกย้ายแล้ว' : 'The link may be incomplete or the page may have moved.'}
      actions={<Link href="/login" className={primaryButtonClass}>{th ? 'กลับไปหน้าแรก' : 'Back to home'}</Link>}
    />
  );
}
