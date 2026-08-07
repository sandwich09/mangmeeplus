'use client';

import type { ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import {
  BellIcon,
  CalendarIcon,
  CheckCircleIcon,
  DocsIcon,
  DollarLineIcon,
  FileIcon,
  LockIcon,
  PageIcon,
  PieChartIcon,
  PlusIcon,
  TaskIcon,
} from '@/common/icons';
import {
  MangmeeBadge,
  MangmeeBranchChip,
  MangmeeCard,
  MangmeeIconFrame,
  cx,
  type MangmeeTone,
} from '@/common/components/mangmee';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type Metric = {
  label: string;
  value: string;
  sub: string;
  tone: MangmeeTone;
  icon: Icon;
};

type Row = {
  title: string;
  sub: string;
  value: string;
  tone: MangmeeTone;
};

type Action = {
  label: string;
  sub: string;
  href: string;
  tone: MangmeeTone;
};

type ModuleConfig = {
  crumb: string;
  title: string;
  description: string;
  month?: string;
  tone: MangmeeTone;
  accent: string;
  heroLabel: string;
  heroValue: string;
  heroSub: string;
  progressLabel: string;
  progress: number;
  metrics: Metric[];
  rows: Row[];
  actions: Action[];
  chart: number[];
  footerLabel: string;
};

const configs = {
  sales: {
    crumb: 'การขาย',
    title: 'การขาย',
    description: 'บันทึกยอดขายหน้าร้าน ดูบิลที่กำลังเปิด และติดตามยอดตามสาขา',
    month: 'ก.ค. 2568',
    tone: 'rose',
    accent: '#EC4899',
    heroLabel: 'ยอดขายวันนี้',
    heroValue: '฿42,850',
    heroSub: '128 รายการ · เฉลี่ยบิลละ ฿335',
    progressLabel: 'เป้ารายวัน ฿50,000',
    progress: 86,
    metrics: [
      { label: 'บิลเปิดอยู่', value: '8', sub: 'รอปิดการขาย', tone: 'rose', icon: FileIcon },
      { label: 'ลูกค้าใหม่', value: '12', sub: 'จากหน้าร้านและ LINE', tone: 'sky', icon: PlusIcon },
      { label: 'รับชำระแล้ว', value: '฿39,120', sub: 'เงินสด/โอน/บัตร', tone: 'brand', icon: DollarLineIcon },
      { label: 'ส่วนลดใช้ไป', value: '฿3,730', sub: 'อยู่ในนโยบาย', tone: 'purple', icon: CheckCircleIcon },
    ],
    rows: [
      { title: 'ทรีตเมนต์ผิวหน้า', sub: '34 บิล · สาขาสยามขายสูงสุด', value: '฿18,400', tone: 'brand' },
      { title: 'คอร์สเลเซอร์', sub: '11 บิล · มีใบเสนอราคาใหม่ 3 ใบ', value: '฿14,900', tone: 'purple' },
      { title: 'สินค้า take home', sub: '83 ชิ้น · เติมสต็อกใกล้หมด 4 รายการ', value: '฿9,550', tone: 'amber' },
    ],
    actions: [
      { label: 'เปิดบิลขายใหม่', sub: 'เริ่มขายหน้าร้าน', href: 'sales', tone: 'rose' },
      { label: 'ดูลูกค้า', sub: 'ตรวจประวัติและ LTV', href: 'customers', tone: 'sky' },
    ],
    chart: [44, 55, 48, 68, 74, 86],
    footerLabel: 'ยอดวันนี้กำลังเข้าเป้า เหลืออีก ฿7,150',
  },
  expenses: {
    crumb: 'ค่าใช้จ่าย+ใบเสร็จ',
    title: 'ค่าใช้จ่าย+ใบเสร็จ',
    description: 'รวมบิลค่าใช้จ่าย เอกสารรอตรวจ และรายการที่พร้อมลงบัญชี',
    month: 'ก.ค. 2568',
    tone: 'amber',
    accent: '#F79009',
    heroLabel: 'ค่าใช้จ่ายเดือนนี้',
    heroValue: '฿812,000',
    heroSub: 'ลดลง 4% จากเดือนก่อน',
    progressLabel: 'งบค่าใช้จ่าย ฿900,000',
    progress: 90,
    metrics: [
      { label: 'ใบเสร็จรอตรวจ', value: '12', sub: 'ก่อนปิดงวด', tone: 'sky', icon: FileIcon },
      { label: 'รออนุมัติ', value: '4', sub: 'เกิน 30 นาที 1 รายการ', tone: 'danger', icon: BellIcon },
      { label: 'พร้อมลงบัญชี', value: '38', sub: 'จับคู่หมวดแล้ว', tone: 'brand', icon: CheckCircleIcon },
      { label: 'จ่ายแล้ว', value: '฿642,000', sub: 'เดือนนี้', tone: 'amber', icon: DollarLineIcon },
    ],
    rows: [
      { title: 'ค่าเช่าและสาธารณูปโภค', sub: 'จ่ายครบทุกสาขา', value: '฿360,000', tone: 'amber' },
      { title: 'เวชภัณฑ์และสินค้า', sub: 'มี PO รอจับคู่ 2 ใบ', value: '฿294,000', tone: 'purple' },
      { title: 'การตลาดและแคมเปญ', sub: 'ใช้จริงต่ำกว่างบ 8%', value: '฿158,000', tone: 'rose' },
    ],
    actions: [
      { label: 'ตรวจใบเสร็จ', sub: '12 รายการ', href: 'expenses', tone: 'sky' },
      { label: 'ดูอนุมัติคำสั่งซื้อ', sub: 'กฎวงเงิน', href: 'settings/po-approval', tone: 'purple' },
      { label: 'ปิดงวด', sub: 'ตรวจความครบถ้วน', href: 'period-closing', tone: 'slate' },
    ],
    chart: [70, 74, 76, 88, 80, 90],
    footerLabel: 'ค่าใช้จ่ายยังอยู่ในกรอบงบเดือนนี้',
  },
  journal: {
    crumb: 'สมุดรายวัน',
    title: 'สมุดรายวัน',
    description: 'ตรวจรายการรายวัน กำไรสุทธิ และเอกสารที่พร้อมผ่านบัญชี',
    month: 'ก.ค. 2568',
    tone: 'lime',
    accent: '#16A34A',
    heroLabel: 'กำไรสุทธิเดือนนี้',
    heroValue: '฿472,000',
    heroSub: 'หลังหักค่าใช้จ่าย 37%',
    progressLabel: 'เป้ากำไร ฿500,000',
    progress: 94,
    metrics: [
      { label: 'ยอดขายลงบัญชี', value: '฿1,284,000', sub: 'จากทุกสาขา', tone: 'brand', icon: DollarLineIcon },
      { label: 'ค่าใช้จ่ายลงบัญชี', value: '฿812,000', sub: 'ตรวจแล้ว 88%', tone: 'amber', icon: FileIcon },
      { label: 'รายการผิดปกติ', value: '3', sub: 'ต้องตรวจเพิ่ม', tone: 'danger', icon: BellIcon },
      { label: 'พร้อมปิดงวด', value: '92%', sub: 'ของเอกสารทั้งหมด', tone: 'lime', icon: CheckCircleIcon },
    ],
    rows: [
      { title: 'ยอดขายหน้าร้าน', sub: 'เดบิตเงินสด/ธนาคาร · เครดิตรายได้', value: '฿1,284,000', tone: 'brand' },
      { title: 'ค่าใช้จ่ายดำเนินงาน', sub: 'ผ่านหมวดค่าเช่า เวชภัณฑ์ การตลาด', value: '฿812,000', tone: 'amber' },
      { title: 'เงินสดคงเหลือจริง', sub: 'พร้อมใช้เดือนนี้', value: '฿640,000', tone: 'sky' },
    ],
    actions: [
      { label: 'ดูรายการรายวัน', sub: 'ตรวจสมุดบัญชี', href: 'journal', tone: 'lime' },
      { label: 'ดูรายงานการเงิน', sub: 'กำไรและกระแสเงินสด', href: 'reports', tone: 'indigo' },
      { label: 'ปิดงวดบัญชี', sub: 'งวด ก.ค. 2568', href: 'period-closing', tone: 'slate' },
    ],
    chart: [52, 62, 70, 76, 83, 94],
    footerLabel: 'เหลือ 3 รายการก่อนปิดสมุดรายวัน',
  },
  salesdoc: {
    crumb: 'เอกสารขาย',
    title: 'เอกสารขาย',
    description: 'รวมใบเสนอราคา ใบแจ้งหนี้ และเอกสารขายที่ต้องติดตาม',
    month: 'ก.ค. 2568',
    tone: 'line',
    accent: '#12B76A',
    heroLabel: 'เอกสารเปิดเดือนนี้',
    heroValue: '146 ใบ',
    heroSub: 'แปลงเป็นยอดขายแล้ว 61%',
    progressLabel: 'เอกสารที่ตามครบแล้ว',
    progress: 72,
    metrics: [
      { label: 'ใบเสนอราคา', value: '28', sub: 'รอลูกค้าตัดสินใจ', tone: 'amber', icon: DocsIcon },
      { label: 'ใบแจ้งหนี้', value: '46', sub: 'ครบกำหนด 8 ใบ', tone: 'sky', icon: PageIcon },
      { label: 'ชำระแล้ว', value: '72', sub: 'ออกใบเสร็จแล้ว', tone: 'brand', icon: CheckCircleIcon },
      { label: 'ต้องติดตาม', value: '9', sub: 'เกิน SLA', tone: 'danger', icon: BellIcon },
    ],
    rows: [
      { title: 'ใบเสนอราคาคอร์สเลเซอร์', sub: 'ลูกค้า VIP 6 ราย', value: '฿268,000', tone: 'purple' },
      { title: 'ใบแจ้งหนี้ครบกำหนด', sub: 'แจ้งเตือนอัตโนมัติแล้ว', value: '8 ใบ', tone: 'danger' },
      { title: 'ใบเสร็จพร้อมส่ง', sub: 'ส่งทาง LINE ได้ทันที', value: '72 ใบ', tone: 'brand' },
    ],
    actions: [
      { label: 'สร้างใบเสนอราคา', sub: 'จากดีลลูกค้า', href: 'sales-documents', tone: 'line' },
      { label: 'ดูกล่องข้อความ', sub: 'ติดตามลูกค้า', href: 'inbox', tone: 'line' },
      { label: 'รายงาน CRM', sub: 'ดู conversion', href: 'crm-reports', tone: 'purple' },
    ],
    chart: [38, 50, 59, 64, 69, 72],
    footerLabel: 'เอกสารขายสำคัญถูกติดตามครบตามรอบ',
  },
  reports: {
    crumb: 'รายงานการเงิน',
    title: 'รายงานการเงิน',
    description: 'สรุปยอดขาย ค่าใช้จ่าย กำไร และเงินสดคงเหลือของทุกสาขา',
    month: 'ก.ค. 2568',
    tone: 'indigo',
    accent: '#6172F3',
    heroLabel: 'กำไรเดือนนี้',
    heroValue: '฿472,000',
    heroSub: 'เพิ่มขึ้น 7% เทียบเดือนก่อน',
    progressLabel: 'เป้ากำไรสุทธิ',
    progress: 94,
    metrics: [
      { label: 'ยอดขาย', value: '฿1,284,000', sub: 'ทุกสาขา', tone: 'brand', icon: DollarLineIcon },
      { label: 'ค่าใช้จ่าย', value: '฿812,000', sub: 'ควบคุมได้', tone: 'amber', icon: FileIcon },
      { label: 'อัตรากำไร', value: '37%', sub: 'หลังค่าใช้จ่าย', tone: 'sky', icon: PieChartIcon },
      { label: 'เงินสดคงเหลือ', value: '฿640,000', sub: 'พร้อมใช้', tone: 'indigo', icon: DollarLineIcon },
    ],
    rows: [
      { title: 'สาขาสยาม', sub: 'ยอดขายสูงสุดในเดือนนี้', value: '฿520,000', tone: 'brand' },
      { title: 'สาขาอารีย์', sub: 'กำไรเพิ่ม 9%', value: '฿398,000', tone: 'sky' },
      { title: 'สาขาทองหล่อ', sub: 'ค่าใช้จ่ายลดลง 6%', value: '฿366,000', tone: 'amber' },
    ],
    actions: [
      { label: 'ส่งออกรายงาน', sub: 'รายเดือน', href: 'reports', tone: 'indigo' },
      { label: 'ตรวจสมุดรายวัน', sub: 'ก่อนปิดงวด', href: 'journal', tone: 'lime' },
      { label: 'ดูแดชบอร์ด', sub: 'ภาพรวมธุรกิจ', href: 'dashboard', tone: 'brand' },
    ],
    chart: [46, 54, 62, 73, 88, 94],
    footerLabel: 'เดือนนี้กำไรเข้าเป้าและกระแสเงินสดเป็นบวก',
  },
  closing: {
    crumb: 'ปิดงวด',
    title: 'ปิดงวด',
    description: 'ตรวจความครบถ้วนของยอดขาย ค่าใช้จ่าย เอกสาร และเงินสดก่อนล็อกงวด',
    month: 'งวด ก.ค. 2568',
    tone: 'slate',
    accent: '#667085',
    heroLabel: 'ความพร้อมปิดงวด',
    heroValue: '92%',
    heroSub: 'เหลือ 5 งานต้องตรวจ',
    progressLabel: 'รายการที่ตรวจครบแล้ว',
    progress: 92,
    metrics: [
      { label: 'ยอดขายตรวจแล้ว', value: '100%', sub: 'ทุกสาขา', tone: 'brand', icon: CheckCircleIcon },
      { label: 'ใบเสร็จรอตรวจ', value: '12', sub: 'ต้องปิดก่อนล็อกงวด', tone: 'sky', icon: FileIcon },
      { label: 'เอกสารขายค้าง', value: '8', sub: 'รอลูกค้าชำระ', tone: 'amber', icon: DocsIcon },
      { label: 'แจ้งเตือนปิดงวด', value: 'พร้อม', sub: 'ส่งถึงเจ้าของแล้ว', tone: 'slate', icon: LockIcon },
    ],
    rows: [
      { title: 'ตรวจยอดขายทุกสาขา', sub: 'ยอดขายตรงกับเงินรับจริง', value: 'ครบ', tone: 'brand' },
      { title: 'ตรวจค่าใช้จ่ายและใบเสร็จ', sub: 'เหลือใบเสร็จ 12 รายการ', value: '88%', tone: 'amber' },
      { title: 'สรุปรายงานการเงิน', sub: 'พร้อมสร้าง PDF งวดนี้', value: 'พร้อม', tone: 'indigo' },
    ],
    actions: [
      { label: 'ตรวจใบเสร็จ', sub: '12 รายการ', href: 'expenses', tone: 'sky' },
      { label: 'ดูรายงานการเงิน', sub: 'ก่อนล็อกงวด', href: 'reports', tone: 'indigo' },
      { label: 'ล็อกงวด', sub: 'หลังตรวจครบ', href: 'period-closing', tone: 'slate' },
    ],
    chart: [50, 62, 68, 79, 86, 92],
    footerLabel: 'งวดนี้พร้อมปิดหลังเคลียร์ใบเสร็จที่เหลือ',
  },
  notifications: {
    crumb: 'การแจ้งเตือน',
    title: 'การแจ้งเตือน',
    description: 'ตั้งค่าการแจ้งเตือนงานสำคัญ เช่น ลูกค้ารอนาน ใบเสร็จรอตรวจ และปิดงวด',
    month: 'ทุกสาขา (รวม)',
    tone: 'rose',
    accent: '#EC4899',
    heroLabel: 'แจ้งเตือนที่เปิดใช้งาน',
    heroValue: '18 กฎ',
    heroSub: 'ส่งผ่านเว็บและ LINE OA',
    progressLabel: 'เหตุการณ์ที่ตอบทัน SLA',
    progress: 89,
    metrics: [
      { label: 'ลูกค้ารอแชท', value: '4', sub: 'เกิน 30 นาที', tone: 'danger', icon: BellIcon },
      { label: 'ใบเสร็จรอตรวจ', value: '12', sub: 'ก่อนปิดงวด', tone: 'sky', icon: FileIcon },
      { label: 'งานอนุมัติ', value: '3', sub: 'คำสั่งซื้อและส่วนลด', tone: 'purple', icon: TaskIcon },
      { label: 'ปิดงวด', value: '1', sub: 'งวด ก.ค. 2568', tone: 'slate', icon: LockIcon },
    ],
    rows: [
      { title: 'ลูกค้ารอตอบแชทนานเกิน 30 นาที', sub: 'แจ้งเตือนผู้จัดการและเจ้าของ', value: 'เปิด', tone: 'danger' },
      { title: 'ใบเสนอราคารอลูกค้าตัดสินใจ', sub: 'เตือนฝ่ายขายหลัง 24 ชม.', value: 'เปิด', tone: 'amber' },
      { title: 'สรุปรายงานรายวัน', sub: 'ส่งทุกวันเวลา 20:30 น.', value: 'เปิด', tone: 'brand' },
    ],
    actions: [
      { label: 'ดูกล่องข้อความ', sub: 'งานที่ต้องตอบ', href: 'inbox', tone: 'line' },
      { label: 'ตรวจสิ่งที่ต้องทำ', sub: 'จากแดชบอร์ด', href: 'dashboard', tone: 'brand' },
      { label: 'ปิดงวด', sub: 'งานบัญชี', href: 'period-closing', tone: 'slate' },
    ],
    chart: [72, 75, 80, 84, 87, 89],
    footerLabel: 'ระบบแจ้งเตือนครอบคลุมงานเร่งด่วนตาม HTML แล้ว',
  },
} satisfies Record<string, ModuleConfig>;

type ModuleKey = keyof typeof configs;

function TrendBars({ values, accent }: { values: number[]; accent: string }) {
  return (
    <div className="mt-5 flex h-28 items-end gap-2">
      {values.map((value, index) => (
        <div key={`${value}-${index}`} className="flex flex-1 items-end gap-1">
          <div className="w-full rounded-t-md bg-brand-100" style={{ height: `${Math.max(18, value - 12)}%` }} />
          <div className="w-full rounded-t-md" style={{ height: `${value}%`, background: index === values.length - 1 ? accent : '#FCD34D' }} />
        </div>
      ))}
    </div>
  );
}

function Progress({ value, accent }: { value: number; accent: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: accent }} />
    </div>
  );
}

