// Mangmee CRM prototype dataset — transcribed 1:1 from the design reference
// (`design_handoff_mangmee/มั่งมี Flow A.dc.html`). Shared by the inbox,
// customers, bookings, CRM-reports, and broadcast prototype pages so every
// screen reads the same mock world until the backend contract lands.

export type MangmeeBranchId = 'all' | 'siam' | 'aree' | 'thonglor';

export type MangmeeBranch = { id: MangmeeBranchId; name: string; sub: string };

export const MANGMEE_BRANCHES: MangmeeBranch[] = [
  { id: 'all', name: 'ทุกสาขา (รวม)', sub: 'มุมมองรวมทุกสาขา' },
  { id: 'siam', name: 'Room45 Eyes Lashes · สยาม', sub: 'สาขาสยาม' },
  { id: 'aree', name: 'Room45 Eyes Lashes · อารีย์', sub: 'สาขาอารีย์' },
  { id: 'thonglor', name: 'Room45 Eyes Lashes · ทองหล่อ', sub: 'สาขาทองหล่อ' },
];

export function mangmeeBranchShortName(id: string): string {
  const branch = MANGMEE_BRANCHES.find((b) => b.id === id);
  if (!branch) return id;
  return branch.id === 'all' ? branch.name : branch.sub.replace('สาขา', '');
}

export type ConversationStatus =
  | 'new'
  | 'open'
  | 'waiting_internal'
  | 'waiting_customer'
  | 'followup'
  | 'resolved';

export const CONV_STATUS_ORDER: ConversationStatus[] = [
  'new',
  'open',
  'waiting_internal',
  'waiting_customer',
  'followup',
  'resolved',
];

export const CONV_STATUS_META: Record<ConversationStatus, { label: string; c: string; bg: string }> = {
  new: { label: 'ใหม่', c: '#DC2626', bg: '#FEE2E2' },
  open: { label: 'กำลังคุย', c: '#2563EB', bg: '#DBEAFE' },
  waiting_internal: { label: 'รอทีมภายใน', c: '#D97706', bg: '#FEF3C7' },
  waiting_customer: { label: 'รอลูกค้า', c: '#7C3AED', bg: '#EDE9FE' },
  followup: { label: 'ติดตาม', c: '#EA580C', bg: '#FFEDD5' },
  resolved: { label: 'ปิดแล้ว', c: '#059669', bg: '#D1FAE5' },
};

/** SLA breach threshold in minutes — status!=='resolved' && waitMin > 30. */
export const CRM_OVERDUE_MIN = 30;

export type CustomerTier = 'vip' | 'active' | 'lead';

export const TIER_META: Record<CustomerTier, { label: string; c: string; bg: string }> = {
  vip: { label: 'VIP', c: '#B54708', bg: '#FEF3C7' },
  active: { label: 'ลูกค้าประจำ', c: '#027A48', bg: '#D1FAE5' },
  lead: { label: 'ลูกค้าใหม่', c: '#1D4ED8', bg: '#DBEAFE' },
};

export type CrmConversation = {
  id: string;
  custId: string;
  name: string;
  initial: string;
  color: string;
  last: string;
  time: string;
  waitMin: number;
  unread: number;
  tags: string[];
  assigned: string;
  status: ConversationStatus;
  branch: Exclude<MangmeeBranchId, 'all'>;
};

