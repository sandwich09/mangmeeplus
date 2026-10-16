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
    // One short form: it keeps a reading width on a wide screen instead of stretching a phone layout across it.
    <MangmeePage
      back={<BackToClaimsLink href={hubHref} />}
      title="บัญชีรับเงินคืนของฉัน"
      description="ใบเบิกใหม่ใช้บัญชีนี้เอง"
    >
      {canManage ? (
        <>
          {/* Who sees the number and what a change leaves alone are said in the card, where each applies (the form, the message after a save). */}
          <MemberPayoutAccountCard key={defaultReload} companyId={companyId} canEdit title="บัญชีรับเงินคืนประจำ" />
          <SavedPayoutAccountsCard companyId={companyId} onDefaultChanged={() => setDefaultReload(value => value + 1)} />
        </>
      ) : (
        // The way out of this refusal is the back link above it.
        <MangmeeCard className="p-6">
          <EmptyState title="ยังตั้งบัญชีรับเงินคืนไม่ได้" description={`บัญชีนี้ยังไม่มีสิทธิ์สร้างใบเบิก ติดต่อ${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN}`} />
        </MangmeeCard>
      )}
    </MangmeePage>
  );
}
