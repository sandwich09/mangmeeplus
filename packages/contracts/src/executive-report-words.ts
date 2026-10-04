import { EXECUTIVE_UNKNOWN_LABEL, EXECUTIVE_REPORT_LABELS, EXECUTIVE_FLAG_LABELS, type ExecutiveCoverage, type ExecutiveReasonCode, type ExecutivePeriodComparison, type ExecutiveSortBy, type ExecutiveSourceCoverage } from './executive-business.js';
import { billingPlanLabel } from './billing-labels.js';

const COMPANY_CUSTOMERS = 'บริษัทลูกค้า';
const WEIGHT = 'ยอดที่ใช้คำนวณสัดส่วน';
const MISSING_DATA = 'ยังไม่มีข้อมูล';
const YES = 'ใช่';
const RANK = 'อันดับ';

// Shared screen/workbook words. Filter values and enums remain in executive-business.
const BASE = 'จาก';

export const EXECUTIVE_WORDS = {
  export: { action: 'ส่งออก Excel', create: 'สร้างไฟล์ Excel', format: 'พร้อมกราฟและข้อมูลรายบริษัท', preparing: 'กำลังสร้างไฟล์…', done: 'ส่งไฟล์ให้เบราว์เซอร์แล้ว', failed: 'สร้างไฟล์ไม่สำเร็จ ลองใหม่ได้โดยใช้เงื่อนไขเดิม', downloadFailed: 'ดาวน์โหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่', expired: 'ข้อมูลรายงานเก่าแล้ว กรุณาโหลดใหม่ก่อนสร้างไฟล์', contacts: 'รวมข้อมูลติดต่อเจ้าของบัญชี', contactHint: 'เมื่อเลือก ไฟล์จะมีคอลัมน์อีเมลและเบอร์โทรของเจ้าของร้าน ซึ่งเป็นข้อมูลส่วนบุคคล', personal: 'มีข้อมูลส่วนบุคคล ใช้ภายในเท่านั้น', sheets: 'ชีตในไฟล์', columns: 'หัวคอลัมน์รายบริษัท', none: 'ไม่มี', reference: 'เลขอ้างอิงการส่งออก', notes: 'หมายเหตุข้อมูล', contactNotes: 'หมายเหตุข้อมูลติดต่อ', calculations: 'ตัวเลขที่ใช้ในกราฟ', busy: 'มีไฟล์ที่กำลังสร้างอยู่ กรุณารอให้เสร็จก่อน', limit: 'ไฟล์นี้เกินขีดจำกัดที่ระบบสร้างได้ กรุณาลองใหม่หรือเลือกบริษัทให้น้อยลง', empty: 'ไม่มีบริษัทตามเงื่อนไข จึงไม่มีไฟล์ให้สร้าง', denied: 'คุณไม่มีสิทธิ์ส่งออกไฟล์นี้', buckets: ['ไม่มีใบเสร็จ', '1–5 รายการ', '6 รายการขึ้นไป'], bucketsDefinition: 'แบ่งตามจำนวนใบเสร็จค่าใช้จ่ายสะสมถึงวันที่สรุป เฉพาะบริษัทที่ประเมินระดับได้', usageMissing: 'ข้อมูลการใช้งานไม่ครบ', moneyMissing: 'ข้อมูลการชำระไม่ครบ', aiMissing: 'ข้อมูลต้นทุนผู้ช่วยไม่ครบ', rank: RANK, to80: 'อยู่ในกลุ่มที่รวมยอดรับถึง 80%', yes: YES, no: 'ไม่ใช่', unavailable: 'ระบบยังอ่านข้อมูลส่วนนี้ไม่ได้', sentBy: (name: string, at: string) => `ส่งออกโดย ${name} เมื่อ ${at}` },
  report: 'รายงานผู้บริหาร', executive: 'ผู้บริหาร', navigation: 'ส่วนงานผู้บริหาร',
  overview: 'ภาพรวมธุรกิจมั่งมี', usage: 'การใช้งาน', revenue: 'รายรับ', customers: 'ลูกค้าและที่มา', compare: 'เปรียบเทียบ', companies: COMPANY_CUSTOMERS, detail: 'รายละเอียดบริษัท',
  descriptions: { overview: 'สรุปธุรกิจและเรื่องที่ควรดูต่อ', usage: 'ลูกค้าเริ่มใช้หรือยัง และใช้งานมากแค่ไหน', revenue: 'รับเงินเท่าไร และลูกค้ากลุ่มไหนสร้างรายรับ', customers: 'ลูกค้ามาจากไหน และกลุ่มไหนสร้างรายรับ', compare: 'เปรียบเทียบยอดรวมและค่าเฉลี่ยต่อบริษัท', companies: 'เจาะดูบริษัทจากกลุ่มที่เลือก', detail: 'ข้อมูลบริษัทเพื่อวิเคราะห์ธุรกิจ' },
  adoption: 'การเริ่มใช้', ranking: 'อันดับการใช้', summary: 'สรุปรายรับ', top: 'ลูกค้าที่สร้างรายรับสูง',
  industry: 'ธุรกิจ', discovery: 'ช่องทาง', sales: 'เซลล์', referring: 'เซลล์ผู้แนะนำ', credited: 'ยอดขายครั้งแรกของเซลล์',
  companyTab: 'ข้อมูลบริษัท', usageTab: 'การใช้งานและรายรับ', history: 'ประวัติบริษัท',
  month: 'เดือนรายงาน', filters: 'ตัวกรอง', clear: 'ล้างตัวกรอง', retry: 'ลองอีกครั้ง', loading: 'กำลังอ่านข้อมูล…', readFailed: 'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่',
  applyFilters: 'ใช้ตัวกรอง', close: 'ปิด', followUpBand: 'ควรติดตาม:',
  removeFilter: (label: string) => `ล้างตัวกรอง ${label}`,
  reportFilters: 'ตัวกรองรายงาน', companyFilters: 'ตัวกรองรายชื่อบริษัท', unavailableFigure: 'ยังไม่มีตัวเลข',
  historyBeforeCollection: 'ยังไม่มีข้อมูลของช่วงนี้ เพราะเป็นช่วงก่อนที่ระบบเริ่มเก็บ',
  historyBeforeCollectionPartial: 'ตัวเลขนี้ครอบคลุมเฉพาะข้อมูลที่เก็บได้ ช่วงก่อนเริ่มเก็บยังประเมินไม่ได้',
  historyBeforeFirstBuild: 'ข้อมูลก่อนเริ่มทำรายงาน นับได้เฉพาะรายการที่ยังเหลืออยู่',
  historyBeforeFirstBuildUnavailable: 'ยังไม่มีตัวเลขของช่วงก่อนเริ่มทำรายงาน',
  sourceRowsPurged: 'ใช้จำนวนที่เคยบันทึกไว้ เพราะรายการต้นทางถูกลบแล้ว',
  sourceRowsPurgedUnavailable: 'รายการต้นทางถูกลบแล้ว จึงไม่มีตัวเลขของส่วนนี้',
  fewCompanies: 'บริษัทน้อยเกินไปสำหรับการแบ่งกลุ่ม', noPositiveCompanies: 'ไม่มีบริษัทที่จ่ายมากกว่ายอดคืนเงินในเดือน จึงยังคำนวณสัดส่วนรายรับไม่ได้',
  manualTerm: 'ผู้ดูแลตั้งแพ็กเกจให้ ไม่มีหลักฐานรับเงินในระบบ', addOnNotSold: 'ยังไม่เปิดขาย',
  noData: 'ยังไม่มีข้อมูลของเดือนนี้', empty: 'ไม่พบบริษัทที่ตรงกับตัวกรอง', noHistory: 'ยังไม่มีประวัติบริษัท', noRows: 'ไม่มีรายการตามเงื่อนไขที่เลือก',
  allCompanies: 'ดูบริษัททั้งหมด', allRanks: 'ดูอันดับทั้งหมด', rank: RANK, listGroup: 'ดูรายชื่อลูกค้ากลุ่มนี้', previousMonth: 'ดูเดือนที่แล้ว',
  seeRanking: 'ดูอันดับการใช้', seeCompanies: 'ดูบริษัท →', originTitle: 'ที่มาของบริษัท', topShareTitle: 'สัดส่วนยอดจากกลุ่มที่จ่ายสูงสุด',
  followUpDescriptions: { NOT_STARTED: 'เคยชำระเงิน แต่ยังไม่พบการใช้ระบบ', INACTIVE: 'เคยชำระเงินและเคยใช้ระบบ แต่ไม่พบการใช้ในเดือนที่เลือก', top: 'ดูสัดส่วนรายรับของกลุ่มที่จ่ายสูงสุดในเดือนที่เลือก' },
  choose: 'เลือกสองกลุ่มที่ต้องการเปรียบเทียบ', same: 'เลือกคนละกลุ่มหรือคนละบริษัทเพื่อเปรียบเทียบ', chooseCompanies: 'เลือกสองบริษัทจากรายชื่อบริษัทลูกค้า',
  sideA: 'ฝั่งแรก', sideB: 'ฝั่งที่สอง', difference: 'ต่างกัน (ฝั่งแรกลบฝั่งที่สอง)', item: 'รายการ', swap: 'สลับฝั่ง', dimension: 'เปรียบเทียบตาม',
  compareBase: 'เริ่มจากบริษัทลูกค้าทั้งหมดในเดือนที่เลือก หน้านี้ไม่ใช้ตัวกรองของรายงาน',
  detailBase: 'รายละเอียดใช้เฉพาะบริษัทและเดือนที่เลือก หน้านี้ไม่ใช้ตัวกรองของรายงาน',
  compareList: 'รายชื่อนี้มาจากหน้าเปรียบเทียบ ไม่ใช้ตัวกรองของรายงาน',
  pick: 'เงื่อนไขที่กดมา', removePick: 'ล้างเงื่อนไขที่กดมา', selectCompare: 'เลือกเพื่อเปรียบเทียบ', compareTwo: 'เปรียบเทียบ 2 บริษัทนี้',
  search: 'ค้นหาบริษัท', searchHint: 'ชื่อบริษัท ชื่อจดทะเบียน หรือจังหวัด', sort: 'เรียงตาม',
  get filterLabels() { return { industry: 'ประเภทธุรกิจ', discovery: 'รู้จักมั่งมีจากไหน', referringSales: 'เซลล์ผู้แนะนำ', companyStatus: 'สถานะบริษัท (ปัจจุบัน)', planState: 'สถานะแพ็กเกจ (ปัจจุบัน)', usageGroup: 'การชำระและใช้งาน', paidEver: EXECUTIVE_REPORT_LABELS.paidEver.YES!, receiptAdoption: 'ประวัติเพิ่มใบเสร็จ', spendCohort: 'กลุ่มลูกค้าตามยอดจ่าย', signupRail: 'ทางเข้าสมัคร' }; },
  side: 'ฝั่ง', figure: 'ตัวเลข',
  company: 'บริษัท', registered: 'ชื่อจดทะเบียน', province: 'จังหวัด', group: 'กลุ่มธุรกิจ', businessType: 'ประเภทกิจการ', joined: 'วันที่สมัคร',
  service: 'บริการ', origin: 'ที่มา', plan: 'แพ็กเกจ (ปัจจุบัน)', planEnds: 'วันสิ้นสุดแพ็กเกจ', members: 'สมาชิกที่ใช้งานอยู่', branches: 'สาขา',
  companyCount: COMPANY_CUSTOMERS, get active() { return EXECUTIVE_FLAG_LABELS.activeInPeriod.true!; }, get paid() { return EXECUTIVE_FLAG_LABELS.paidInPeriod.true!; }, net: 'ยอดรับสุทธิในเดือน', receipts: 'เงินรับในเดือน', refunds: 'คืนเงินในเดือน',
  fees: 'ค่าธรรมเนียมการรับชำระ', tax: 'ภาษีมูลค่าเพิ่ม', aiCost: 'ต้นทุนผู้ช่วยและการอ่านใบเสร็จที่วัดได้',
  receiptCount: 'ใบเสร็จในเดือน', lifetimeReceipts: 'ใบเสร็จสะสม', days: 'วันใช้งาน', users: 'ผู้ใช้ที่ใช้งาน', documents: 'เอกสาร', ai: 'ใช้ผู้ช่วย',
  netPerCompany: 'ยอดรับสุทธิต่อบริษัท', receiptsPerCompany: 'ใบเสร็จต่อบริษัท', adoptionShare: 'สัดส่วนบริษัทที่เคยเพิ่มใบเสร็จ',
  adoptionTitle: 'การเริ่มใช้ใบเสร็จ', receiptDefinition: 'ใบเสร็จค่าใช้จ่ายที่ลูกค้าเพิ่ม', documentDefinition: 'เอกสารคือรายจ่ายที่ยืนยันแล้วกับเอกสารขายที่ออกในเดือน',
  usersDefinition: 'นับผู้ที่ยืนยันรายจ่ายหรือสร้างเอกสารขาย ไม่นับผู้ที่ใช้เฉพาะผู้ช่วย', aiDefinition: 'ใช้ผู้ช่วยคือจำนวนครั้งที่ถามผู้ช่วย',
  excluded: 'ไม่รวมบริษัททดสอบและบริษัทของมั่งมี', cumulative: 'สะสมถึงเวลาของข้อมูล', activityDefinition: 'นับการใช้ระบบจริง ไม่นับการเข้าเว็บ',
  paidDefinition: 'มีเงินรับในเดือนที่เลือก แม้คืนเงินภายหลัง', yes: YES, noReceipts: 'ไม่มีเงินรับในเดือน', noPositiveNet: 'ยอดรับไม่มากกว่ายอดคืนในเดือน',
  moneyDefinition: 'เงินที่ลูกค้าจ่ายให้มั่งมี หักคืนเงิน ยังไม่หักค่าธรรมเนียมหรือต้นทุน', vatIncluded: 'รวมภาษีมูลค่าเพิ่ม',
  atLeast: 'อย่างน้อย', partialMoney: 'ยอดเฉพาะรายการที่ยืนยันแล้ว', negative: 'คืนเงินมากกว่าเงินรับ',
  partialMeasuredMoney: 'ยอดเฉพาะช่วงที่วัดได้',
  followUp: 'เรื่องที่ควรดูต่อ', paidUsage: 'ชำระเงินแล้ว ใช้งานเป็นอย่างไร', rankTitle: 'บริษัทที่ใช้งานมากที่สุด',
  get positive() { return EXECUTIVE_FLAG_LABELS.positiveNetInPeriod.true!; }, positiveNet: 'ยอดรับสุทธิที่เป็นบวก', weight: WEIGHT, weightDefinition: 'ยอดจ่ายหลังหักคืนเงินที่มากกว่า 0',
  negativeTotal: 'ยอดติดลบรวม', notInShare: 'ไม่นับในสัดส่วน', cumulativeShare: 'สัดส่วนสะสม',
  tieOrder: 'ถ้ายอดเท่ากัน บริษัทที่สมัครก่อนอยู่ก่อน', partialRanking: 'ข้อมูลการรับเงินยังไม่ครบ จึงยังจัดอันดับทั้งหมดไม่ได้', fewPositive: 'มีบริษัทที่จ่ายมากกว่ายอดคืนไม่ถึง 20% ของบริษัททั้งหมด',
  rounding: 'ผลรวมไม่เท่ากับ 100.0% เพราะการปัดเศษ', chartHint: 'แตะสีหรือชื่อกลุ่มเพื่อดูบริษัท',
  current: 'ปัจจุบัน', partialMonth: 'เดือนนี้ยังไม่จบ', updated: 'อัปเดตข้อมูลแล้ว ตัวเลขอาจเปลี่ยน',
  firstActivity: 'ใช้ระบบครั้งแรก', lastActivity: 'ใช้ระบบล่าสุด', lastWeb: 'เข้าเว็บล่าสุด', lastLine: 'ใช้ผ่านไลน์ล่าสุด', web: 'เว็บ', line: 'ไลน์',
  purchase: 'ประเภทการซื้อ', trend: 'แนวโน้มยอดรับสุทธิ 6 เดือน', unmatched: 'เงินที่ยังไม่ผูกบริษัท', excludedNet: 'ยอดรับของบริษัททดสอบและบริษัทของมั่งมี (ไม่รวมในรายงาน)', unclassifiedNet: 'ยอดรับของบริษัทที่ยังไม่ได้จัดประเภท', disputes: 'ใบที่มีข้อโต้แย้งการชำระ',
  creditAmount: 'ยอดชำระครั้งแรกสะสม', creditedSeller: 'เซลล์ที่ได้รับยอดขายครั้งแรก', creditAt: 'วันที่นับยอดให้เซลล์', waiting: 'รอตรวจ',
  creditNotes: ['รายการที่ติดธงและยังไม่ตรวจนับเป็นศูนย์', 'คืนเงินหลัง 60 วันไม่หักจากยอดนี้', 'ฐานของยอดนี้อาจต่างจากยอดรับ ห้ามนำยอดนี้ไปบวกหรือลบกับยอดรับ'],
  email: 'อีเมลเจ้าของบัญชี', phoneNumber: 'เบอร์โทรเจ้าของบัญชี', contactMissing: MISSING_DATA, contactNotPermitted: 'ไม่มีสิทธิ์ดูข้อมูลติดต่อ', multipleOwners: 'มีเจ้าของหลายบัญชี', noOwner: 'ไม่พบบัญชีเจ้าของปัจจุบัน',
  management: 'บริษัทและผู้ใช้งาน', get unknown() { return EXECUTIVE_UNKNOWN_LABEL; },
  wait: (n: number) => `กรุณารอ ${n} วินาทีแล้วลองใหม่`,
  incompleteHeading: 'ตัวเลขบางส่วนยังไม่ครบ', incompleteLegend: 'ยังไม่ครบ', details: 'รายละเอียด', more: 'ดูเพิ่ม', less: 'ย่อ',
  confirmedOnly: 'เฉพาะที่ยืนยันแล้ว', countAtLeast: 'นับได้อย่างน้อย', measuredOnly: 'เฉพาะช่วงที่วัดได้',
  moneySource: 'เงิน', aiCostSource: 'ต้นทุนผู้ช่วย',
  confirmedSummary: 'นับเฉพาะรายการที่ยืนยันแล้ว', usageUnassessed: 'ยังประเมินการใช้งานไม่ได้', paymentUnassessed: 'ยังประเมินการชำระไม่ได้',
  status: 'สถานะ', historyAt: 'วันเวลา', shortPlan: 'แพ็กเกจ', shortNet: 'ยอดรับสุทธิ', shortReceipts: 'เงินรับ', shortRefunds: 'คืนเงิน', shortFees: 'ค่าธรรมเนียม',
  shortPaidUsage: 'ลูกค้าที่จ่ายแล้ว',
  tableReceipts: 'ใบเสร็จเดือน', tableNet: 'สุทธิ', shortCompare: 'เทียบ', shortJoined: 'สมัคร',
  shortTrend: 'แนวโน้ม 6 เดือน', shortDifference: 'ต่างกัน', shortCumulative: 'สะสม %', quantity: 'จำนวน',
  unitBaht: 'บาท', unitInHeader: (label: string, unit: string) => `${label} (${unit})`,
  joinedShort: (at: string) => `สมัคร ${at}`,
  unitCompany: 'บริษัท', unitReceipt: 'ใบ', unitDay: 'วัน', unitRequest: 'ครั้ง', point: 'จุด',
  back: (title: string) => `← กลับ${title}`,
  through: (at: string) => `ข้อมูลถึง ${at}`, moneyThrough: (at: string) => `ข้อมูลเงินถึงวันที่ ${at}`, revised: (at: string) => `ปรับปรุงเมื่อ ${at}`,
  staleAt: (at: string) => `ตัวเลขเป็นของ ${at}`, contactAt: (at: string) => `ข้อมูลบัญชี ณ ${at}`,
  baseLabel: BASE, base: (n: string | number) => `${BASE} ${n} บริษัท`, found: (n: number) => `พบ ${n.toLocaleString('th-TH')} บริษัท`,
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
/** Screen figures and workbook chart rows choose qualifiers from the same source facts. */
export function executiveMoneyQualifier(source: ExecutiveSourceCoverage, measured = false): string {
  if (source.reasonCodes.includes('ADDON_NOT_ON_SALE')) return EXECUTIVE_WORDS.addOnNotSold;
  if (source.coverage === 'partial') return measured ? EXECUTIVE_WORDS.partialMeasuredMoney : EXECUTIVE_WORDS.partialMoney;
  return source.coverage === 'unavailable' ? EXECUTIVE_WORDS.unavailableFigure : '';
}
// Contract labels contain familiar product names; the lane requires Thai-only control text.
const THAI_NAMES: Record<string, string> = { Website: 'เว็บไซต์', IG: 'อินสตาแกรม', TikTok: 'ติ๊กต็อก', Facebook: 'เฟซบุ๊ก', LINE: EXECUTIVE_WORDS.line, AI: 'ปัญญาประดิษฐ์' };
export const executiveThaiLabel = (label: string, code?: string) => {
  const suffix = code ? ` · ${code}` : '';
  // A known product word ("IG" is both label and value) stays a name; a bare seller code does not.
  const name = code && label === code && !Object.hasOwn(THAI_NAMES, label) ? EXECUTIVE_WORDS.unknown : suffix && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
  return name.replace(/\s+UAT\b/g, '').replace(/(ทาง|ผ่าน) (?=LINE\b)/g, '$1').replace(/ค่า (?=AI\b)/g, 'ค่า').replace(/\b(Website|IG|TikTok|Facebook|LINE|AI)\b/g, word => THAI_NAMES[word]!);
};

export const EXECUTIVE_EXPORT_SHEETS = ['ภาพรวม', 'รายบริษัท'] as const;
const W = EXECUTIVE_WORDS;
/** Executive labels retain the catalogue's Thai name without its parenthesized code. */
export const executivePlanLabel = (key: string | null | undefined) => billingPlanLabel(key).replace(/\s*\([A-Z][A-Z0-9_]*\)$/, '');
export function executiveExportColumns(reportKey: string, subview?: string, contacts = false): string[] {
  return [W.company, W.registered, W.province, W.group, W.businessType, W.joined, W.filterLabels.companyStatus, W.plan, W.filterLabels.planState,
    W.filterLabels.discovery, 'รายละเอียดที่ลูกค้าระบุ', W.filterLabels.signupRail, W.referring, W.creditedSeller, 'ยอดชำระครั้งแรก (บาท)', W.creditAt,
    W.filterLabels.paidEver, W.filterLabels.usageGroup, W.filterLabels.receiptAdoption, W.lifetimeReceipts, W.receiptCount, 'วันใช้งานในเดือน', 'ผู้ใช้ที่ใช้งานในเดือน',
    'เอกสารในเดือน', 'ใช้ผู้ช่วยในเดือน (ครั้ง)', `${W.receipts} (บาท)`, `${W.refunds} (บาท)`, `${W.net} (บาท)`, 'ค่าธรรมเนียมการรับชำระในเดือน (บาท)',
    'ต้นทุนผู้ช่วยและการอ่านใบเสร็จในเดือน (บาท)', W.firstActivity, W.lastActivity, W.lastWeb, W.lastLine,
    ...(reportKey === 'usage' && subview === 'ranking' ? [W.export.rank] : []),
    ...(reportKey === 'revenue' && subview === 'top' ? ['อันดับตามยอดรับสุทธิ', `${W.weight} (บาท)`, W.cumulativeShare, W.filterLabels.spendCohort, W.export.to80] : []),
    ...(reportKey === 'compare' ? [W.side] : []), W.export.notes,
    ...(contacts ? [W.email, W.phoneNumber, W.export.contactNotes] : [])];
}

/** Company names are free text; only report dimension labels carry a system/seller code. */
export function executiveComparisonLabel(side: { key: string; label: string }, dimension: string): string {
  return dimension === 'company' ? side.label : executiveThaiLabel(side.label, side.key);
}


/** P01–P53: range controls and qualifiers shared by the web and XLSX; legacy month words above stay for old callers. */
export const EXECUTIVE_PERIOD_WORDS = {
  presets: { THIS_MONTH: 'เดือนนี้', LAST_MONTH: 'เดือนที่แล้ว', THIS_QUARTER: 'ไตรมาสนี้', THIS_YEAR: 'ปีนี้', LAST_12_MONTHS: '12 เดือนล่าสุด', ALL: 'ทั้งหมด' },
  tableReceipts: 'ใบเสร็จช่วงนี้', periodNotRegistered: 'ข้อมูลช่วงนี้อยู่ก่อนเวลาที่บริษัทสมัคร',
  affectedMonths: (months: string) => `ในเดือน ${months}`,
  documentDefinition: 'เอกสารคือรายจ่ายที่ยืนยันแล้วกับเอกสารขายที่ออกในช่วงที่เลือก',
  spendTitle: (period: string) => `รายรับ${period}มาจากลูกค้ากลุ่มใด`,
  nonPositive: (n: number) => `ยอดรับสุทธิในช่วงนี้เป็น 0 หรือติดลบ ${n.toLocaleString('th-TH')} บริษัท`,
  notRegistered: 'ข้อมูลเดือนนี้อยู่ก่อนเวลาที่บริษัทสมัคร', invalid: 'กรุณาเลือกเดือนเริ่มต้นและเดือนสิ้นสุดให้ถูกต้อง', custom: 'กำหนดช่วงเดือน', from: 'ตั้งแต่เดือน', to: 'ถึงเดือน', apply: 'ใช้ช่วงเดือน', previous: 'ช่วงก่อนหน้า',
  range: (from: string, to: string) => `ช่วงเดือน ${from}${from === to ? '' : ` ถึง ${to}`}`,
  unbuilt: (months: string) => `ยังไม่มีรายงานของเดือน ${months}`,
  missingMonths: (months: string) => `ช่วงที่เลือกมีเดือนที่ยังไม่มีรายงาน: ${months}`,
  distinctUsersUnavailable: 'ยังสรุปจำนวนผู้ใช้ไม่ซ้ำตลอดหลายเดือนไม่ได้',
  openMonth: 'ช่วงนี้รวมเดือนที่ยังไม่จบ', noPrevious: (period: string) => `ยังไม่มีตัวเลขของช่วงก่อนหน้า ${period}`,
  unchanged: 'เท่าเดิม', zeroBase: 'ช่วงก่อนเป็นศูนย์ จึงไม่แสดงร้อยละ', negativeBase: 'ช่วงก่อนมียอดติดลบ จึงไม่แสดงร้อยละ',
  cannotCompare: (months: string) => `ยังเทียบกับช่วงก่อนไม่ได้ เพราะข้อมูลของเดือน ${months} ยังไม่ครบ`,
  openComparison: 'ช่วงนี้ยังไม่ครบเดือน ตัวเลขเทียบกับช่วงก่อนที่ครบเดือนแล้ว',
  noFilters: 'ไม่ได้เพิ่มตัวกรองบริษัท', selectedBase: 'หน้านี้ใช้ช่วงเดือนและกลุ่มหรือบริษัทที่เลือก ไม่ใช้ตัวกรองรายงาน',
  all: 'ดูทั้งหมด', allPeriod: 'ตั้งแต่เดือนแรกถึงเดือนล่าสุดที่มีรายงาน',
  allCompanies: 'ดูบริษัทลูกค้าทั้งหมดในช่วงที่เลือก โดยไม่ใช้ตัวกรองบริษัท',
  currentAt: (at: string) => `ข้อมูลปัจจุบัน ณ ${at}`,
  incomplete: (months: string) => `ข้อมูลที่ใช้คำนวณตัวเลขนี้ยังไม่ครบในเดือน ${months}`,
  noneBuilt: 'ยังไม่มีเดือนที่สร้างรายงานแล้ว', change: (value: string) => `เปลี่ยนจากช่วงก่อน ${value}`,
  compareWith: (period: string) => `เทียบกับ ${period}`,
  active: 'ใช้งานในช่วงนี้', paid: 'ชำระในช่วงนี้', net: 'ยอดรับสุทธิในช่วงนี้', receipts: 'เงินรับในช่วงนี้', refunds: 'คืนเงินในช่วงนี้',
  positive: 'จ่ายมากกว่ายอดคืนในช่วงนี้', receiptCount: 'ใบเสร็จในช่วงนี้', fees: 'ค่าธรรมเนียมการรับชำระในช่วงนี้',
  tax: 'ภาษีมูลค่าเพิ่มในช่วงนี้', inactive: 'เคยใช้ แต่ไม่ใช้ในช่วงนี้', paidActive: 'จ่ายแล้ว ใช้งานในช่วงนี้',
  documents: 'เอกสารในช่วงนี้', ai: 'ถามผู้ช่วยในช่วงนี้', usersByMonth: 'จำนวนผู้ใช้แยกเดือน', monthlyHistory: 'ประวัติรายเดือน',
  get newCompanies() { return EXECUTIVE_FLAG_LABELS.joinedInPeriod.true!; }, trend: 'แนวโน้มรายเดือน', noReceipts: 'ไม่มีเงินรับในช่วงนี้', noPositiveNet: 'ยอดรับไม่มากกว่ายอดคืนในช่วงนี้',
  refundedDifference: (n: number) => `ต่างจาก “ชำระในช่วงนี้” ${n.toLocaleString('th-TH')} บริษัทเพราะยอดรับไม่มากกว่ายอดคืนในช่วงนี้`,
  paidDefinition: 'มีเงินรับในช่วงเดือนที่เลือก แม้คืนเงินภายหลัง',
};
/** Period screens reuse legacy structure and replace only time-specific words. */
export function executivePeriodReportWords() { return { ...W,
  active: EXECUTIVE_PERIOD_WORDS.active, paid: EXECUTIVE_PERIOD_WORDS.paid, positive: EXECUTIVE_PERIOD_WORDS.positive, net: EXECUTIVE_PERIOD_WORDS.net,
  receipts: EXECUTIVE_PERIOD_WORDS.receipts, refunds: EXECUTIVE_PERIOD_WORDS.refunds, receiptCount: EXECUTIVE_PERIOD_WORDS.receiptCount, tableReceipts: EXECUTIVE_PERIOD_WORDS.tableReceipts,
  trend: EXECUTIVE_PERIOD_WORDS.trend, shortTrend: EXECUTIVE_PERIOD_WORDS.trend, paidDefinition: EXECUTIVE_PERIOD_WORDS.paidDefinition,
  documentDefinition: EXECUTIVE_PERIOD_WORDS.documentDefinition, noReceipts: EXECUTIVE_PERIOD_WORDS.noReceipts,
  noPositiveNet: EXECUTIVE_PERIOD_WORDS.noPositiveNet, refundedDifference: EXECUTIVE_PERIOD_WORDS.refundedDifference, nonPositive: EXECUTIVE_PERIOD_WORDS.nonPositive,
}; }
export function executivePeriodReportLabels() { return { ...EXECUTIVE_REPORT_LABELS, usageGroup: { ...EXECUTIVE_REPORT_LABELS.usageGroup, ACTIVE: EXECUTIVE_PERIOD_WORDS.paidActive, INACTIVE: EXECUTIVE_PERIOD_WORDS.inactive } as Record<string, string> }; }
export function executiveMonthLabel(value: string): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(`${value}-01T00:00:00Z`));
}
export function executivePeriodLabel(from: string, to: string): string {
  return EXECUTIVE_PERIOD_WORDS.range(executiveMonthLabel(from), executiveMonthLabel(to));
}
/** Preserve the legacy export layout; replace time-specific labels from the shared period words. */
export function executivePeriodExportColumns(reportKey: string, subview?: string, contacts = false): string[] {
  const P = EXECUTIVE_PERIOD_WORDS;
  return executiveExportColumns(reportKey, subview, contacts).map((label, i) => ({
    20: P.receiptCount, 21: W.days, 22: P.usersByMonth, 23: P.documents, 24: P.ai,
    25: `${P.receipts} (บาท)`, 26: `${P.refunds} (บาท)`, 27: `${P.net} (บาท)`, 28: `${P.fees} (บาท)`, 29: `${W.aiCost} (บาท)`,
  } as Record<number, string>)[i] ?? label);
}