export const CRM_CONVERSATIONS: CrmConversation[] = [
  { id: 'c1', custId: 'k1', name: 'คุณพิม ชนกานต์', initial: 'พม', color: '#EC4899', last: 'สนใจต่อขนตาแบบ Volume ราคาเท่าไหร่คะ', time: '2 นาที', waitMin: 2, unread: 2, tags: ['ลูกค้าใหม่'], assigned: '', status: 'new', branch: 'siam' },
  { id: 'c2', custId: 'k2', name: 'คุณเบล สุภาวดี', initial: 'บล', color: '#2E90FA', last: 'ขอเลื่อนัดพรุ่งนี้เป็นบ่ายได้ไหมคะ', time: '20 นาที', waitMin: 20, unread: 0, tags: ['นัดหมาย'], assigned: 'มายด์', status: 'waiting_customer', branch: 'siam' },
  { id: 'c3', custId: 'k3', name: 'คุณแนน วงษ์ดี', initial: 'นน', color: '#F79009', last: 'ได้รับใบเสนอราคาแล้วค่ะ ขอดูก่อนนะคะ', time: '1 ชม.', waitMin: 65, unread: 0, tags: ['รอตัดสินใจ'], assigned: 'มายด์', status: 'waiting_customer', branch: 'siam' },
  { id: 'c4', custId: 'k4', name: 'คุณจอย รุ่งเรือง', initial: 'จย', color: '#7A5AF8', last: 'จองคิวเรียบร้อย เสาร์ 11:00 · VIP -10%', time: '08:25', waitMin: 0, unread: 0, tags: ['VIP'], assigned: 'ไนซ์', status: 'resolved', branch: 'aree' },
  { id: 'c5', custId: 'k5', name: 'คุณกิ๊ฟ ธนะดี', initial: 'กฟ', color: '#12B76A', last: 'ขอบคุณมากค่ะ ประทับใจมาก', time: 'เมื่อวาน', waitMin: 0, unread: 0, tags: [], assigned: 'ไนซ์', status: 'resolved', branch: 'thonglor' },
  { id: 'c6', custId: 'k6', name: 'คุณมิ้นต์ พุทธิชา', initial: 'มต', color: '#0BA5EC', last: 'สอบถามโปรโมชั่นเดือนนี้ค่ะ', time: '45 นาที', waitMin: 45, unread: 1, tags: ['ลูกค้าใหม่'], assigned: '', status: 'new', branch: 'siam' },
  { id: 'c7', custId: 'k7', name: 'คุณเอิร์ธ พิทักษ์', initial: 'อธ', color: '#EF6820', last: 'ขอที่อยู่ร้านหน่อยครับ', time: '5 นาที', waitMin: 5, unread: 0, tags: [], assigned: 'ไนซ์', status: 'open', branch: 'aree' },
  { id: 'c8', custId: 'k8', name: 'คุณปูน ศิริกัญญา', initial: 'ปน', color: '#DD2590', last: 'โอนมัดจำแล้วนะคะ แนบสลิป', time: '12 นาที', waitMin: 12, unread: 1, tags: ['นัดหมาย', 'รอตรวจสลิป'], assigned: 'แพรว', status: 'waiting_internal', branch: 'thonglor' },
  { id: 'c9', custId: 'k9', name: 'คุณจ๊ะจ๋า มานะมานะ', initial: 'จจ', color: '#F63D68', last: 'ต่อขนตาช่วงเย็นได้ไหมคะ', time: '38 นาที', waitMin: 38, unread: 3, tags: ['ลูกค้าใหม่'], assigned: '', status: 'new', branch: 'siam' },
  { id: 'c10', custId: 'k10', name: 'คุณแพร กิตติธร', initial: 'พร', color: '#7A5AF8', last: 'ไว้ว่างจะทักมาค่ะ', time: '2 ชม.', waitMin: 0, unread: 0, tags: [], assigned: 'เตย', status: 'followup', branch: 'aree' },
  { id: 'c11', custId: 'k11', name: 'คุณโบว์ สุขุม', initial: 'บว', color: '#12B76A', last: 'ขนตาหลุดเร็วมากทำไงดีคะ', time: '20 นาที', waitMin: 20, unread: 0, tags: ['ดูแลหลังการขาย'], assigned: 'มายด์', status: 'open', branch: 'siam' },
  { id: 'c12', custId: 'k12', name: 'คุณฝน พิมลวรรณ', initial: 'ฝน', color: '#64748B', last: 'ขอบคุณมากค่ะ', time: 'วาน', waitMin: 0, unread: 0, tags: [], assigned: 'แพรว', status: 'resolved', branch: 'thonglor' },
  { id: 'c13', custId: 'k13', name: 'คุณต้นน้ำ ชลธาร', initial: 'ตน', color: '#475467', last: 'รับต่อขนตาผู้ชายไหมครับ', time: '33 นาที', waitMin: 33, unread: 1, tags: ['ลูกค้าใหม่'], assigned: '', status: 'new', branch: 'aree' },
  { id: 'c14', custId: 'k14', name: 'คุณอิ๊ง ประภากร', initial: 'อง', color: '#06AED4', last: 'รอเช็คคิวช่างอยู่ค่ะ', time: '8 นาที', waitMin: 8, unread: 0, tags: ['นัดหมาย'], assigned: 'ไนซ์', status: 'waiting_internal', branch: 'siam' },
];

