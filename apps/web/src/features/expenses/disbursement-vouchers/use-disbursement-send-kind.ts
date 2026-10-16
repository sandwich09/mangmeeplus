import { useEffect, useState } from 'react';
import { listDisbursementApprovers } from './disbursement-vouchers.api';

export function useDisbursementSendKind(companyId: string, branchId: string | null | undefined, canSelfApprove: boolean, viewerUserId?: string | null) {
  const [soleSelfBranch, setSoleSelfBranch] = useState<string | null>(null);
  useEffect(() => {
    setSoleSelfBranch(null);
    if (!canSelfApprove || !branchId || !viewerUserId) return;
    let active = true;
    void listDisbursementApprovers(companyId, branchId).then(people => {
      if (active && people.length === 1 && people[0]!.userId === viewerUserId) setSoleSelfBranch(branchId);
    }).catch(() => {}); // The dialog owns the read error and retry.
    return () => { active = false; };
  }, [companyId, branchId, canSelfApprove, viewerUserId]);
  return canSelfApprove && branchId && soleSelfBranch === branchId ? 'selfApprove' as const : 'submit' as const;
}
