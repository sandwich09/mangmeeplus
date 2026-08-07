import { redirect } from 'next/navigation';

// Canonical route is settings/notifications (nav registry + settings submenu);
// this path stays as a redirect for any existing deep links.
export default async function NotificationPreferencesRoutePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/companies/${companyId}/settings/notifications`);
}
