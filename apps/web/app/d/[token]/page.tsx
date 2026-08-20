import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { internalApiV1Base } from '@/common/api/internal-api-base';
import { forwardedClientHeaders } from '@/common/api/forwarded-client-headers';
import { BrandedState } from '@/common/components/state';

// Spec §12.4/§12.5 — the delivery page is PUBLIC and session-less, and it lives here rather than
// under /companies/… precisely so it can never drift into the authenticated shell. `proxy.ts`
// protects only /companies, /system and /legal-acceptance, so this route needs no allowlist entry.
export const dynamic = 'force-dynamic';

// The URL is a credential handed to one person. Nothing about it belongs in a search index.
export const metadata = { robots: { index: false, follow: false } };

type Resolution = { status?: unknown; url?: unknown };

/** The local storage adapter signs a path on the API origin; S3 signs an absolute URL. */
function absoluteTarget(url: string): string {
  return new URL(url, internalApiV1Base().replace(/\/v1$/, '')).toString();
}

export default async function DocumentDeliveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let resolution: Resolution | undefined;
  try {
    // §14: the audited open must name the visitor's IP, not this container's. Without the forwarded
    // chain every row reads as the web tier.
    const response = await fetch(`${internalApiV1Base()}/document-delivery/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      headers: forwardedClientHeaders(await headers()),
    });
    if (response.ok) resolution = (await response.json()) as Resolution;
  } catch {
    // An unreachable API is indistinguishable from an expired link on this page, and both get the
    // same copy: no document data either way.
  }

  if (resolution?.status === 'OK' && typeof resolution.url === 'string') {
    redirect(absoluteTarget(resolution.url));
  }

  // §15: no document number, no amount, no payee, no reason. A page that named the document would
  // hand an expired token exactly the information the token was protecting.
  return (
    <BrandedState
      eyebrow="ลิงก์เอกสาร"
      title="ลิงก์นี้ใช้ไม่ได้แล้ว"
      description="ลิงก์ดาวน์โหลดเอกสารมีอายุ 3 วัน และอาจถูกยกเลิกไปแล้ว ขอลิงก์ใหม่ได้ตลอดโดยพิมพ์ “ขอลิงก์ใหม่” ในแชท LINE ของน้องมั่งมี — หน้านี้เปิดโดยไม่ต้องเข้าสู่ระบบ จึงออกลิงก์ใหม่ให้ที่นี่ไม่ได้"
    />
  );
}
