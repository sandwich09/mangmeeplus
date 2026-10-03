import { EXECUTIVE_UNKNOWN_LABEL, EXECUTIVE_REPORT_LABELS, EXECUTIVE_FLAG_LABELS } from '@watchdog-bms/contracts';

const COMPANY_CUSTOMERS = 'บริษัทลูกค้า';
const WEIGHT = 'ยอดที่ใช้คำนวณสัดส่วน';

// Page copy only. Filter values, orders, purchase groups and event names stay in contracts.
export const W = {
  report: 'รายงานผู้บริหาร', executive: 'ผู้บริหาร', navigation: 'ส่วนงานผู้บริหาร',
  overview: 'ภาพรวมธุรกิจมั่งมี', usage: 'การใช้งาน', revenue: 'รายรับ', customers: 'ลูกค้าและที่มา', compare: 'เปรียบเทียบ', companies: COMPANY_CUSTOMERS, detail: 'รายละเอียดบริษัท',
  adoption: 'การเริ่มใช้', ranking: 'อันดับการใช้', summary: 'สรุปรายรับ', top: 'ลูกค้าที่สร้างรายรับสูง',
  industry: 'ธุรกิจ', discovery: 'ช่องทาง', sales: 'เซลล์', referring: 'เซลล์ผู้แนะนำ', credited: 'ยอดขายครั้งแรกของเซลล์',
  companyTab: 'ข้อมูลบริษัท', usageTab: 'การใช้งานและรายรับ', history: 'ประวัติบริษัท',
  month: 'เดือนรายงาน', filters: 'ตัวกรอง', clear: 'ล้างตัวกรอง', retry: 'ลองอีกครั้ง', loading: 'กำลังอ่านข้อมูล…', readFailed: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่',
  noData: 'ยังไม่มีข้อมูลของเดือนนี้', empty: 'ไม่พบบริษัทที่ตรงกับตัวกรอง', noHistory: 'ยังไม่มีประวัติบริษัท', noRows: 'ไม่มีรายการตามเงื่อนไขที่เลือก',
  allCompanies: 'ดูบริษัททั้งหมด', allRanks: 'ดูอันดับทั้งหมด', listGroup: 'ดูรายชื่อลูกค้ากลุ่มนี้', previousMonth: 'ดูเดือนที่แล้ว',
  choose: 'เลือกสองกลุ่มที่ต้องการเปรียบเทียบ', same: 'เลือกคนละกลุ่มหรือคนละบริษัทเพื่อเปรียบเทียบ', chooseCompanies: 'เลือกสองบริษัทจากรายชื่อบริษัทลูกค้า',
  sideA: 'ฝั่งแรก', sideB: 'ฝั่งที่สอง', difference: 'ต่างกัน (ฝั่งแรกลบฝั่งที่สอง)', swap: 'สลับฝั่ง', dimension: 'เปรียบเทียบตาม',
  compareBase: 'เริ่มจากบริษัทลูกค้าทั้งหมดในเดือนที่เลือก หน้านี้ไม่ใช้ตัวกรองของรายงาน',
  detailBase: 'รายละเอียดใช้เฉพาะบริษัทและเดือนที่เลือก หน้านี้ไม่ใช้ตัวกรองของรายงาน',
  compareList: 'รายชื่อนี้มาจากหน้าเปรียบเทียบ ไม่ใช้ตัวกรองของรายงาน',
  pick: 'เงื่อนไขที่กดมา', removePick: 'ล้างเงื่อนไขที่กดมา', selectCompare: 'เลือกเพื่อเปรียบเทียบ', compareTwo: 'เปรียบเทียบ 2 บริษัทนี้',
  search: 'ค้นหาบริษัท', searchHint: 'ชื่อบริษัท ชื่อจดทะเบียน หรือจังหวัด', sort: 'เรียงตาม',
  filterLabels: { industry: 'ประเภทธุรกิจ', discovery: 'รู้จักมั่งมีจากไหน', referringSales: 'เซลล์ผู้แนะนำ', companyStatus: 'สถานะบริษัท (ปัจจุบัน)', planState: 'สถานะแพ็กเกจ (ปัจจุบัน)', usageGroup: 'การชำระและใช้งาน', paidEver: EXECUTIVE_REPORT_LABELS.paidEver.YES!, receiptAdoption: 'ประวัติเพิ่มใบเสร็จ', spendCohort: 'กลุ่มลูกค้าตามยอดจ่าย', signupRail: 'ทางเข้าสมัคร' },
  company: 'บริษัท', registered: 'ชื่อจดทะเบียน', province: 'จังหวัด', group: 'กลุ่มธุรกิจ', businessType: 'ประเภทกิจการ', joined: 'วันที่สมัคร',
  service: 'บริการ', origin: 'ที่มา', plan: 'แพ็กเกจ (ปัจจุบัน)', planEnds: 'วันสิ้นสุดแพ็กเกจ', members: 'สมาชิกที่ใช้งานอยู่', branches: 'สาขา',
  companyCount: COMPANY_CUSTOMERS, active: EXECUTIVE_FLAG_LABELS.activeInPeriod.true!, paid: EXECUTIVE_FLAG_LABELS.paidInPeriod.true!, net: 'ยอดรับสุทธิในเดือน', receipts: 'เงินรับในเดือน', refunds: 'คืนเงินในเดือน',
  fees: 'ค่าธรรมเนียมการรับชำระ', tax: 'ภาษีมูลค่าเพิ่ม', aiCost: 'ต้นทุนผู้ช่วยและการอ่านใบเสร็จที่วัดได้',
  receiptCount: 'ใบเสร็จในเดือน', lifetimeReceipts: 'ใบเสร็จสะสม', days: 'วันใช้งาน', users: 'ผู้ใช้ที่ใช้งาน', documents: 'เอกสาร', ai: 'ใช้ผู้ช่วย',
  netPerCompany: 'ยอดรับสุทธิต่อบริษัท', receiptsPerCompany: 'ใบเสร็จต่อบริษัท', adoptionShare: 'สัดส่วนบริษัทที่เคยเพิ่มใบเสร็จ',
  adoptionTitle: 'การเริ่มใช้ใบเสร็จ', receiptDefinition: 'ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่ม', documentDefinition: 'เอกสารคือรายจ่ายที่ยืนยันแล้วกับเอกสารขายที่ออกในเดือน',
  usersDefinition: 'นับผู้ที่ยืนยันรายจ่ายหรือสร้างเอกสารขาย ไม่นับผู้ที่ใช้เฉพาะผู้ช่วย', aiDefinition: 'ใช้ผู้ช่วยคือจำนวนครั้งที่ถามผู้ช่วย',
  excluded: 'ไม่รวมบริษัททดสอบและบริษัทของมั่งมี', cumulative: 'สะสมถึงเวลาของข้อมูล', activityDefinition: 'นับการใช้ระบบจริง ไม่นับการเข้าเว็บ',
  paidDefinition: 'มีเงินรับในเดือนที่เลือก แม้คืนเงินภายหลัง', noReceipts: 'ไม่มีเงินรับในเดือน', noPositiveNet: 'ยอดรับไม่มากกว่ายอดคืนในเดือน',
  moneyDefinition: 'เงินที่ลูกค้าจ่ายให้มั่งมี หักคืนเงิน ยังไม่หักค่าธรรมเนียมหรือต้นทุน', vatIncluded: 'รวมภาษีมูลค่าเพิ่ม',
  atLeast: 'อย่างน้อย', partialMoney: 'ยอดเฉพาะรายการที่ยืนยันแล้ว', negative: 'คืนเงินมากกว่าเงินรับ',
  followUp: 'เรื่องที่ควรดูต่อ', paidUsage: 'ชำระเงินแล้ว ใช้งานเป็นอย่างไร', rankTitle: 'บริษัทที่ใช้งานมากที่สุด',
  positive: EXECUTIVE_FLAG_LABELS.positiveNetInPeriod.true!, positiveNet: 'ยอดรับสุทธิที่เป็นบวก', weight: WEIGHT, weightDefinition: 'ยอดจ่ายหลังหักคืนเงินที่มากกว่า 0',
  negativeTotal: 'ยอดติดลบรวม', notInShare: 'ไม่นับในสัดส่วน', cumulativeShare: 'สัดส่วนสะสม',
  tieOrder: 'ถ้ายอดเท่ากัน บริษัทที่สมัครก่อนอยู่ก่อน', partialRanking: 'ข้อมูลการรับเงินยังไม่ครบ จึงยังจัดอันดับทั้งหมดไม่ได้', fewPositive: 'มีบริษัทที่จ่ายมากกว่ายอดคืนไม่ถึง 20% ของบริษัททั้งหมด',
  rounding: 'ผลรวมไม่เท่ากับ 100.0% เพราะการปัดเศษ', chartHint: 'แตะสีหรือชื่อกลุ่มเพื่อดูบริษัท',
  current: 'ปัจจุบัน', partialMonth: 'เดือนนี้ยังไม่จบ', updated: 'อัปเดตข้อมูลแล้ว ตัวเลขอาจเปลี่ยน',
  firstActivity: 'ใช้ระบบครั้งแรก', lastActivity: 'ใช้ระบบล่าสุด', lastWeb: 'เข้าเว็บล่าสุด', lastLine: 'ใช้ผ่านไลน์ล่าสุด', web: 'เว็บ', line: 'ไลน์',
  purchase: 'ประเภทการซื้อ', trend: 'แนวโน้มยอดรับสุทธิ 6 เดือน', unmatched: 'เงินที่ยังไม่ผูกบริษัท', excludedNet: 'ยอดรับของบริษัททดสอบและบริษัทของมั่งมี (ไม่รวมในรายงาน)', unclassifiedNet: 'ยอดรับของบริษัทที่ยังไม่ได้จัดประเภท', disputes: 'ใบที่มีข้อโต้แย้งการชำระ',
  creditAmount: 'ยอดชำระครั้งแรกสะสม', creditedSeller: 'เซลล์ที่ได้รับยอดขายครั้งแรก', creditAt: 'วันที่นับยอดให้เซลล์', waiting: 'รอตรวจ',
  creditNotes: ['รายการที่ติดธงและยังไม่ตรวจนับเป็นศูนย์', 'คืนเงินหลัง 60 วันไม่หักจากยอดนี้', 'ฐานของยอดนี้อาจต่างจากยอดรับ ห้ามนำยอดนี้ไปบวกหรือลบกับยอดรับ'],
  email: 'อีเมลเจ้าของบัญชี', phoneNumber: 'เบอร์โทรเจ้าของบัญชี', contactMissing: 'ยังไม่มีข้อมูล', multipleOwners: 'มีเจ้าของหลายบัญชี', noOwner: 'ไม่พบบัญชีเจ้าของปัจจุบัน',
  management: 'บริษัทและผู้ใช้งาน', unknown: EXECUTIVE_UNKNOWN_LABEL,
  wait: (n: number) => `กรุณารอ ${n} วินาทีแล้วลองใหม่`,
  unitCompany: 'บริษัท', unitReceipt: 'ใบ', unitDay: 'วัน', unitRequest: 'ครั้ง', point: 'จุด',
  back: (title: string) => `← กลับ${title}`,
  through: (at: string) => `ข้อมูลถึง ${at}`, moneyThrough: (at: string) => `ข้อมูลเงินถึง ${at}`, revised: (at: string) => `ปรับปรุงเมื่อ ${at}`,
  staleAt: (at: string) => `ตัวเลขเป็นของ ${at}`, contactAt: (at: string) => `ข้อมูลบัญชี ณ ${at}`,
  base: (n: string | number) => `จาก ${n} บริษัท`, found: (n: number) => `พบ ${n.toLocaleString('th-TH')} บริษัท`,
  unclassified: (n: number) => `ยังไม่ได้จัดประเภท ${n.toLocaleString('th-TH')} บริษัท`,
  industryCoverage: (x: number, n: number) => `มีข้อมูลประเภทธุรกิจ ${x.toLocaleString('th-TH')} จาก ${n.toLocaleString('th-TH')} บริษัท`,
  unpaidActive: (n: number) => `รวมบริษัทที่ยังไม่เคยชำระแต่ใช้งานอยู่ ${n.toLocaleString('th-TH')} บริษัท`,
  paymentUnknownActive: (n: number) => `รวมบริษัทที่ข้อมูลการชำระไม่ครบแต่ใช้งานอยู่ ${n.toLocaleString('th-TH')} บริษัท`,
  refundedDifference: (n: number) => `ต่างจาก “ชำระในเดือน” ${n.toLocaleString('th-TH')} บริษัทเพราะยอดรับไม่มากกว่ายอดคืนในเดือน`,
  rankBase: (n: number, label: string) => `10 อันดับแรกจาก ${n.toLocaleString('th-TH')} บริษัท ตาม${label}`,
  rankingTie: (n: number, value: string, unit: string) => `มีอีก ${n.toLocaleString('th-TH')} บริษัทที่ค่าเท่ากับอันดับสุดท้ายที่แสดง (${value} ${unit})`,
  groupCompanies: (n: number, of: number, share: string) => `${n.toLocaleString('th-TH')} จาก ${of.toLocaleString('th-TH')} บริษัท (${share})`,
  ofWeight: (share: string) => `${share} ของ${WEIGHT}`,
  nonPositive: (n: number) => `ยอดรับสุทธิในเดือนเป็น 0 หรือติดลบ ${n.toLocaleString('th-TH')} บริษัท`,
  spendTie: (n: number, amount: string) => `มีอีก ${n.toLocaleString('th-TH')} บริษัทที่จ่ายเท่ากับลำดับสุดท้ายของกลุ่ม (${amount}) แต่อยู่นอกกลุ่ม`,
  spendTitle: (month: string) => `รายรับในเดือน ${month} มาจากลูกค้ากลุ่มใด`,
};
export const EXECUTIVE_MENU = (['overview', 'usage', 'revenue', 'customers', 'compare', 'companies'] as const).map(key => ({ key, label: W[key], group: W.report, href: key === 'overview' ? '/system/executive' : `/system/executive/${key}` }));
export const REPORT_VIEWS = { usage: [{ value: 'adoption', label: W.adoption }, { value: 'ranking', label: W.ranking }], revenue: [{ value: 'summary', label: W.summary }, { value: 'top', label: W.top }], customers: [{ value: 'industry', label: W.industry }, { value: 'discovery', label: W.discovery }, { value: 'sales', label: W.sales }] };
export const DETAIL_TABS = [{ value: 'company', label: W.companyTab }, { value: 'usage', label: W.usageTab }, { value: 'history', label: W.history }];
export const RANK_LABELS = { expenseReceiptCount: { label: W.receiptCount, unit: W.unitReceipt }, activeDays: { label: W.days, unit: W.unitDay }, aiRequests: { label: W.ai, unit: W.unitRequest } };

// Contract labels contain familiar product names; the lane requires Thai-only control text.
const THAI_NAMES: Record<string, string> = { Website: 'เว็บไซต์', IG: 'อินสตาแกรม', TikTok: 'ติ๊กต็อก', Facebook: 'เฟซบุ๊ก', LINE: W.line, AI: 'ปัญญาประดิษฐ์' };
export const thaiLabel = (label: string, code?: string) => {
  const suffix = code ? ` · ${code}` : '';
  const name = code && label === code ? W.unknown : suffix && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
  return name.replace(/\s+UAT\b/g, '').replace(/(ทาง|ผ่าน) (?=LINE\b)/g, '$1').replace(/ค่า (?=AI\b)/g, 'ค่า').replace(/\b(Website|IG|TikTok|Facebook|LINE|AI)\b/g, word => THAI_NAMES[word]!);
};
