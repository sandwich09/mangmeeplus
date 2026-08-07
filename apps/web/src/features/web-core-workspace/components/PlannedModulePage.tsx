// Server component — no 'use client'
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';

interface PlannedModulePageProps {
  moduleName: string;
  companyId: string;
}

export function PlannedModulePage({ moduleName, companyId }: PlannedModulePageProps) {
  return (
    <MangmeePage
      eyebrow="กำลังเตรียมเปิดใช้งาน"
      title={moduleName}
      description="ทีมของคุณจะเห็นข้อมูลและการทำงานของโมดูลนี้ที่นี่เมื่อเปิดใช้งานแล้ว"
      meta={<MangmeeBadge tone="slate">{companyId}</MangmeeBadge>}
    >
      <MangmeeCard className="flex min-h-[320px] items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xl font-extrabold text-amber-700">
            !
          </div>
          <h2 className="text-lg font-bold text-gray-900">ยังไม่มี workflow ที่เปิดใช้งานจริง</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            หากต้องการใช้งานส่วนนี้ ให้เปิดสิทธิ์และตั้งค่าข้อมูลพื้นฐานของบริษัทให้ครบก่อน
          </p>
        </div>
      </MangmeeCard>
    </MangmeePage>
  );
}
