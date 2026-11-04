/**
 * Curated joke bank for น้องมั่งมี's casual lane (Owner decision 2026-08-29/30).
 *
 * Why a bank at all: left to improvise with no anchor, the model reaches for nerd humour — a
 * statistician joke landed as "งงอีกแล้ว" with a real Owner. The audience is stressed Thai SME
 * owners and staff.
 *
 * Owner decision 2026-08-31 (50/50 hybrid, supersedes bank-first of 2026-08-30): situational
 * COMPOSITION is a first-class lane — when the conversation gives real material, the model writes
 * a fresh joke from it, holding the bank as the tone and quality bar; a plain material-less ask
 * draws from the bank. Every composed joke still obeys the writing rules below, and the
 * humour-register rule in CASUAL_CONVERSATION_SYSTEM_PROMPT stays binding.
 *
 * Owner decision 2026-08-30 (fandom banter): น้องมั่งมี may banter in GENRE terms — ซีรีส์/ละคร,
 * วายไทย, ยุทธภพ/เทพเซียน, ไอดอล — because that is how the audience actually talks. She never
 * volunteers a real person, group, show, or brand name herself, and there is NO blanket
 * "ข้อมูลอาจไม่ล่าสุด" disclaimer (Owner rejected it as flavor-killing). The only risky case —
 * the user names something real and asks its CURRENT news or status — is already covered by the
 * existing live-facts rule in the casual prompt.
 *
 * WRITING RULES for anyone adding an entry (this is customer-facing copy, treat it as such):
 * - Thai, one or two sentences, and it must land INSTANTLY with zero background knowledge.
 * - Either classic คำถามกวนๆ/เล่นคำ wordplay, or everyday SME-life warmth.
 * - Genre entries borrow VIBES and TROPES only: absolutely NO real person, group, show, or brand
 *   name — not even a "safe" one. A named idol retires, a named series ages; a trope never does.
 * - No math, statistics, or accounting in-jokes. If the punchline needs explaining, it is wrong.
 * - Positive and warm. Never a joke that adds stress, blames the reader, or punches at anyone.
 * - Every `id` and every `text` must be unique, and `text` stays under 200 characters.
 *
 * Invariants (ids unique, categories valid, length caps, per-category minimums) are asserted in
 * response-composer.agent.spec.ts — the gateway's `test` script pins spec files by path, so bank
 * checks live in an already-registered spec rather than an orphan one.
 */

export type MangmeeJokeCategory = 'กวน' | 'ซีรีส์' | 'วาย' | 'ยุทธภพ' | 'ไอดอล' | 'กระแส';

export type MangmeeJoke = { id: string; category: MangmeeJokeCategory; text: string };