export type CustomerPurchase = { item: string; date: string; amount: string };
export type CustomerTask = { title: string; due: string };
export type CustomerCourseSession = { n: number; date: string; by: string; done: boolean };
export type CustomerCourse = { name: string; total: number; used: number; sessions: CustomerCourseSession[] };

export type CrmCustomer = {
  name: string;
  lineName: string;
  phone: string;
  dob: string;
  status: CustomerTier;
  statusLabel: string;
  score: number;
  sentiment: string;
  ltv: string;
  lastVisit: string;
  tags: string[];
  deal: { title: string; value: string; stage: string } | null;
  purchases: CustomerPurchase[];
  tasks: CustomerTask[];
  appt: { title: string; when: string } | null;
  course?: CustomerCourse;
  aiSummary: string;
  aiReply: string;
  intent: string;
  next: string;
};

export const CRM_CUSTOMERS: Record<string, CrmCustomer> = {
  k1: {
    name: 'คุณพิม ชนกานต์', lineName: 'Pim •˚', phone: '081-234-5678', dob: '14/03/1996', status: 'lead', statusLabel: 'ลูกค้าใหม่', score: 82, sentiment: 'สนใจมาก', ltv: '0', lastVisit: '—', tags: ['ลูกค้าใหม่', 'สนใจ Volume'],
    deal: { title: 'คอร์สต่อขนตา Volume', value: '2,500', stage: 'ลูกค้าใหม่' },
    purchases: [], tasks: [], appt: null,
    aiSummary: 'ลูกค้าใหม่สนใจต่อขนตาแบบ Volume ถามราคา มีทีท่าทีอยากจองคิวสัปดาหน้า',
    aiReply: 'สวัสดีค่ะ คอร์สต่อขนตาแบบ Volume ราคา 2,500 บาท ติดทนประมาณ 4-6 สัปดาห์ค่ะ สะดวกจองคิววันไหนดีคะ? ทางร้านมีโปรสำหรับลูกค้าใหม่ด้วยนะคะ ✨',
    intent: 'สนใจซื้อสูง', next: 'ส่งราคา + ชวนจองคิวภายในวันนี้',
  },
  k2: {
    name: 'คุณเบล สุภาวดี', lineName: 'belle.s', phone: '089-555-1122', dob: '02/11/1990', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 64, sentiment: 'เป็นกลาง', ltv: '8,900', lastVisit: '12 มิ.ย.', tags: ['นัดหมาย', 'ขนตาธรรมชาติ'],
    deal: null,
    purchases: [{ item: 'ต่อขนตา Natural', date: '12 มิ.ย.', amount: '1,800' }, { item: 'รีทัชขนตา', date: '28 เม.ย.', amount: '900' }],
    tasks: [{ title: 'ยืนยันนัดใหม่', due: 'วันนี้' }], appt: { title: 'รีทัชขนตา', when: 'พรุ่งนี้ 14:00' },
    aiSummary: 'ลูกค้าประจำ ขอเลื่อนนัดรีทัชจากพรุ่งเช้าเป็นบ่าย',
    aiReply: 'ได้เลยค่ะคุณเบล รบกวนแจ้งวันและเวลาที่สะดวกได้เลยค่ะ เดี๋ยวเช็คคิวช่างให้ทันทีนะคะ 😊',
    intent: 'ขอเลื่อนนัด', next: 'ถามวันเวลาที่สะดวก แล้วเช็คคิวช่าง',
  },
  k3: {
    name: 'คุณแนน วงษ์ดี', lineName: 'nan_w', phone: '092-888-3344', dob: '25/07/1994', status: 'lead', statusLabel: 'รอปิดการขาย', score: 71, sentiment: 'ลังเล', ltv: '0', lastVisit: '—', tags: ['รอตัดสินใจ', 'ใบเสนอส่งแล้ว'],
    deal: { title: 'แพ็กเกจรายเดือน', value: '3,200', stage: 'ส่งใบเสนอราคาแล้ว' },
    purchases: [], tasks: [{ title: 'ติดตามใบเสนอราคา', due: 'เกินกำหนด 1 วัน' }], appt: null,
    aiSummary: 'ส่งใบเสนอราคาไปแล้วเกิน 1 วันยังไม่ตอบ — ควรรีบ follow-up',
    aiReply: 'สวัสดีค่ะคุณแนน รบกวนเรื่องแพ็กเกจรายเดือนที่ส่งไปนะคะ ตอนนี้มีโปรจองล่วงหน้าลดเพิ่ม 10% ถึงสิ้นเดือนนี้ค่ะ',
    intent: 'ลังเลตัดสินใจ', next: 'ส่งโปรโมชั่นเร่งปิดการขาย',
  },
  k4: {
    name: 'คุณจอย รุ่งเรือง', lineName: 'joy.r ⭐', phone: '086-777-9900', dob: '28/09/1988', status: 'vip', statusLabel: 'VIP', score: 93, sentiment: 'ดีมาก', ltv: '24,600', lastVisit: '5 มิ.ย.', tags: ['VIP', 'ลูกค้าประจำ', 'ขนตา+เล็บ'],
    deal: { title: 'แพ็กเกจรายปี VIP', value: '12,000', stage: 'เจรจาต่อรอง' },
    purchases: [{ item: 'ต่อขนตา Volume', date: '5 มิ.ย.', amount: '2,500' }, { item: 'ทำเล็บเจล', date: '5 มิ.ย.', amount: '650' }, { item: 'คอร์ส 6 ครั้ง', date: 'ม.ค.', amount: '11,000' }],
    course: {
      name: 'คอร์สต่อขนตา 6 ครั้ง', total: 6, used: 3,
      sessions: [
        { n: 1, date: '20 ม.ค.', by: 'ไนซ์', done: true },
        { n: 2, date: '18 ก.พ.', by: 'มายด์', done: true },
        { n: 3, date: '15 มี.ค.', by: 'ไนซ์', done: true },
        { n: 4, date: 'เสาร์นี้ 11:00', by: 'ไนซ์', done: false },
        { n: 5, date: 'ยังไม่นัด', by: '', done: false },
        { n: 6, date: 'ยังไม่นัด', by: '', done: false },
      ],
    },
    tasks: [], appt: { title: 'เติมขนตา', when: 'เสาร์ 11:00' },
    aiSummary: 'ลูกค้า VIP มูลค่าสูง สนใจทำเล็บเจลเพิ่ม โอกาสขายพ่วงสูง',
    aiReply: 'ได้เลยค่ะคุณจอย ทำเล็บเจลพร้อมต่อขนตาได้เลยค่ะ ลูกค้า VIP รับส่วนลดทำเล็บเจล 15% นะคะ จองคิวเสาร์ 11:00 ไว้ให้นะคะ',
    intent: 'ซื้อเพิ่ม', next: 'Upsell ทำเล็บเจล + ยืนยันนัด',
  },
  k5: {
    name: 'คุณกิ๊ฟ ธนะดี', lineName: 'gift.t', phone: '095-222-6677', dob: '17/05/1997', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 58, sentiment: 'ดี', ltv: '5,400', lastVisit: 'เมื่อวาน', tags: ['ขนตาธรรมชาติ'],
    deal: null, purchases: [{ item: 'ต่อขนตา Natural', date: 'เมื่อวาน', amount: '1,800' }], tasks: [], appt: null,
    aiSummary: 'ปิดการขายเรียบร้อย ลูกค้าขอบคุณหลังรับบริการ',
    aiReply: 'ขอบคุณมากเช่นกันค่ะ หวังว่าจะได้ดูแลคุณอีกนะคะ ❤️',
    intent: 'ขอบคุณ', next: 'ปิดเคส',
  },
  k6: {
    name: 'คุณมิ้นต์ พุทธิชา', lineName: 'mint.p', phone: '080-111-2233', dob: '30/01/1999', status: 'lead', statusLabel: 'ลูกค้าใหม่', score: 60, sentiment: 'สนใจ', ltv: '0', lastVisit: '—', tags: ['ลูกค้าใหม่', 'ถามโปร'],
    deal: null, purchases: [], tasks: [], appt: null,
    aiSummary: 'ลูกค้าใหม่ถามโปรโมชั่นเดือนนี้ — ค้างเกิน 30 นาที ควรรีบตอบ',
    aiReply: 'สวัสดีค่ะ เดือนนี้มีโปรต่อขนตา Volume ลด 15% เหลือ 2,125 บาทค่ะ สนใจจองคิววันไหนดีคะ?',
    intent: 'สอบโปร', next: 'ตอบด่วน + เสนอโปร',
  },
  k7: {
    name: 'คุณเอิร์ธ พิทักษ์', lineName: 'earth.p', phone: '081-999-0000', dob: '21/09/1985', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 50, sentiment: 'เป็นกลาง', ltv: '3,600', lastVisit: '20 มิ.ย.', tags: [],
    deal: null, purchases: [{ item: 'ต่อขนตา Natural', date: '20 มิ.ย.', amount: '1,800' }], tasks: [], appt: null,
    aiSummary: 'ลูกค้าถามที่อยู่ร้าน — ตอบแผนที่/เบอร์โทร',
    aiReply: 'ร้านอยู่ชั้น 3 อาคาร A สยามค่ะ ติด BTS สยาม ทางออกที่ 3 นะคะ',
    intent: 'ถามที่อยู่', next: 'ส่งแผนที่+เบอร์โทร',
  },
  k8: {
    name: 'คุณปูน ศิริกัญญา', lineName: 'poon.s', phone: '082-333-4455', dob: '11/12/1992', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 68, sentiment: 'ดี', ltv: '6,200', lastVisit: 'วันนี้', tags: ['นัดหมาย', 'โอนแล้ว'],
    deal: null, purchases: [{ item: 'รีทัชขนตา', date: 'วันนี้', amount: '900' }],
    tasks: [{ title: 'ยืนยันสลิปโอน', due: 'วันนี้' }], appt: { title: 'รีทัชขนตา', when: 'วันนี้ 16:00' },
    aiSummary: 'ลูกค้าโอนมัดจำแล้ว รอการยืนยันสลิป',
    aiReply: 'ได้รับสลิปการโอนแล้วนะคะ ยืนยันนัดวันนี้ 16:00 ค่ะ ขอบคุณค่ะ',
    intent: 'แจ้งโอน', next: 'ยืนยันสลิป + ยืนยันนัด',
  },
  k9: {
    name: 'คุณจ๊ะจ๋า มานะมานะ', lineName: 'jaja.m', phone: '083-777-8899', dob: '05/06/1995', status: 'lead', statusLabel: 'ลูกค้าใหม่', score: 75, sentiment: 'สนใจมาก', ltv: '0', lastVisit: '—', tags: ['ลูกค้าใหม่', 'ช่วงเย็น'],
    deal: { title: 'ต่อขนตาช่วงเย็น', value: '2,500', stage: 'สนใจนัดคิว' }, purchases: [], tasks: [], appt: null,
    aiSummary: 'ลูกค้าใหม่ถามคิวช่วงเย็น — ค้าง 38 นาทีแล้ว ควรรีบตอบ',
    aiReply: 'เย็นนี้ร้านเปิดถึง 20:00 ค่ะ ช่วง 18:00-20:00 มีคิวว่างค่ะ สะดวกจองเลยไหมคะ?',
    intent: 'สอบเวลา', next: 'เสนอคิวช่วงเย็น',
  },
  k10: {
    name: 'คุณแพร กิตติธร', lineName: 'prae.k', phone: '084-222-1100', dob: '19/08/1993', status: 'lead', statusLabel: 'รอตัดสินใจ', score: 55, sentiment: 'เฉยๆ', ltv: '0', lastVisit: '—', tags: ['ติดตาม'],
    deal: { title: 'ต่อขนตา Classic', value: '1,500', stage: 'รอลูกค้า' }, purchases: [], tasks: [{ title: 'ติดตามอีกครั้ง', due: 'อีก 3 วัน' }], appt: null,
    aiSummary: 'ลูกค้าขอเวลาตัดสินใจ นัด follow-up',
    aiReply: 'ไม่เป็นไรค่ะ ไว้สะดวกเมื่อไหร่ทักมาได้เลยนะคะ มีโปรโมชั่นใหม่ทุกเดือนค่ะ',
    intent: 'ยังไม่ตัดสินใจ', next: 'ตั้งเตือน follow-up 3 วัน',
  },
  k11: {
    name: 'คุณโบว์ สุขุม', lineName: 'bow.s', phone: '085-444-5566', dob: '27/02/1991', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 62, sentiment: 'กังวล', ltv: '4,500', lastVisit: '3 วันก่อน', tags: ['ดูแลหลังการขาย'],
    deal: null, purchases: [{ item: 'ต่อขนตา Volume', date: '3 วันก่อน', amount: '2,500' }], tasks: [], appt: null,
    aiSummary: 'ลูกค้าขนตาหลุดเร็ว อาจเป็นปัญหาคุณภาพงาน — ควรดูแล',
    aiReply: 'ขอโทษนะคะ ปกติขนตา Volume อยู่ได้ 3-4 สัปดาห์ รบกวนเข้ามาให้ทางร้านเช็คให้ฟรีค่ะ สะดวกวันไหนดีคะ?',
    intent: 'ร้องเรียนคุณภาพ', next: 'นัดเช็คฟรี + ดูแลความพึงพอใจ',
  },
  k12: {
    name: 'คุณฝน พิมลวรรณ', lineName: 'fon.p', phone: '086-000-1122', dob: '08/04/1989', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 70, sentiment: 'ดีมาก', ltv: '9,800', lastVisit: 'วาน', tags: ['ขาประจำ'],
    deal: null, purchases: [{ item: 'ต่อขนตา Volume', date: 'วาน', amount: '2,500' }], tasks: [], appt: null,
    aiSummary: 'ปิดเคสแล้ว ลูกค้าพึงพอใจ',
    aiReply: 'ขอบคุณมากค่ะ ❤️ แล้วมาใหม่นะคะ',
    intent: 'ขอบคุณ', next: 'ปิดเคส',
  },
  k13: {
    name: 'คุณต้นน้ำ ชลธาร', lineName: 'tonnam.c', phone: '087-555-6677', dob: '13/10/2000', status: 'lead', statusLabel: 'ลูกค้าใหม่', score: 48, sentiment: 'สนใจ', ltv: '0', lastVisit: '—', tags: ['ลูกค้าใหม่', 'ผู้ชาย'],
    deal: null, purchases: [], tasks: [], appt: null,
    aiSummary: 'ลูกค้าผู้ชายสอบถามบริการ — ค้าง 33 นาที ควรรีบตอบ',
    aiReply: 'รับค่ะ ทางร้านรับต่อขนตาผู้ชาย เน้นธรรมชาติค่ะ เริ่ม 990 บาท สนใจนัดคิวเข้ามาไหมครับ?',
    intent: 'สอบบริการ', next: 'เสนอแพ็กเกจผู้ชาย',
  },
  k14: {
    name: 'คุณอิ๊ง ประภากร', lineName: 'ing.p', phone: '088-666-7788', dob: '03/03/1987', status: 'active', statusLabel: 'ลูกค้าประจำ', score: 66, sentiment: 'ดี', ltv: '5,000', lastVisit: '10 วันก่อน', tags: ['นัดหมาย'],
    deal: null, purchases: [{ item: 'ต่อขนตา Natural', date: '10 วันก่อน', amount: '1,800' }], tasks: [{ title: 'เช็คคิวช่างว่าง', due: 'วันนี้' }], appt: null,
    aiSummary: 'ลูกค้าขอนัด รอทีมเช็คคิวช่าง',
    aiReply: 'รอเช็คคิวช่างสักครู่นะคะ เดี๋ยวแจ้งคิวว่างให้ค่ะ',
    intent: 'จองคิว', next: 'เช็คคิวช่าง + แจ้งเวลา',
  },
};

