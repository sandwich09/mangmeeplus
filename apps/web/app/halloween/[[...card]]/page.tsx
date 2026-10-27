import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HalloweenEventPage } from '@/features/public-home/HalloweenEventPage';
import { getGhostCard, ghostShareUrl, HALLOWEEN_URL, STANDARD_CARD_BACK } from '@/features/public-home/home-halloween-cards';
import { homeThemeForRequest } from '@/features/public-home/home-theme.server';
import '@/features/public-home/home-halloween-page.css';
import '@/features/public-home/home-halloween-game.css';
import '@/features/public-home/home-halloween-share.css';

type Props = {
  params: Promise<{ card?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function requireHalloween(searchParams: Props['searchParams']) {
  const { event } = await homeThemeForRequest(await searchParams, process.env.NODE_ENV);
  if (event !== 'halloween') notFound();
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  await requireHalloween(searchParams);
  const { card: segments } = await params;
  const card = segments?.length === 1 ? getGhostCard(segments[0]) : undefined;
  const title = card ? `ฮาโลวีนนี้ฉันเป็น ${card.name} | มั่งมีพลัส` : 'กระจกเผยร่างผี — ฮาโลวีนกับมั่งมีพลัส';
  const description = card ? `${card.tag} — แล้วคุณล่ะ เป็นผีอะไร? เปิดกระจกเพื่อเผยร่างของคุณ` : 'เปิดกระจกเผยร่างผีจากโลกวิญญาณ และค้นหา SECRET ของน้องมั่งมี';
  const url = card ? ghostShareUrl(card) : HALLOWEEN_URL;
  const image = `https://mangmeeplus.com${card?.image ?? STANDARD_CARD_BACK}`;
  return {
    title: { absolute: title }, description, alternates: { canonical: url },
    robots: { index: false, follow: true },
    openGraph: { type: 'website', locale: 'th_TH', title, description, url, siteName: 'มั่งมีพลัส', images: [{ url: image, width: 1122, height: 1402, alt: card?.name ?? 'กระจกเผยร่างผี' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function HalloweenPage({ params, searchParams }: Props) {
  await requireHalloween(searchParams);
  const { card } = await params;
  if (card && (card.length !== 1 || !getGhostCard(card[0]))) notFound();
  return <HalloweenEventPage initialCardId={card?.[0]} />;
}
