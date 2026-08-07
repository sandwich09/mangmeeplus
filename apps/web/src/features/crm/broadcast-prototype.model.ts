// บรอดแคสต์ prototype logic — transcribed 1:1 from the
// `// ===== บรอดแคสต์ (AI content + poster) =====` block of
// `design_handoff_mangmee/มั่งมี Flow A.dc.html` (ทุกสาขา scope).

import { CRM_CUSTOMERS, type CustomerTier } from './mangmee-crm-data';

export type BroadcastSegmentId = 'all' | CustomerTier;

export const BROADCAST_SEGMENTS: { id: BroadcastSegmentId; label: string; desc: string }[] = [
  { id: 'all', label: 'ลูกค้าทั้งหมด', desc: 'ทุกคนที่ติดตาม LINE OA' },
  { id: 'vip', label: 'VIP', desc: 'ลูกค้าระดับ VIP' },
  { id: 'active', label: 'ลูกค้าประจำ', desc: 'ซื้อซ้ำสม่ำเสมอ' },
  { id: 'lead', label: 'ลูกค้าใหม่', desc: 'ยังไม่เคยซื้อ' },
];

export function getSegmentCount(id: BroadcastSegmentId): number {
  const customers = Object.values(CRM_CUSTOMERS);
  return id === 'all' ? customers.length : customers.filter((c) => c.status === id).length;
}

export function getSegmentLabel(id: BroadcastSegmentId): string {
  return BROADCAST_SEGMENTS.find((s) => s.id === id)?.label ?? '';
}

export type BroadcastToneId = 'fun' | 'friendly' | 'premium' | 'polite' | 'concise';

export const BROADCAST_TONES: { id: BroadcastToneId; emoji: string; label: string; hint: string }[] = [
  { id: 'fun', emoji: '🎉', label: 'สนุกสนาน วัยรุ่น', hint: 'สดใส ใช้อิโมจิ กระตุ้นให้รีบจอง' },
  { id: 'friendly', emoji: '😊', label: 'เฟรนลี่ เป็นกันเอง', hint: 'อบอุ่น เหมือนเพื่อนคุย (แนะนำ)' },
  { id: 'premium', emoji: '✨', label: 'หรูหรา พรีเมียม', hint: 'ดูแพง เหมาะลูกค้า VIP' },
  { id: 'polite', emoji: '🙏', label: 'สุภาพ ทางการ', hint: 'เรียบร้อย เป็นทางการ' },
  { id: 'concise', emoji: '⚡', label: 'กระชับ ตรงประเด็น', hint: 'สั้น ได้ใจความ' },
];

export type BroadcastColorId = 'green' | 'pink' | 'gold' | 'pastel' | 'dark';

export const BROADCAST_COLOR_TONES: { id: BroadcastColorId; label: string; grad: string; fg: string }[] = [
  { id: 'green', label: 'เขียวธรรมชาติ', grad: 'linear-gradient(135deg,#0EA36B,#12B76A 55%,#84E1BC)', fg: '#fff' },
  { id: 'pink', label: 'ชมพูหวาน', grad: 'linear-gradient(135deg,#EC4899,#F472B6 55%,#FBCFE8)', fg: '#fff' },
  { id: 'gold', label: 'ทองหรูหรา', grad: 'linear-gradient(135deg,#B45309,#D97706 50%,#FCD34D)', fg: '#fff' },
  { id: 'pastel', label: 'พาสเทลอ่อน', grad: 'linear-gradient(135deg,#C7D2FE,#FBCFE8 50%,#BBF7D0)', fg: '#3F3F46' },
  { id: 'dark', label: 'ดำ-ทองพรีเมียม', grad: 'linear-gradient(135deg,#111827,#1F2937 55%,#B45309)', fg: '#FCD34D' },
];

export type BroadcastOption = { headline: string; body: string };