function StatMetric({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  return (
    <MangmeeCard className="flex min-w-0 items-center gap-4 px-5 py-[18px]">
      <MangmeeIconFrame tone={metric.tone} className="h-12 w-12 rounded-xl">
        <Icon />
      </MangmeeIconFrame>
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-500">{metric.label}</div>
        <div className="mt-0.5 text-[26px] font-extrabold leading-tight text-gray-900">{metric.value}</div>
        <div className="mt-0.5 text-[13px] font-medium text-gray-500">{metric.sub}</div>
      </div>
    </MangmeeCard>
  );
}

function hrefFor(companyId: string, href: string) {
  return href.startsWith('/companies/') ? href : `/companies/${companyId}/${href}`;
}

export function MangmeeModulePrototypePage({ companyId, moduleKey }: { companyId: string; moduleKey: ModuleKey }) {
  const config = configs[moduleKey];

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm font-semibold text-gray-500">
          <span>มั่งมี</span>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-700">{config.crumb}</span>
        </div>
        <MangmeeBranchChip />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold leading-tight text-gray-900">{config.title}</h1>
          <p className="mt-3 max-w-3xl text-base font-medium text-gray-500">{config.description}</p>
        </div>
        {config.month && <MangmeeBadge tone={config.tone}>{config.month}</MangmeeBadge>}
      </div>

      <MangmeeCard className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <MangmeeIconFrame tone={config.tone} className="mb-4 h-12 w-12 rounded-xl">
              <DollarLineIcon />
            </MangmeeIconFrame>
            <div className="text-sm font-bold text-gray-500">{config.heroLabel}</div>
            <div className="mt-1.5 text-[42px] font-extrabold leading-none text-gray-900 sm:text-[48px]">{config.heroValue}</div>
            <div className="mt-3 inline-flex rounded-full bg-brand-50 px-3 py-1 text-sm font-extrabold text-brand-700">
              {config.heroSub}
            </div>
          </div>
          <div className="min-w-[220px] max-w-sm flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-gray-500">
              <span>{config.progressLabel}</span>
              <span style={{ color: config.accent }}>{config.progress}%</span>
            </div>
            <div className="mt-3">
              <Progress value={config.progress} accent={config.accent} />
            </div>
            <TrendBars values={config.chart} accent={config.accent} />
          </div>
        </div>
      </MangmeeCard>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {config.metrics.map((metric) => (
          <StatMetric key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.25fr_.95fr]">
        <MangmeeCard className="px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">รายการสำคัญ</h2>
              <p className="mt-1 text-sm font-medium text-gray-500">ข้อมูลหลักของเมนูนี้ตามมุมมอง HTML</p>
            </div>
            <MangmeeBadge tone={config.tone}>LIVE</MangmeeBadge>
          </div>
          <div className="divide-y divide-gray-100">
            {config.rows.map((row) => (
              <div key={row.title} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <MangmeeIconFrame tone={row.tone} className="h-10 w-10 rounded-xl">
                    <CheckCircleIcon />
                  </MangmeeIconFrame>
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-gray-900">{row.title}</div>
                    <div className="mt-0.5 text-sm font-medium text-gray-500">{row.sub}</div>
                  </div>
                </div>
                <div className="text-xl font-extrabold text-gray-900">{row.value}</div>
              </div>
            ))}
          </div>
        </MangmeeCard>

        <MangmeeCard className="px-6 py-5">
          <h2 className="text-xl font-extrabold text-gray-900">ทางลัด</h2>
          <p className="mt-1 text-sm font-medium text-gray-500">กดเพื่อไปยัง workflow ที่เกี่ยวข้อง</p>
          <div className="mt-5 space-y-3">
            {config.actions.map((action) => (
              <Link
                key={action.label}
                href={hrefFor(companyId, action.href)}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-[var(--shadow-theme-sm)] transition hover:border-brand-200 hover:bg-brand-25"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <MangmeeIconFrame tone={action.tone} className="h-11 w-11 rounded-xl">
                    <CalendarIcon />
                  </MangmeeIconFrame>
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-gray-900">{action.label}</div>
                    <div className="mt-0.5 text-sm font-medium text-gray-500">{action.sub}</div>
                  </div>
                </div>
                <span className="text-xl font-bold text-gray-300">›</span>
              </Link>
            ))}
          </div>
        </MangmeeCard>
      </div>

      <div className={cx('rounded-2xl border px-5 py-4 text-sm font-bold', 'border-brand-100 bg-brand-25 text-brand-700')}>
        <span className="mr-2 inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
        {config.footerLabel}
      </div>
    </div>
  );
}