export function executivePeriodFilterLabel(key: string, value: string): string {
  const P = EXECUTIVE_PERIOD_WORDS;
  if (value === 'true') {
    const flags: Record<string, string> = { activeInPeriod: P.active, paidInPeriod: P.paid, positiveNetInPeriod: P.positive, joinedInPeriod: P.newCompanies };
    if (flags[key]) return flags[key]!;
  }
  if (key === 'usageGroup' && value === 'INACTIVE') return P.inactive;
  if (key === 'usageGroup' && value === 'ACTIVE') return P.paidActive;
  return (EXECUTIVE_REPORT_LABELS as Record<string, Record<string, string>>)[key]?.[value] ?? (EXECUTIVE_FLAG_LABELS as Record<string, Record<string, string>>)[key]?.[value] ?? W.unknown;
}
export function executivePeriodSortLabel(option: { sortBy: ExecutiveSortBy; label: string }): string {
  const P = EXECUTIVE_PERIOD_WORDS;
  return option.sortBy === 'netReceipts' ? `${P.net} มาก → น้อย` : option.sortBy === 'expenseReceiptCount' ? `${P.receiptCount} มาก → น้อย` : option.label;
}
export function executivePeriodComparisonQualifier(comparison: ExecutivePeriodComparison): string {
  const P = EXECUTIVE_PERIOD_WORDS;
  const status = comparison.status === 'NO_PREVIOUS' ? P.noPrevious(executivePeriodLabel(comparison.period.from, comparison.period.to))
    : comparison.status === 'PARTIAL' ? P.cannotCompare(comparison.affectedMonths.map(m => executiveMonthLabel(m.month)).join(', '))
    : comparison.status === 'ZERO_BASE' ? P.zeroBase : comparison.status === 'NEGATIVE_BASE' ? P.negativeBase : comparison.status === 'UNCHANGED' ? P.unchanged : '';
  return [status, comparison.includesOpenMonth && comparison.current.coverage === 'complete' && comparison.previous.coverage === 'complete' ? P.openComparison : ''].filter(Boolean).join(' · ');
}