export const MANGMEE_JOKE_BANK: ReadonlyArray<MangmeeJoke> = [
  // กวน — classic Thai riddle wordplay. The whole joke is in one line and the answer is obvious
  // the moment you hear it; that "obvious" is the point, not a weakness.
  { id: 'kuan-01', category: 'กวน', text: 'ตัวอะไรเอ่ยชอบอยู่ในห้องสมุด? ...ตัวหนังสือค่ะ 555' },
  { id: 'kuan-02', category: 'กวน', text: 'อะไรเอ่ย มีฟันเต็มปากแต่กัดใครไม่ได้เลยสักคน? ...หวีค่ะ 555' },
  { id: 'kuan-03', category: 'กวน', text: 'ผลไม้อะไรเอ่ย มีตาเยอะมากแต่มองไม่เห็นสักตา? ...สับปะรดค่ะ 😄' },
  { id: 'kuan-04', category: 'กวน', text: 'อะไรเอ่ย ยิ่งขุดยิ่งใหญ่ขึ้นเรื่อย ๆ? ...หลุมค่ะ 555' },
  { id: 'kuan-05', category: 'กวน', text: 'ปลาอะไรเอ่ย ว่ายน้ำไม่เป็นสักที? ...ปลาทอดค่ะ 😄' },
  { id: 'kuan-06', category: 'กวน', text: 'อะไรเอ่ย ตกน้ำไม่ไหล ตกไฟไม่ไหม้? ...เงาค่ะ' },
  { id: 'kuan-07', category: 'กวน', text: 'อะไรเอ่ย มีหัวแต่ไม่มีตัว แถมทำให้คนน้ำตาไหลได้ด้วย? ...หัวหอมค่ะ 555' },
  { id: 'kuan-08', category: 'กวน', text: 'อะไรเอ่ย ทำงานทุกวันไม่เคยลาสักวัน แต่ไม่เคยขอขึ้นเงินเดือนเลย? ...นาฬิกาค่ะ 😄' },
  { id: 'kuan-09', category: 'กวน', text: 'อะไรเอ่ย ยิ่งให้คนอื่นไปเยอะ เราก็ยิ่งมีเยอะขึ้น? ...รอยยิ้มค่ะ 💚' },
  { id: 'kuan-10', category: 'กวน', text: 'อะไรเอ่ย มาถึงหน้าร้านก่อนเจ้าของร้านทุกวันเลย? ...แสงแดดค่ะ 😄' },

  // ซีรีส์ — drama tropes only (มรสุมทุกตอน, พล็อตหักมุม, ตอนจบแฮปปี้). No titles, no actors.
  { id: 'series-01', category: 'ซีรีส์', text: 'เป็นเจ้าของร้านนี่เหมือนนางเอกซีรีส์เลยนะคะ โดนมรสุมทุกตอน แต่ตอนจบต้องแฮปปี้ค่ะ สู้ ๆ นะคะ 💚' },
  { id: 'series-02', category: 'ซีรีส์', text: 'วันจันทร์นี่เหมือนตอนแรกของซีซั่นใหม่เลยค่ะ เปิดเรื่องมาปมเยอะหน่อย แต่ดูไปเรื่อย ๆ เดี๋ยวก็สนุกเองนะคะ' },
  { id: 'series-03', category: 'ซีรีส์', text: 'ถ้าชีวิตร้านเราเป็นละคร ตอนนี้คือช่วงตัวเอกกำลังเก็บเลเวลค่ะ ฉากเท่ ๆ เขาเก็บไว้ท้ายเรื่องเสมอนะคะ 💚' },
  { id: 'series-04', category: 'ซีรีส์', text: 'ลูกค้าที่หายไปนานแล้วโผล่มาซื้อของ นี่คือพล็อตหักมุมที่ดีที่สุดของสัปดาห์เลยค่ะ 555' },
  { id: 'series-05', category: 'ซีรีส์', text: 'วันนี้ขอเป็นตอนพักเบรกของซีรีส์นะคะ ไม่มีดราม่า มีแต่ฉากกินข้าวอร่อย ๆ ค่ะ 😊' },

  // วาย — คู่จิ้น/แฟนคลับ/เคมีดี framing applied to things, never to people the user knows.
  { id: 'wai-01', category: 'วาย', text: 'ยอดขายกับกำไรนี่คู่จิ้นชัด ๆ ค่ะ ห่างกันทีไรแฟน ๆ (เจ้าของร้าน) ใจพังทุกที 555' },
  { id: 'wai-02', category: 'วาย', text: 'กาแฟกับตอนเช้านี่เคมีดีที่สุดในเรื่องเลยค่ะ ขาดกันไม่ได้สักวันจริง ๆ 555' },
  { id: 'wai-03', category: 'วาย', text: 'ข้าวเหนียวกับหมูปิ้งคือคู่จิ้นระดับตำนานค่ะ เจอกันเมื่อไหร่แฟนคลับ (คนหิว) กรี๊ดทุกที 😄' },
  { id: 'wai-04', category: 'วาย', text: 'ร้านกับเจ้าของร้านนี่คู่หลักของเรื่องเลยนะคะ งอนกันบ้าง แต่สุดท้ายก็ไปด้วยกันตลอดค่ะ 💚' },
  { id: 'wai-05', category: 'วาย', text: 'น้องมั่งมีขอจิ้นคุณกับ "วันหยุด" หน่อยค่ะ คู่นี้เจอกันน้อยไป แฟนคลับเรียกร้องแล้วนะคะ 555' },

  // ยุทธภพ — wuxia/xianxia vibes: ฝึกวิชา, พลังภายใน, ทะลุด่าน. Tropes only, no novels or dramas.
  { id: 'yut-01', category: 'ยุทธภพ', text: 'เก็บใบเสร็จครบเดือนเหมือนผ่านด่านจอมยุทธเลยค่ะ ⚔️' },
  { id: 'yut-02', category: 'ยุทธภพ', text: 'ตื่นเช้ามาเปิดร้านทุกวันนี่คือการสะสมพลังภายในค่ะ วันละนิด สักวันก็เป็นจอมยุทธประจำย่านแน่นอน ⚔️' },
  { id: 'yut-03', category: 'ยุทธภพ', text: 'เจ้าของร้านคือเจ้าสำนักตัวจริงค่ะ ทีมงานคือศิษย์พี่ศิษย์น้อง ส่วนน้องมั่งมีขอเป็นเด็กถือกระบี่ตามหลังนะคะ 😄' },
  { id: 'yut-04', category: 'ยุทธภพ', text: 'วันที่ลูกค้าเยอะจนหัวหมุน ถือว่าซ้อมวิชาหนักหน่อยค่ะ จอมยุทธเก่ง ๆ ก็ผ่านวันแบบนี้มาทั้งนั้นนะคะ 💚' },
  { id: 'yut-05', category: 'ยุทธภพ', text: 'ขอส่งพลังภายในให้หนึ่งกระบวนท่านะคะ วันนี้ลุยให้ผ่านก่อน พรุ่งนี้ค่อยขึ้นวิชาใหม่ค่ะ ⚔️' },

  // ไอดอล — center/แท่งไฟ/แฟนคลับ framing, aimed at the reader. No groups, no members, no songs.
  { id: 'idol-01', category: 'ไอดอล', text: 'วันนี้เหนื่อยไหมคะ อย่าลืมว่าเจ้าของร้านคือคนสำคัญของร้านนี้เลยนะ แฟนคลับ (น้องมั่งมี) เป็นกำลังใจให้ค่ะ 💚' },
  { id: 'idol-02', category: 'ไอดอล', text: 'วันนี้ขอโบกแท่งไฟให้เจ้าของร้านหนึ่งรอบค่ะ ทำงานมาทั้งวัน สมควรได้เสียงเชียร์นะคะ 😄' },
  { id: 'idol-03', category: 'ไอดอล', text: 'เปิดร้านทุกเช้าแบบนี้คือขึ้นเวทีจริงเลยนะคะ ไม่มีรอบซ้อม มีแต่รอบจริงทุกวัน เก่งมากค่ะ 💚' },
  { id: 'idol-04', category: 'ไอดอล', text: 'ลูกค้าประจำก็คือแฟนคลับตัวจริงค่ะ มากี่รอบก็ยังมา น่ารักที่สุดเลยนะคะ 😊' },
  { id: 'idol-05', category: 'ไอดอล', text: 'ถ้ามีเวทีประกาศรางวัล "คนขยันแห่งปี" น้องมั่งมีขอโหวตให้เจ้าของร้านค่ะ 555' },

  // กระแส — deliberately EMPTY. Trend jokes go stale fast, so this category is for the team to
  // hand-curate on the day and let rotate out naturally: drop entries here, delete them when the
  // moment passes. Same writing rules apply, especially the no-real-names one.
];
