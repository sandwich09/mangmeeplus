export type EscapeColor = 'amber' | 'violet' | 'green';
export type EscapeRune = 'moon' | 'star' | 'sun';

export type EscapeKey = { id: string; rune: EscapeRune; color: EscapeColor };
export type EscapeRound = {
  portraitIndex: number;
  rune: EscapeRune;
  candleSequence: EscapeColor[];
  clueColor: EscapeColor;
  keys: EscapeKey[];
  correctKeyId: string;
};

export type EscapeTier = {
  id: 'trapped' | 'narrow' | 'solver' | 'conqueror';
  title: string;
};

export const ESCAPE_RUNES: Record<EscapeRune, { symbol: string; label: string }> = {
  moon: { symbol: '☾', label: 'จันทร์เสี้ยว' },
  star: { symbol: '✦', label: 'ดาว' },
  sun: { symbol: '☀', label: 'พระอาทิตย์' },
};

export const ESCAPE_COLORS: Record<EscapeColor, { label: string; hex: string }> = {
  amber: { label: 'สีส้ม', hex: '#f3b95f' },
  violet: { label: 'สีม่วง', hex: '#b998e8' },
  green: { label: 'สีเขียว', hex: '#80c6a0' },
};

export function escapeAudioPressure(secondsLeft: number) {
  if (secondsLeft > 15) return { rate: 1, gain: .045, tick: false };
  if (secondsLeft > 5) return { rate: 1.18, gain: .055, tick: false };
  return { rate: 1.42, gain: .065, tick: secondsLeft > 0 };
}

const runes = Object.keys(ESCAPE_RUNES) as EscapeRune[];
const colors = Object.keys(ESCAPE_COLORS) as EscapeColor[];

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function shuffle<T>(items: T[], random: () => number) {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function key(rune: EscapeRune, color: EscapeColor): EscapeKey {
  return { id: `${rune}-${color}`, rune, color };
}

export function makeEscapeRound(random = Math.random): EscapeRound {
  const rune = pick(runes, random);
  const candleSequence = Array.from({ length: 3 }, () => pick(colors, random));
  const clueColor = candleSequence[2];
  const correct = key(rune, clueColor);
  const alternatives = shuffle(
    runes.flatMap(candidateRune => colors.map(candidateColor => key(candidateRune, candidateColor)))
      .filter(candidate => candidate.id !== correct.id),
    random,
  ).slice(0, 2);
  return {
    portraitIndex: Math.min(5, Math.floor(random() * 6)),
    rune,
    candleSequence,
    clueColor,
    keys: shuffle([correct, ...alternatives], random),
    correctKeyId: correct.id,
  };
}

export function escapeTier(escaped: boolean, secondsLeft: number): EscapeTier {
  if (!escaped) return { id: 'trapped', title: 'สมาชิกใหม่ของคฤหาสน์' };
  if (secondsLeft <= 10) return { id: 'narrow', title: 'รอดแบบเส้นยาแดง' };
  if (secondsLeft <= 30) return { id: 'solver', title: 'นักไขปริศนาแห่งโลกวิญญาณ' };
  return { id: 'conqueror', title: 'ผู้พิชิตคฤหาสน์ไร้ทางออก' };
}

export function applyEscapePenalty(endAt: number) {
  return endAt - 5000;
}

export function escapeElapsedSeconds(secondsLeft: number) {
  return Math.max(0, 60 - secondsLeft);
}

export function escapeCaption(escaped: boolean, secondsLeft: number) {
  const detail = escaped ? `ฉันหนีออกมาได้ใน ${escapeElapsedSeconds(secondsLeft)} วินาที` : 'ฉันติดอยู่ในคฤหาสน์ไร้ทางออก';
  return [detail, escapeTier(escaped, secondsLeft).title, 'กล้าเข้าคฤหาสน์นี้ไหม?', 'https://mangmeeplus.com/halloween'].join('\n');
}
