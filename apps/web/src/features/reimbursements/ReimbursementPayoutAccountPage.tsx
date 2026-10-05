'use client';
import { useState } from 'react';
import { SavedPayoutAccountsCard } from './SavedPayoutAccountsCard';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

// "บัญชีรับเงินคืนของฉัน": a member sets the account their claims are paid back into. Reached from
// the reimbursement hub and the claim form; it needs no access to the employee pages.

import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { EmptyState } from '@/common/components/state';
import { BackToClaimsLink, MemberPayoutAccountCard } from './ReimbursementPayout';

export function ReimbursementPayoutAccountPage({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const [defaultReload, setDefaultReload] = useState(0);
  const hubHref = `/companies/${companyId}/reimbursements`;
  return (
    <MangmeePage
      eyebrow={<BackToClaimsLink href={hubHref} />}
      title="บัญชีรับเงินคืนของฉัน"
      description="ตั้งครั้งเดียว ใบเบิกใหม่จะใช้บัญชีนี้เอง ใบที่ส่งไปแล้วใช้บัญชีที่บันทึกไว้กับใบนั้น ไม่เปลี่ยนตาม"
    >
      {canManage ? (
        <>
          <MemberPayoutAccountCard key={defaultReload}
            companyId={companyId}
            canEdit
            title="บัญชีรับเงินคืนประจำ"
            description="ผู้อนุมัติจะเห็นชื่อบัญชี ธนาคาร และ 4 ตัวท้าย เลขเต็มเปิดดูได้เฉพาะคุณ ผู้อนุมัติของใบนั้น และผู้ที่บันทึกจ่าย"
          />
          <SavedPayoutAccountsCard companyId={companyId} onDefaultChanged={() => setDefaultReload(value => value + 1)} />
        </>
      ) : (
        <MangmeeCard className="p-6">
          <EmptyState title="ยังตั้งบัญชีรับเงินคืนไม่ได้" description={`บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิก กรุณาติดต่อ${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}`} />
        </MangmeeCard>
      )}
    </MangmeePage>
  );
}
