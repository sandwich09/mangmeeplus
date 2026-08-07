import { redirect } from 'next/navigation';

// Company-signature stamping is feature-disabled (owner decision 2026-08-05): approved assets
// had no consumer, so the screen is parked. API and stored assets stay intact; the substitute
// receipt flow uses its own per-certificate signatures and is unaffected.
export default async function ExpensesSignaturesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/companies/${companyId}/expenses`);
}
