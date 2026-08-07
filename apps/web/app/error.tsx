'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { BrandedState } from '@/common/components/state';
import { Button } from '@/common/components/button';
import { useLocale } from '@/common/i18n/use-locale';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale] = useLocale();
  const th = locale === 'th';

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <BrandedState
      eyebrow={th ? 'ระบบขัดข้องชั่วคราว' : 'Temporary problem'}
      title={th ? 'ไม่สามารถเปิดหน้านี้ได้' : 'We could not open this page'}
      description={th ? 'ระบบหรือการเชื่อมต่ออาจขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' : 'The service or connection may be temporarily unavailable. Please try again.'}
    >
      <Button type="button" onClick={reset}>{th ? 'ลองอีกครั้ง' : 'Try again'}</Button>
      <Link href="/login" className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
        {th ? 'กลับหน้าหลัก' : 'Back to home'}
      </Link>
    </BrandedState>
  );
}
