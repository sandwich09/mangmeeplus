'use client';

import { MangmeeBadge } from '@/common/components/mangmee';
import { checklistIsComplete } from './company-profile.logic';
import { useProfileChecklist } from './use-profile-checklist';

/**
 * "ยังไม่ครบ" on the ข้อมูลร้าน card of the settings hub (§15.4.1 E; the same word as the menu row and the home card), so the
 * owner of a shop opened from LINE can see there is something to finish without opening the page.
 *
 * A client island inside a server page. Nothing while the answer is unknown and nothing once the
 * checklist is complete — a badge that is always there says nothing. The caller renders this only
 * for a holder of `company.legal_identity.manage`, so nobody who could not act on the answer pays
 * for the read.
 */
export function ProfileAttentionBadge({ companyId }: { companyId: string }) {
  const items = useProfileChecklist(companyId);

  if (!items || checklistIsComplete(items)) return null;

  return <MangmeeBadge tone="amber">ยังไม่ครบ</MangmeeBadge>;
}
