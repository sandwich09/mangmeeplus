export const HALLOWEEN_GAME_DEADLINES = {
  candy: Date.parse('2026-10-29T00:00:00+07:00'),
  escape: Date.parse('2026-10-30T00:00:00+07:00'),
} as const;

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };

export function countdownParts(deadline: number, now: number): CountdownParts | null {
  const secondsLeft = Math.ceil((deadline - now) / 1000);
  if (secondsLeft <= 0) return null;
  const days = Math.floor(secondsLeft / 86_400);
  const hours = Math.floor(secondsLeft % 86_400 / 3_600);
  const minutes = Math.floor(secondsLeft % 3_600 / 60);
  const seconds = secondsLeft % 60;
  return { days, hours, minutes, seconds };
}

export function formatCountdown({ days, hours, minutes, seconds }: CountdownParts) {
  return `${days} วัน ${[hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')}`;
}
