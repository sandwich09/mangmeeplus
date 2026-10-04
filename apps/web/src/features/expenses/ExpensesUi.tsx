'use client';

// Shared presentational primitives for the Expenses workspace, matching the
// มั่งมี mock's exact card/colour/spacing system. Real Thai copy from the feature;
// exact hex accents from the mock (mangmee brand tokens for the green shell).
import { useEffect, useRef, type ReactNode } from 'react';
import { MangmeeBadge, cx, type MangmeeTone } from '@/common/components/mangmee';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { EXPENSE_STATUS_LABELS, EXPENSE_PAYMENT_STATUS_LABELS } from './expenses.model';

/** Every expense banner goes through here, so API messages reach the user in Thai. */
export function err(e: unknown, locale: 'th' | 'en' = 'th') { return apiErrorMessage(e, locale); }
// OCR fields copy money exactly as printed on the bill, so a raw value can carry
// thousand separators ("12,500") — Number() alone would render ฿NaN.
const money = (v: string | number) => Number((typeof v === 'string' ? v.replace(/,/g, '') : v) || 0) || 0;
export const baht = (v: string | number) => '฿' + money(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const baht0 = (v: string | number) => '฿' + money(v).toLocaleString('th-TH');
export const dateShort = (v?: string | null) => formatThaiDate(v, '-');

export const inputClass = 'mangmee-input';
export const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
export const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';
export const dangerClass = 'mangmee-btn mangmee-btn-danger disabled:cursor-not-allowed disabled:opacity-50';
export const successBtn = 'mangmee-btn text-white disabled:cursor-not-allowed disabled:opacity-50';
export const successBtnStyle = { background: 'linear-gradient(150deg,var(--color-brand-700),var(--color-brand-800))', borderColor: 'var(--color-brand-700)' } as const;

// ── icons (inline SVG, 1.8 stroke — matches the mock's this.ic() set) ─────────
function mk(paths: string) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      {paths.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
export const ICON = {
  receipt: mk('M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3Z|M8 8h8M8 12h6'),
  clock: mk('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z|M12 7v5l3.5 2'),
  wallet: mk('M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z|M16 12h4v-2h-4a1 1 0 0 0 0 2Z'),
  alert: mk('M12 3 2 20h20Z|M12 9v5|M12 17.5v.5'),
  doc: mk('M6 2h8l4 4v16H6Z|M14 2v4h4|M9 12h6M9 16h6'),
  file: mk('M6 2h8l4 4v16H6Z|M14 2v4h4'),
  upload: mk('M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4|M12 16V4|M8 8l4-4 4 4'),
  sparkle: mk('M12 3l1.6 5L19 9.5l-5.4 1.5L12 16l-1.6-5L5 9.5l5.4-1.5Z'),
  edit: mk('M4 20h4L18 10a2 2 0 0 0-2.8-2.8L4.5 17.5 4 20Z|M14 6l4 4'),
  eye: mk('M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z|M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'),
  search: mk('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|M21 21l-4.3-4.3'),
  trash: mk('M4 7h16|M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2|M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13'),
  signature: mk('M3 17c3-1 4-9 6-9s2 6 3 6 2-4 3-4 1 2 2 2M3 20h18'),
  folder: mk('M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z'),
  download: mk('M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4|M12 4v12|M8 12l4 4 4-4'),
};

// ── exact-hex KPI stat card (mock expSummaryCards) ───────────────────────────
export function StatCard({ icon, label, value, sub, color, bg, danger }: {
  icon: ReactNode; label: ReactNode; value: ReactNode; sub?: ReactNode; color: string; bg: string; danger?: boolean;
}) {
  return (
    <div className="h-full min-w-0 [container-type:inline-size]">
      <div className="flex h-full flex-col items-start gap-3 rounded-2xl border bg-white p-4 @[18rem]:flex-row" style={{ borderColor: danger ? '#FECDCA' : 'var(--color-gray-200)' }}>
        {/* 48px frame with a 24px glyph: the ICON set hardcodes h-5 w-5, so the
            child-combinator override (higher specificity) scales it up here only. */}
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl [&>svg]:h-6 [&>svg]:w-6" style={{ background: bg, color }}>{icon}</span>
        <div className="ml-auto w-full min-w-0 text-right [container-type:inline-size]">
          <div className="text-[clamp(1.125rem,12cqi,1.625rem)] font-extrabold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]" style={{ color: danger ? '#D92D20' : 'var(--color-gray-900)' }}>{value}</div>
          <div className="mt-2 text-sm font-semibold text-gray-700">{label}</div>
          {sub != null && <div className="mt-0.5 text-[12.5px] text-gray-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── status → mangmee tone ────────────────────────────────────────────────────
export const STATUS_TONE: Record<string, MangmeeTone> = {
  DRAFT: 'slate', EXTRACTING: 'sky', NEEDS_REVIEW: 'amber', READY_FOR_CONFIRMATION: 'indigo',
  CONFIRMED: 'brand', REJECTED: 'danger', VOIDED: 'slate',
  UNPAID: 'danger', PARTIALLY_PAID: 'amber', PAID: 'brand',
  POSSIBLE_DUPLICATE: 'amber', CONFIRMED_DUPLICATE: 'danger',
};
export function TAX_TONE(status: string): MangmeeTone {
  if (status === 'READY' || status === 'FULL_TAX_INVOICE') return 'purple';
  if (status === 'SUPPORTING_ONLY' || status === 'NON_TAXABLE') return 'slate';
  return 'amber';
}
export function StatusBadge({ status }: { status: string }) {
  const otherLabels: Record<string, string> = {
    NOT_CHECKED: 'ยังไม่ตรวจรายการซ้ำ', NO_MATCH: 'ไม่พบรายการซ้ำ', POSSIBLE_DUPLICATE: 'อาจเป็นรายการซ้ำ',
    CONFIRMED_DUPLICATE: 'ยืนยันว่าเป็นรายการซ้ำ', OVERRIDDEN: 'ตรวจและยืนยันแล้ว',
    NOT_VERIFIED: 'ยังไม่ตรวจด้วย AI', VERIFYING: 'AI กำลังตรวจ', AI_VERIFIED: 'AI ตรวจแล้ว', PARTIAL: 'ข้อมูลบางส่วน',
    HUMAN_VERIFIED: 'ผู้ตรวจยืนยันแล้ว', FAILED: 'ดำเนินการไม่สำเร็จ',
  };
  const label = (EXPENSE_STATUS_LABELS as Record<string, string>)[status]
    ?? (EXPENSE_PAYMENT_STATUS_LABELS as Record<string, string>)[status]
    ?? otherLabels[status]
    ?? 'สถานะอื่น';
  return <MangmeeBadge tone={STATUS_TONE[status] ?? 'slate'}>{label}</MangmeeBadge>;
}

// ── banners ──────────────────────────────────────────────────────────────────
// A11Y-01: `role="alert"` here, not at each call site — the banner only ever mounts when there is
// something to say, and every expense screen renders its errors through this one component.
export function ErrorBanner({ message, focus = false }: { message: string; focus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.scrollIntoView({ block: 'center' });
    ref.current?.focus({ preventScroll: true });
  }, [message, focus]);
  return <div ref={ref} tabIndex={-1} role="alert" className="whitespace-pre-line rounded-xl border border-[#FECDCA] bg-error-50 px-4 py-3 text-sm font-medium text-error-700">⚠ {message}</div>;
}
export function InfoBanner({ message }: { message: string }) {
  return <div className="rounded-xl border border-brand-100 bg-brand-25 px-4 py-3 text-sm font-medium text-brand-700">{message}</div>;
}
export function isForbidden(message: string): boolean {
  return /Insufficient permissions|Missing permission|Forbidden/i.test(message);
}
export function StateBanner({ error }: { error: string | null }) {
  if (!error) return null;
  if (isForbidden(error)) return <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">🔒 คุณไม่มีสิทธิ์เข้าถึงส่วนนี้</div>;
  return <ErrorBanner message={error} />;
}

// ── "how this works" numbered-step strip (mock brand-25 explainer) ───────────
export function HowItWorks({ title, description, steps }: { title?: string; description?: string; steps: string[] }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-25 p-4">
      {title && <h2 className="mb-3 text-sm font-bold text-gray-900">{title}</h2>}
      {description && <p className="mb-3 text-sm leading-relaxed text-gray-600">{description}</p>}
      <ol className="grid gap-3 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step} className="flex min-w-0 items-start gap-3 rounded-xl border border-brand-100 bg-white p-4 text-sm font-semibold leading-6 text-gray-700">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-extrabold text-white">{index + 1}</span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// mock KPI palette (exact hexes)
export const KPI = {
  amber: { color: '#B54708', bg: '#FEF0D9' },
  sky: { color: '#0BA5EC', bg: '#F0F9FF' },
  purple: { color: '#6941C6', bg: '#F4EBFF' },
  danger: { color: '#D92D20', bg: '#FEE4E2' },
  brand: { color: '#027A48', bg: '#DCFCE7' },
} as const;
