import { redirect } from 'next/navigation';

// Account-security screen is feature-disabled (owner decision 2026-08-05). The change-password
// form lives at /change-password; recovery email + session tooling return when the feature ships.
export default async function SettingsSecurityPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/companies/${companyId}/dashboard`);
}
