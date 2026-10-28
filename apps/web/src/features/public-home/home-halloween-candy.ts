export type CandyKind = 'ordinary' | 'gold' | 'cursed' | 'thief';

export type CandyTier = {
  id: 'sad' | 'trainee' | 'sweet' | 'royal';
  title: string;
  image: string;
};

export const CANDY_TIERS: readonly CandyTier[] = [
  { id: 'sad', title: 'มาขอลูกอม หรือมาชมบ้าน?', image: '/home/events/halloween/candy/level-1-sad.png' },
  { id: 'trainee', title: 'นักล่าลูกอมฝึกหัด', image: '/home/events/halloween/candy/level-2-trainee.png' },
  { id: 'sweet', title: 'หวานจนผียังเรียกพี่', image: '/home/events/halloween/candy/level-3-sweet.png' },
  { id: 'royal', title: 'ราชาแห่งคืนปล่อยผี', image: '/home/events/halloween/candy/level-4-royal.png' },
];

export function candyTier(score: number) {
  return CANDY_TIERS[score <= 10 ? 0 : score <= 25 ? 1 : score <= 40 ? 2 : 3];
}

export function candyScore(score: number, kind: CandyKind, missed = false) {
  const change = kind === 'ordinary' ? 1 : kind === 'gold' ? 5 : kind === 'cursed' ? -3 : missed ? -2 : 0;
  return Math.max(0, score + change);
}

export function candySpawnDelay(combo: number, secondsLeft: number) {
  if (secondsLeft <= 5) return 190;
  if (secondsLeft <= 20) return Math.max(300, 540 - combo * 18);
  return Math.max(360, 720 - combo * 24);
}

export function candyMusicRate(secondsLeft: number) {
  return secondsLeft <= 5 ? 1.3 : secondsLeft <= 20 ? 1.15 : 1;
}

export function candyCaption(score: number) {
  return [`ฉันเก็บลูกอมได้ ${score} คะแนน`, candyTier(score).title, 'กล้าทำลายสถิติฉันไหม?', 'https://mangmeeplus.com/halloween'].join('\n');
}