/** Deterministic mock "AI" generator — exact strings from the prototype. */
export function genBroadcast(topic: string, price: string, key: string, toneId: BroadcastToneId): BroadcastOption[] {
  const pr = price.trim() ? ` เพียง ${price.trim()}` : '';
  const kk = key.trim() ? key.trim() : 'บริการต่อขนตาสวยเป็นธรรมชาติ ติดทน';
  if (toneId === 'fun') {
    return [
      { headline: `${topic} มาแล้ว! 🎉`, body: `สาวๆ ห้ามพลาด! ${topic}${pr} 💖 ${kk} รีบจองด่วนก่อนคิวเต็มน้าา ✨ ทักแชทเลย!` },
      { headline: `ปังมาก ${topic} 🔥`, body: `ขนตาสวยปังรับซัมเมอร์! ${topic}${pr} 😍 ${kk} จองเลยย เดี๋ยวคิวเต็มมม 🏃‍♀️` },
      { headline: `${topic} เริ่มแล้ววว`, body: `ว้าวว ${topic} จัดให้${pr}! 🎊 ${kk} แคปหน้านี้มาทักรับสิทธิ์เลยจ้า 💌` },
    ];
  }
  if (toneId === 'premium') {
    return [
      { headline: topic, body: `ขอเรียนเชิญคุณสัมผัสประสบการณ์ ${topic}${pr} ${kk} เพื่อความงามที่สมบูรณ์แบบในแบบคุณ สำรองคิวล่วงหน้าได้แล้ววันนี้` },
      { headline: `พิเศษเฉพาะคุณ · ${topic}`, body: `มอบความงามระดับพรีเมียมด้วย ${topic}${pr} ${kk} จำนวนจำกัด สำรองสิทธิ์เพื่อการดูแลที่พิถีพิถัน` },
      { headline: `${topic} — Exclusive`, body: `${topic} สำหรับลูกค้าคนพิเศษ${pr} ${kk} ทีมช่างผู้เชี่ยวชาญพร้อมดูแลคุณ ทักเพื่อสำรองคิว` },
    ];
  }
  if (toneId === 'polite') {
    return [
      { headline: `ประชาสัมพันธ์ · ${topic}`, body: `ทางร้านขอเรียนแจ้งโปรโมชัน ${topic}${pr} ${kk} ท่านที่สนใจสามารถทักเพื่อสอบถามและจองคิวได้ค่ะ ขอบคุณค่ะ` },
      { headline: topic, body: `เรียนลูกค้าทุกท่าน ทางร้านมี ${topic}${pr} ${kk} รบกวนทักกลับเพื่อนัดหมายวันเวลาที่สะดวกค่ะ` },
      { headline: `แจ้งโปรโมชัน ${topic}`, body: `ขอเรียนเชิญใช้บริการ ${topic}${pr} ${kk} สำรองคิวได้ตั้งแต่วันนี้เป็นต้นไปค่ะ` },
    ];
  }
  if (toneId === 'concise') {
    return [
      { headline: topic, body: `${topic}${pr} · ${kk} · ทักจองเลย` },
      { headline: `${topic}${pr}`, body: `${kk} · คิวมีจำกัด ทักด่วน` },
      { headline: `🔔 ${topic}`, body: `${topic}${pr} — จองวันนี้รับสิทธิ์ทันที` },
    ];
  }
  // friendly (default)
  return [
    { headline: `สวัสดีค่ะ · ${topic}`, body: `ทางร้านมี ${topic} มาฝากค่ะ 😊 ${kk}${pr} สนใจทักมาจองคิวได้เลยนะคะ เดี๋ยวจัดเวลาสวยๆ ให้ค่ะ 💚` },
    { headline: `${topic} นะคะ`, body: `คุณลูกค้าคะ ${topic}${pr} 🌿 ${kk} อยากชวนมาดูแลตัวเองสักหน่อยนะคะ ทักมาได้เลยค่ะ` },
    { headline: `มาแล้วค่า · ${topic}`, body: `ช่วงนี้ ${topic} อยู่นะคะ 💕 ${kk}${pr} ว่างวันไหนทักมาบอกได้เลยค่ะ ยินดีดูแลค่ะ` },
  ];
}

export type PastCampaign = { name: string; seg: string; date: string; reach: string; open: string; c: string };

export const PAST_CAMPAIGNS: PastCampaign[] = [
  { name: 'โปรต่อขนตา ลด 15%', seg: 'ลูกค้าทั้งหมด', date: '2 วันก่อน', reach: '248', open: '71%', c: '#12B76A' },
  { name: 'ชวน VIP เติมคอร์ส', seg: 'VIP', date: '1 สัปดาห์ก่อน', reach: '12', open: '92%', c: '#B54708' },
  { name: 'ทักลูกค้าใหม่ครั้งแรก', seg: 'ลูกค้าใหม่', date: '2 สัปดาห์ก่อน', reach: '53', open: '64%', c: '#1570EF' },
];
