import { MangmeePage } from '@/common/components/mangmee';
import { fetchServerSession } from '@/common/auth/server-session';
import { SettingsMenu } from '@/features/web-core-workspace/SettingsMenu';
import { ProfileAttentionBadge } from '@/features/company-profile/ProfileAttentionBadge';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  // §15.4.1 E: only the people who can act on the answer, so nobody else pays for the read.
  const showProfileAttention = session?.permissions?.includes('company.legal_identity.manage') ?? false;

  return (
    <MangmeePage title="ตั้งค่า" description="จัดการบริษัท พนักงาน สิทธิ์ สาขา และความปลอดภัยของบัญชีจากศูนย์กลางเดียว">
      {/* Which cards a locked shop keeps is decided inside: only the shell knows it is locked. */}
      <SettingsMenu
        companyId={companyId}
        permissions={session?.permissions ?? []}
        profileBadge={showProfileAttention ? <ProfileAttentionBadge companyId={companyId} /> : null}
      />
    </MangmeePage>
  );
}
