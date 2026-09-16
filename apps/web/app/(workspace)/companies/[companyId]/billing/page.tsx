import BillingPage from '@/features/billing/BillingPage';
export default async function CompanyBillingRoute({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ collection?: string | string[] }> }) {
  const { companyId } = await params;
  const { collection } = await searchParams;
  const collectionId = typeof collection === 'string' && /^[a-f0-9-]{36}$/i.test(collection) ? collection : undefined;
  const previewHref = process.env.NODE_ENV === 'development' && process.env.APP_ENV === 'local' ? `/companies/${encodeURIComponent(companyId)}/billing/preview` : undefined;
  return <BillingPage key={companyId} companyId={companyId} collectionId={collectionId} previewHref={previewHref} />;
}
