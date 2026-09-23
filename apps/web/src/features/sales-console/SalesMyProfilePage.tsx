'use client';
import { useEffect, useState } from 'react';
import type { SalesAgentProfileDto } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { getMySalesProfile, updateMySalesProfile } from './sales.api';
import { SalesNotice } from './SalesConsoleParts';
import { SalesProfileEditor } from './SalesProfileEditor';

export default function SalesMyProfilePage() {
  const [profile, setProfile] = useState<SalesAgentProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getMySalesProfile({ signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setProfile(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause)); });
    return () => controller.abort();
  }, []);
  return <MangmeePage eyebrow="ทีมขายมั่งมี" title="ข้อมูลของฉัน"
    description="ตรวจสอบและแก้ไขที่อยู่ ข้อมูลภาษี และบัญชีธนาคารสำหรับรับค่าคอมมิชชัน">
    {error && <SalesNotice tone="error">{error}</SalesNotice>}
    {saved && <SalesNotice tone="info">บันทึกข้อมูลเรียบร้อยแล้ว</SalesNotice>}
    {!profile && !error && <LoadingState label="กำลังโหลดข้อมูล…" />}
    {profile && <MangmeeCard><div className="p-4 sm:p-6">
      <SalesProfileEditor initial={profile} admin={false} onSave={async (value) => {
        const { whtRatePercent: _whtRatePercent, ...ownFields } = value;
        setSaved(false);
        setProfile(await updateMySalesProfile(ownFields));
        setSaved(true);
      }} />
    </div></MangmeeCard>}
  </MangmeePage>;
}
