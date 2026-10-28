import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { HalloweenEventPage } from '@/features/public-home/HalloweenEventPage';
import { HomeStructuredData, PublicHome } from '@/features/public-home/PublicHome';
import { HOME_DESCRIPTION, HOME_TITLE, HOME_URL } from '@/features/public-home/home-content';
import { resolveHomeEventPalette } from '@/features/public-home/HomeEventTheme';
import { getGhostCard, ghostShareUrl, HALLOWEEN_URL, STANDARD_CARD_BACK } from '@/features/public-home/home-halloween-cards';
import { homeThemeForRequest } from '@/features/public-home/home-theme.server';
import '@/features/public-home/public-home.css';
import '@/features/public-home/home-events.css';
import '@/features/public-home/home-halloween-activities.css';
import '@/features/public-home/home-halloween-page.css';
import '@/features/public-home/home-halloween-game.css';
import '@/features/public-home/home-halloween-share.css';

type Props = {
  params: Promise<{ card?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function halloweenRequest({ params, searchParams }: Props) {
  const query = await searchParams;
  const { event, preview } = await homeThemeForRequest(query, process.env.NODE_ENV);
  const { card: segments } = await params;
  const card = segments?.length === 1 ? getGhostCard(segments[0]) : undefined;
  if (segments && (event !== 'halloween' || !card)) notFound();
  return { event, preview, query, card };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { event, card } = await halloweenRequest(props);
  if (event !== 'halloween') return {
    title: { absolute: HOME_TITLE }, description: HOME_DESCRIPTION,
    alternates: { canonical: HOME_URL }, robots: { index: false, follow: true },
  };
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

export default async function HalloweenPage(props: Props) {
  const { event, preview, query, card } = await halloweenRequest(props);
  if (card) return <HalloweenEventPage initialCardId={card.id} />;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const palette = resolveHomeEventPalette(preview ? query.palette : undefined);
  return <><HomeStructuredData nonce={nonce} /><PublicHome event={event} preview={preview} palette={palette} autoOpenHalloween /></>;
}
