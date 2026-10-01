'use client';

// "บัญชีรับเงินคืนของฉัน": a member sets the account their claims are paid back into. Reached from
// the reimbursement hub and the claim form; it needs no access to the employee pages.

import Link from 'next/link';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { EmptyState } from '@/common/components/state';
import { MemberPayoutAccountCard } from './ReimbursementPayout';

export function ReimbursementPayoutAccountPage({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const hubHref = `/companies/${companyId}/reimbursements`;
  return (
    <MangmeePage
      eyebrow={<Link href={hubHref}>← กลับไปการเบิกจ่าย</Link>}
      title="บัญชีรับเงินคืนของฉัน"
      description="ตั้งครั้งเดียว ใบเบิกใหม่จะใช้บัญชีนี้เอง ใบที่ส่งไปแล้วใช้บัญชีที่บันทึกไว้กับใบนั้น ไม่เปลี่ยนตาม"
    >
      {canManage ? (
        <MemberPayoutAccountCard
          companyId={companyId}
          canEdit
          title="บัญชีรับเงินคืนประจำ"
          description="ผู้อนุมัติจะเห็นชื่อบัญชี ธนาคาร และ 4 ตัวท้าย เลขเต็มเปิดดูได้เฉพาะคุณ ผู้อนุมัติของใบนั้น และผู้ที่บันทึกจ่าย"
        />
      ) : (
        <MangmeeCard className="p-6">
          <EmptyState title="ยังตั้งบัญชีรับเงินคืนไม่ได้" description="บัญชีนี้ยังไม่มีสิทธิ์สร้างคำขอเบิก กรุณาติดต่อเจ้าของกิจการหรือแอดมิน" />
        </MangmeeCard>
      )}
    </MangmeePage>
  );
}