export type CrmSlip = { amount: string; bank: string; from: string; date: string; ref: string };

export type CrmMessage = {
  dir: 'in' | 'out' | 'note';
  text?: string;
  time: string;
  by?: string;
  ai?: boolean;
  slip?: CrmSlip;
};

export const CRM_SEED_MESSAGES: Record<string, CrmMessage[]> = {
  c1: [
    { dir: 'in', text: 'สวัสดีค่ะ สนใจต่อขนตาค่ะ', time: '10:31' },
    { dir: 'in', text: 'แบบ Volume ราคาเท่าไหร่คะ แล้วทำนานกี่ชั่วโมง', time: '10:31' },
  ],
  c2: [
    { dir: 'in', text: 'พรุ่งนี้นัดไว้ 10 โมงใช่ไหมคะ', time: '09:02' },
    { dir: 'out', text: 'ใช่ค่ะ คุณเบลนัดรีทัชขนตา 10:00 นะคะ', time: '09:05', by: 'มายด์' },
    { dir: 'in', text: 'ขอเลื่อนนัดพรุ่งนี้เป็นบ่ายได้ไหมคะ', time: '09:40' },
    { dir: 'note', text: 'ลูกค้าเคยเลื่อนนัดบ่อย — เช็คคิวช่างก่อนยืนยัน', time: '09:41', by: 'มายด์' },
  ],
  c3: [
    { dir: 'out', text: 'ส่งใบเสนอราคาแพ็กเกจรายเดือนให้แล้วนะคะ', time: 'เมื่อวาน', by: 'มายด์' },
    { dir: 'in', text: 'ได้รับใบเสนอราคาแล้วค่ะ ขอดูก่อนนะคะ', time: 'เมื่อวาน' },
  ],
  c4: [
    { dir: 'in', text: 'สวัสดีค่ะ อยากทำเล็บเจลเพิ่มตอนมาต่อขนตาครั้งหน้าได้ไหมคะ', time: '08:15' },
    { dir: 'out', text: 'ได้เลยค่ะคุณจอย ทำเล็บเจล + ต่อขนตาได้ในครั้งเดียวเลยค่ะ ลูกค้า VIP รับส่วนลด 10% ด้วยนะคะ สะดวกวันไหนดีคะ?', time: '08:16', by: 'ไนซ์' },
    { dir: 'in', text: 'วันเสาร์นี้ช่วงเช้าได้ไหมคะ', time: '08:20' },
    { dir: 'out', text: 'เสาร์นี้ 11:00 มีคิวว่างพอดีค่ะ จองให้เลยนะคะ 😊', time: '08:21', by: 'ไนซ์' },
    { dir: 'in', text: 'ได้เลยค่ะ จองเลย', time: '08:22' },
    { dir: 'out', ai: true, by: '🤖 AI · จองคิวอัตโนมัติ', text: '✅ จองคิวเรียบร้อยค่ะ — ต่อขนตา Volume + เล็บเจล เสาร์ 11:00 น. (เลขที่จอง BK480215) ช่าง ไนซ์ · รับส่วนลด VIP 10% แล้วค่ะ', time: '08:22' },
    { dir: 'note', text: 'ลูกค้า VIP — เปิด Auto AI จองคิว + ส่วนลดไว้แล้ว ยืนยันคิวช่างเรียบร้อย', time: '08:23', by: 'ไนซ์' },
    { dir: 'in', text: 'ขอบคุณมากค่ะ 🙏', time: '08:25' },
    { dir: 'out', text: 'ยินดีค่ะ แล้วเจอกันวันเสาร์นะคะ ❤️', time: '08:25', by: 'ไนซ์' },
  ],
  c5: [
    { dir: 'in', text: 'ขอบคุณมากค่ะ ประทับใจมาก', time: 'เมื่อวาน' },
    { dir: 'out', text: 'ขอบคุณมากเช่นกันค่ะ ❤️ แล้วมาใหม่นะคะ', time: 'เมื่อวาน', by: 'ไนซ์' },
  ],
  c6: [{ dir: 'in', text: 'สอบถามโปรโมชั่นเดือนนี้ค่ะ มีอะไรบ้าง', time: '45 นาที' }],
  c7: [{ dir: 'in', text: 'ขอที่อยู่ร้านหน่อยครับ', time: '5 นาที' }],
  c8: [
    { dir: 'in', text: 'สนใจจองคิวต่อขนตา Volume วันเสาร์นี้ค่ะ', time: '11:20' },
    { dir: 'out', text: 'ได้เลยค่ะคุณปูน เสาร์นี้ 14:00 ว่างพอดีค่ะ รบกวนโอนมัดจำ 1,800 บาท เพื่อยืนยันคิวนะคะ', time: '11:24', by: 'แพรว' },
    { dir: 'out', text: 'บัญชี กสิกรไทย 123-4-56789-0 ร้าน Room45 Eyes Lashes ค่ะ', time: '11:24', by: 'แพรว' },
    { dir: 'in', text: 'โอนมัดจำแล้วนะคะ แนบสลิปค่ะ', time: '12 นาที' },
    { dir: 'in', slip: { amount: '1,800', bank: 'กสิกรไทย · K PLUS', from: 'ปูน ศิริกัญญา', date: '5 ก.ค. 2569 · 14:48', ref: '0157XX8842' }, time: '12 นาที' },
  ],
  c9: [
    { dir: 'in', text: 'ต่อขนตาช่วงเย็นได้ไหมคะ', time: '38 นาที' },
    { dir: 'in', text: 'ร้านปิดกี่โมงคะ', time: '38 นาที' },
  ],
  c10: [
    { dir: 'out', text: 'ส่งโปรโมชั่นให้แล้วนะคะ สนใจทักมาได้เลยค่ะ', time: '2 ชม.', by: 'เตย' },
    { dir: 'in', text: 'ไว้ว่างจะทักมาค่ะ', time: '2 ชม.' },
  ],
  c11: [{ dir: 'in', text: 'ขนตาหลุดเร็วมากทำไงดีคะ เพิ่งทำมาอาทิตย์เดียว', time: '20 นาที' }],
  c12: [
    { dir: 'in', text: 'ขอบคุณมากค่ะ', time: 'วาน' },
    { dir: 'out', text: 'ดูแลตัวเองนะคะ แล้วมาใหม่นะคะ ❤️', time: 'วาน', by: 'แพรว' },
  ],
  c13: [{ dir: 'in', text: 'รับต่อขนตาผู้ชายไหมครับ', time: '33 นาที' }],
  c14: [
    { dir: 'in', text: 'รอเช็คคิวช่างอยู่ค่ะ', time: '8 นาที' },
    { dir: 'note', text: 'ช่างคิวเต็มถึงบ่าย รอเช็คคิวเย็น', time: '7 นาที', by: 'ไนซ์' },
  ],
};

export function parseLtv(value: string | undefined): number {
  return parseInt((value ?? '0').replace(/[^0-9]/g, ''), 10) || 0;
}