/** Owner's sheet/infographic words; reused by filters, drill titles, help and workbook. */
export const EXECUTIVE_SHEET_WORDS = {
  churn: 'เลิกใช้ (ไม่ได้ใช้ติดต่อกันเกิน 1 เดือน)', neverUsed: 'ยังไม่เริ่มใช้',
  asOf: 'ข้อมูลถึงวันที่สรุป', asOfHelp: 'ตัวเลขนี้นับย้อนหลังจากวันที่สรุปข้อมูล ไม่ขึ้นกับช่วงเดือนที่เลือก',
  churnHelp: (date: string) => `นับการยืนยันค่าใช้จ่ายและออกเอกสารโดยสมาชิกบริษัท และการใช้ผู้ช่วยสำเร็จผ่านไลน์ตามกติกาการใช้งานของรายงาน ณ ${date}`,
  receipts7: 'เพิ่มใบเสร็จใน 7 วัน', receipts30: 'เพิ่มใบเสร็จใน 30 วัน', receiptDays30AtLeast2: 'เพิ่มใบเสร็จอย่างน้อย 2 วันใน 30 วัน',
  followUp: 'ควรติดตาม', invite: 'ชวนให้เริ่มใช้', followExisting: 'ติดตามผู้ที่เคยใช้',
  count: 'จำนวน', share: 'สัดส่วน (%)', everUsedShare: 'สัดส่วนจากบริษัทที่เคยใช้ (%)',
  receiptDistribution: 'จำนวนใบเสร็จต่อบริษัท', recentUsage: 'การใช้งานล่าสุด', packagesFound: 'แพ็กเกจที่พบ',
  churnShare: (share: string) => `${share} ของบริษัทที่เคยใช้`,
  expired: 'หมดอายุแล้ว',
  receiptBucket: { ALL: 'ทุกระดับใบเสร็จ', ZERO: W.export.buckets[0]!, ONE_TO_FIVE: W.export.buckets[1]!, SIX_PLUS: W.export.buckets[2]! },
  package: 'แพ็กเกจ', allPackages: 'ทุกแพ็กเกจ', lifetime: W.lifetimeReceipts, sourceMissing: 'ข้อมูลสรุปส่วนนี้ยังไม่ครบ จึงยังประเมินบางตัวเลขไม่ได้', sourceStale: 'ข้อมูลรายงานอาจยังไม่เป็นปัจจุบัน', classificationMissing: 'ยังมีบริษัทที่ไม่ได้จัดประเภท', noteAdminRoute: 'กรุณาแก้ไขหมายเหตุผ่านหน้าผู้ดูแลระบบ',
};
export const EXECUTIVE_COMPANY_SHEET_COLUMNS = [
  ['company', 'บริษัท / ร้าน'], ['businessType', W.businessType], ['plan', EXECUTIVE_SHEET_WORDS.package],
  ['receiptsLifetime', 'ใบเสร็จ (รายการสะสม)'], ['lastReceiptAt', 'เพิ่มใบเสร็จล่าสุด'], ['planEndsAt', 'สิ้นสุดแพ็กเกจ'],
  ['email', 'อีเมล'], ['phone', 'เบอร์โทร'], ['note', 'หมายเหตุ'], ['noteUpdatedBy', 'ผู้แก้ไขหมายเหตุ'], ['noteUpdatedAt', 'แก้ไขหมายเหตุเมื่อ'],
  ['firstReceiptAt', 'บิลแรก'], ['receipts7', 'ใบเสร็จใหม่ 7 วัน'], ['receipts30', 'ใบเสร็จใหม่ 30 วัน'], ['receiptDays30', 'จำนวนวันที่เพิ่มใบเสร็จใน 30 วัน'],
  ['daysSinceLastReceipt', 'ห่างจากใบเสร็จล่าสุด (วัน)'], ['confirmed', 'ยืนยันแล้ว'], ['pending', 'รอตรวจ/ยืนยัน'], ['draft', 'แบบร่าง'], ['receiptBucket', 'ระดับใบเสร็จ'],
  ['paymentState', 'สถานะการชำระ'], ['daysLeft', 'วันเหลือ'], ['lifetimeReceiptsSatang', 'รับชำระสะสม (บาท)'], ['lifetimeRefundsSatang', 'คืนเงินสะสม (บาท)'], ['lifetimeNetSatang', 'ชำระสุทธิสะสม (บาท)'],
  ['activeMemberCount', 'สมาชิกใช้งานได้'], ['branchCount', 'สาขาเปิด'], ['joinedAt', W.joined], ['signupRail', 'ช่องทางสมัคร'], ['discovery', 'รู้จักจาก'], ['referrer', 'ผู้แนะนำ'],
  ['aiRequests30', 'คำขอผู้ช่วย 30 วัน'], ['lastUseAt', 'ใช้ระบบล่าสุดถึงวันอ้างอิง'], ['daysSinceLastUse', 'ห่างจากการใช้ระบบล่าสุด (วัน)'], ['churned', EXECUTIVE_SHEET_WORDS.churn],
].map(([key, label]) => ({ key: key!, label: label! }));

