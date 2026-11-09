import { DEMO_LINK_LIMITS } from '@watchdog-bms/contracts';

/** The browser's local wall time for a datetime-local field. */
export function localInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type DemoLinkDraft = { aiCredit: string; readLimit: string; expiresAt: string };

export function demoLinkDraftErrors(draft: DemoLinkDraft, now = Date.now()): Partial<Record<keyof DemoLinkDraft, string>> {
  const errors: Partial<Record<keyof DemoLinkDraft, string>> = {};
  const whole = (value: string, [min, max]: readonly [number, number]) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
  if (!whole(draft.aiCredit, DEMO_LINK_LIMITS.aiCredit)) errors.aiCredit = 'ใส่ 1 ถึง 300';
  if (!whole(draft.readLimit, DEMO_LINK_LIMITS.readLimit)) errors.readLimit = 'ใส่ 1 ถึง 50';
  const at = new Date(draft.expiresAt).getTime();
  if (Number.isNaN(at) || at < now + DEMO_LINK_LIMITS.minExpiryMinutes * 60_000 || at > now + DEMO_LINK_LIMITS.maxExpiryDays * 86_400_000) {
    errors.expiresAt = 'ตั้งได้ตั้งแต่ 10 นาทีจากตอนนี้ ถึง 30 วัน';
  }
  return errors;
}

