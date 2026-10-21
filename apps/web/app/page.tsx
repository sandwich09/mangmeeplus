import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PublicHome, HomeStructuredData } from '@/features/public-home/PublicHome';
import { HOME_DESCRIPTION, HOME_TITLE, HOME_URL } from '@/features/public-home/home-content';
import '@/features/public-home/public-home.css';

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE }, description: HOME_DESCRIPTION,
  alternates: { canonical: HOME_URL, types: { 'text/plain': '/llms.txt' } },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', locale: 'th_TH', url: HOME_URL, siteName: 'มั่งมีพลัส (MangmeePlus)', title: HOME_TITLE, description: HOME_DESCRIPTION,
    images: [{ url: '/home/spending-dashboard.webp', width: 1200, height: 750, alt: 'ตัวอย่างหน้าสรุปรายจ่ายของร้านในมั่งมีพลัส' }] },
  twitter: { card: 'summary_large_image', title: HOME_TITLE, description: HOME_DESCRIPTION, images: ['/home/spending-dashboard.webp'] },
};

export default async function HomePage() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <><HomeStructuredData nonce={nonce} /><PublicHome /></>;
}