/** One reason sentence per source; callers list affected months without copying figure-level explanations. */
export function executiveSourceReasonText(reason: string, months: readonly string[] = [], coverage?: ExecutiveCoverage): string {
  const period = months.map(executiveMonthLabel).join(' · ');
  const known: Record<ExecutiveReasonCode, string> = {
    RANGE_MONTH_NOT_BUILT: EXECUTIVE_PERIOD_WORDS.unbuilt(period), MONTH_SUMMARY_INCOMPLETE: EXECUTIVE_PERIOD_WORDS.incomplete(period),
    DISTINCT_USERS_NOT_AVAILABLE: EXECUTIVE_PERIOD_WORDS.distinctUsersUnavailable, SHEET_FACTS_NOT_BUILT: EXECUTIVE_SHEET_WORDS.sourceMissing,
    ACTIVITY_HISTORY_INCOMPLETE: W.historyBeforeCollectionPartial, HISTORY_BEFORE_COLLECTION: coverage === 'unavailable' ? W.historyBeforeCollection : W.historyBeforeCollectionPartial,
    HISTORY_BEFORE_FIRST_BUILD: coverage === 'unavailable' ? W.historyBeforeFirstBuildUnavailable : W.historyBeforeFirstBuild,
    SOURCE_ROWS_PURGED: coverage === 'unavailable' ? W.sourceRowsPurgedUnavailable : W.sourceRowsPurged, SOURCE_STALE: EXECUTIVE_SHEET_WORDS.sourceStale,
    PAYMENT_HISTORY_INCOMPLETE: W.export.moneyMissing, BILLING_SCAN_NOT_COMPLETE: W.export.moneyMissing, UNMATCHED_MONEY: W.unmatched,
    PURCHASE_KIND_UNKNOWN: `${W.purchase} · ${W.unknown}`, ADDON_NOT_ON_SALE: W.addOnNotSold, CLASSIFICATION_INCOMPLETE: EXECUTIVE_SHEET_WORDS.classificationMissing,
    INDUSTRY_NOT_PROVIDED: `${W.businessType} · ${W.unknown}`, NOT_YET_REGISTERED: EXECUTIVE_PERIOD_WORDS.notRegistered,
    NOT_ENTITLED: EXECUTIVE_REPORT_LABELS.receiptAdoption.NOT_ENTITLED!, TOO_FEW_COMPANIES: W.fewCompanies, NO_POSITIVE_NET: EXECUTIVE_PERIOD_WORDS.noPositiveNet,
  };
  return known[reason as ExecutiveReasonCode] ?? EXECUTIVE_SHEET_WORDS.sourceMissing;
}

export function executiveCompanySortLabel(sortBy: string): string {
  const column = EXECUTIVE_COMPANY_SHEET_COLUMNS.find(column => column.key === sortBy);
  return `${column?.label ?? W.unknown} ${sortBy.endsWith('At') ? 'ล่าสุดก่อน' : 'มาก → น้อย'}`;
}
