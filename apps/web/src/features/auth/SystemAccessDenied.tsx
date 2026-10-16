'use client';

import Link from 'next/link';
import { primaryButtonClass } from '@/common/components/button';
import { BrandedState, ForbiddenState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useLocale } from '@/common/i18n/use-locale';

export default function SystemAccessDenied({ executive = false }: { executive?: boolean }) {
  const [locale] = useLocale();
  if (executive) return <ForbiddenState title={apiErrorMessage({ code: 'EXECUTIVE_ACCESS_DENIED' })} description="" helpText="" />;
  const th = locale === 'th';
  return (
    <BrandedState
      eyebrow={th ? 'สิทธิ์ผู้ดูแลระบบ' : 'Platform access'}
      title={th ? 'ไม่มีสิทธิ์เข้าถึง' : 'Access denied'}
      description={th
        ? 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงส่วนผู้ดูแลแพลตฟอร์ม ถ้าคิดว่าไม่ถูกต้อง ติดต่อผู้ดูแลระบบ'
        : 'This account cannot access the platform admin area. Contact a system administrator if you believe this is incorrect.'}
      actions={<Link href="/login" className={primaryButtonClass}>{th ? 'กลับไปยังพื้นที่ทำงาน' : 'Back to workspace'}</Link>}
    />
  );
}
