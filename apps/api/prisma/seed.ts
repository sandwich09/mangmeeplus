import type { PrismaService } from '../src/common/database/prisma.service';
import { SyncTaxEventsUseCase } from '../src/modules/tax/application/use-cases/sync-tax-events.use-case';
import { PrismaTaxRepository } from '../src/modules/tax/infrastructure/repositories/prisma-tax.repository';
import { AccountingDocumentSourceAdapter } from '../src/modules/tax/infrastructure/adapters/accounting-document-source.adapter';
import { ExpenseSourceAdapter } from '../src/modules/tax/infrastructure/adapters/expense-source.adapter';
import { SupplierPaymentSourceAdapter } from '../src/modules/tax/infrastructure/adapters/supplier-payment-source.adapter';
import { seedExpenses, seedExpenseRows } from './seed-expenses';
import { seedPlainShop, UNANSWERED_PLAIN_SHOP, INPUT_VAT_SHOP, PACKAGE_SHOP, FREE_DRAFT_SHOP } from './seed-plain-shop';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { syncPermissions } from './sync-permissions';
import { hashPassword } from '../src/modules/auth/domain/logic/password-credential.logic';
import { encryptCredential } from '../src/modules/system-partner-management/domain/logic/credential-cipher.logic';
import { WORKFLOW_TEMPLATE_CATALOG } from '../src/modules/workflow/domain/workflow-template-catalog';
import { PrismaWorkflowRepository } from '../src/modules/workflow/infrastructure/prisma-workflow.repository';
import { autoEnableWorkflowTemplatesForCompany } from '../src/modules/workflow/application/use-cases/workflow-template.use-case';
import { IMPLEMENTED_TRIGGER_KEYS } from '../src/modules/dashboard-notifications/domain/models/notification.model';
import { DEFAULT_PIPELINE_STAGES } from '../src/modules/crm/domain/crm.constants';
import { TH_SME_COA_V1 } from '../src/modules/ledger/domain/catalog/th-sme-chart-of-accounts-v1';
import { chartTemplateAccountWriteData } from '../src/modules/ledger/application/services/chart-template-bootstrap.service';
import { loadChartTemplatePreview } from '../src/modules/ledger/application/services/chart-template-query.service';
import {
  buildSeedPaymentProofPng,
  buildSeedSupportingPdf,
  putSeedAttachmentObject,
  type SeedStoredAttachment,
} from './seed-attachment-storage';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

// ponytail: fixed seed IDs so upsert is stable across runs without a unique slug column
const SEED_COMPANY_ID = 'seed-local-company';
const SEED_OWNER_ID = 'seed-local-owner';
const SEED_SYSTEM_COMPANY_ID = 'seed-watchdog-system-company';
const SEED_SYSTEM_ADMIN_ID = 'seed-watchdog-system-admin';

const SEED_SALES_LEAD_ID = 'seed-mangmee-sales-lead';
const SEED_SALES_AGENT_ID = 'seed-mangmee-sales-agent';

/** Fixed QA logins for the /sales console; the web e2e depends on these exact values. */
const SEED_SALES_AGENTS: ReadonlyArray<{
  id: string; username: string; displayName: string; password: string;
  role: 'MANGMEE_SALES_LEAD' | 'MANGMEE_SALES'; salesCode: string; teamLeadUserId?: string;
}> = [
  { id: SEED_SALES_LEAD_ID, username: 'qa.mangmee.lead', displayName: 'QA หัวหน้าทีมขาย',
    password: 'Qa@MangmeeLead123', role: 'MANGMEE_SALES_LEAD', salesCode: 'LEAD' },
  { id: SEED_SALES_AGENT_ID, username: 'qa.mangmee.sales', displayName: 'QA เซลล์',
    password: 'Qa@MangmeeSales123', role: 'MANGMEE_SALES', salesCode: 'TON', teamLeadUserId: SEED_SALES_LEAD_ID },
];

/**
 * The seed runs without AppConfigService, so it reads the same env var the service does.
 * A local database with no key set stores a clearly-marked placeholder rather than failing the
 * whole seed — nothing downstream decrypts these two rows except a developer looking at them.
 */
function seedEncrypt(plain: string): string {
  const hex = process.env['CREDENTIAL_ENCRYPTION_KEY'];
  return hex ? encryptCredential(plain, Buffer.from(hex, 'hex')) : `seed-unencrypted:${plain}`;
}

const DEFAULT_COMPANY = { id: SEED_COMPANY_ID, name: 'WatchDog Local Company' };
const SECOND_COMPANY = { id: 'seed-local-company-2', name: 'Bloom Beauty Clinic' };
const SYSTEM_COMPANY = { id: SEED_SYSTEM_COMPANY_ID, name: 'มั่งมีพลัส · ระบบภายใน' };

const DEFAULT_OWNER = {
  id: SEED_OWNER_ID,
  username: 'Owner',
  password: process.env['SEED_OWNER_PASSWORD'] ?? 'Owner@12345',
  displayName: 'Local Owner',
  email: 'owner@watchdog.local',
};

const COMPANY_VIEW_USER = {
  id: 'seed-local-company-view',
  username: 'Company',
  password: process.env['SEED_COMPANY_VIEW_PASSWORD'] ?? 'Company@123',
  displayName: 'นภา',
  email: 'napa@room45.co',
};

const QA_ROLE_ACCOUNTS = [
  { roleKey: 'OWNER', jobTitle: 'เจ้าของกิจการ', username: 'qa.owner', password: 'Qa@Owner123', displayName: 'อรอนงค์ เจ้าของกิจการ', email: 'qa.owner@watchdog.local' },
  { roleKey: 'COMPANY_VIEW', jobTitle: 'ผู้บริหาร', username: 'qa.company', password: 'Qa@Company123', displayName: 'ชญานิศ ผู้บริหาร', email: 'qa.company@watchdog.local' },
  { roleKey: 'ADMIN', jobTitle: 'ผู้ดูแลระบบ', username: 'qa.admin', password: 'Qa@Admin123', displayName: 'ณัฐชา ผู้ดูแลระบบ', email: 'qa.admin@watchdog.local' },
  { roleKey: 'MANAGER', jobTitle: 'ผู้จัดการสาขา', username: 'qa.manager', password: 'Qa@Manager123', displayName: 'ศิริพร ผู้จัดการสาขา', email: 'qa.manager@watchdog.local' },
  { roleKey: 'SALES', jobTitle: 'พนักงานขาย', username: 'qa.sales', password: 'Qa@Sales123', displayName: 'พิมพ์ชนก ฝ่ายขาย', email: 'qa.sales@watchdog.local' },
  { roleKey: 'INVENTORY', jobTitle: 'เจ้าหน้าที่คลังสินค้า', username: 'qa.inventory', password: 'Qa@Inventory123', displayName: 'กิตติพงษ์ คลังสินค้า', email: 'qa.inventory@watchdog.local' },
  { roleKey: 'FINANCE', jobTitle: 'เจ้าหน้าที่การเงิน', username: 'qa.finance', password: 'Qa@Finance123', displayName: 'วราภรณ์ ฝ่ายการเงิน', email: 'qa.finance@watchdog.local' },
  { roleKey: 'ACCOUNTANT', jobTitle: 'นักบัญชี', username: 'qa.accountant', password: 'Qa@Accountant123', displayName: 'สุภาวดี นักบัญชี', email: 'qa.accountant@watchdog.local' },
  { roleKey: 'MARKETING', jobTitle: 'เจ้าหน้าที่การตลาด', username: 'qa.marketing', password: 'Qa@Marketing123', displayName: 'ธัญญารัตน์ การตลาด', email: 'qa.marketing@watchdog.local' },
  { roleKey: 'STAFF', jobTitle: 'พนักงานทั่วไป', username: 'qa.staff', password: 'Qa@Staff123', displayName: 'ปวีณ์ พนักงานทั่วไป', email: 'qa.staff@watchdog.local' },
  { roleKey: 'AUDITOR_READONLY', jobTitle: 'ผู้ตรวจสอบบัญชี', username: 'qa.auditor', password: 'Qa@Auditor123', displayName: 'ชลธิชา ผู้ตรวจสอบ', email: 'qa.auditor@watchdog.local' },
] as const;

const SYSTEM_ADMIN_USERNAME = process.env['SEED_SYSTEM_ADMIN_USERNAME'] ?? 'thawatchai.watchdog';
// L-03: the hardcoded fallback is a local-dev affordance only. A production seed run must
// supply the password explicitly or fail before writing any credential.
const SEED_SYSTEM_ADMIN_PASSWORD = process.env['SEED_SYSTEM_ADMIN_PASSWORD'];
if (process.env['APP_ENV'] === 'production' && !SEED_SYSTEM_ADMIN_PASSWORD) {
  throw new Error(
    'SEED_SYSTEM_ADMIN_PASSWORD must be set when APP_ENV=production; the local seed fallback password is refused',
  );
}
const SYSTEM_ADMIN_PASSWORD = SEED_SYSTEM_ADMIN_PASSWORD ?? 'watchdogbms11';

// DEV identity constants - providerChannelId is a stable dev channel sentinel
const DEV_CHANNEL_ID = 'dev-channel';
const DEV_PROVIDER_USER_ID = 'dev-owner';

const ROOM45_BRANCHES = [
  { id: 'seed-room45-branch-siam', code: 'SIAM', name: 'Room45 Eyes Lashes · สยาม', taxBranchCode: '00001', phone: '02-045-4501', email: 'siam@room45.local' },
  { id: 'seed-room45-branch-aree', code: 'AREE', name: 'Room45 Eyes Lashes · อารีย์', taxBranchCode: '00002', phone: '02-045-4502', email: 'aree@room45.local' },
  { id: 'seed-room45-branch-thonglor', code: 'THONG', name: 'Room45 Eyes Lashes · ทองหล่อ', taxBranchCode: '00003', phone: '02-045-4503', email: 'thonglor@room45.local' },
] as const;

const ROOM45_STAFF = [
  { key: 'mind', jobTitle: 'ที่ปรึกษาความงาม', userId: 'seed-room45-user-mind', profileId: 'seed-room45-employee-mind', displayName: 'มายด์', legalName: 'มายด์ Room45', email: 'mind@room45.local', phoneNumber: '081-045-4501', roleKey: 'SALES', branchCode: 'SIAM', identityLast4: '4501' },
  { key: 'nice', jobTitle: 'ผู้จัดการสาขา', userId: 'seed-room45-user-nice', profileId: 'seed-room45-employee-nice', displayName: 'ไนซ์', legalName: 'ไนซ์ Room45', email: 'nice@room45.local', phoneNumber: '081-045-4502', roleKey: 'MANAGER', branchCode: 'AREE', identityLast4: '4502' },
  { key: 'praew', jobTitle: 'ที่ปรึกษาความงาม', userId: 'seed-room45-user-praew', profileId: 'seed-room45-employee-praew', displayName: 'แพรว', legalName: 'แพรว Room45', email: 'praew@room45.local', phoneNumber: '081-045-4503', roleKey: 'SALES', branchCode: 'THONG', identityLast4: '4503' },
  { key: 'toey', jobTitle: 'ที่ปรึกษาความงาม', userId: 'seed-room45-user-toey', profileId: 'seed-room45-employee-toey', displayName: 'เตย', legalName: 'เตย Room45', email: 'toey@room45.local', phoneNumber: '081-045-4504', roleKey: 'SALES', branchCode: 'AREE', identityLast4: '4504' },
] as const;

type Room45StaffKey = (typeof ROOM45_STAFF)[number]['key'];
type Room45BranchCode = (typeof ROOM45_BRANCHES)[number]['code'];

const ROOM45_CUSTOMERS = [
  { key: 'k1', convId: 'c1', name: 'คุณพิม ชนกานต์', lineName: 'Pim •˚', phone: '081-234-5678', dob: '1996-03-14', tier: 'LEAD', score: 82, sentiment: 'POSITIVE', risk: 'LOW', ltv: '0', branchCode: 'SIAM', assigned: null, convStatus: 'NEW', waitMin: 2, unread: 2, tags: ['ลูกค้าใหม่'], last: 'สนใจต่อขนตาแบบ Volume ราคาเท่าไหร่คะ', deal: { title: 'คอร์สต่อขนตา Volume', value: '2500', stage: 'New lead' }, task: null, booking: null },
  { key: 'k2', convId: 'c2', name: 'คุณเบล สุภาวดี', lineName: 'belle.s', phone: '089-555-1122', dob: '1990-11-02', tier: 'ACTIVE', score: 64, sentiment: 'NEUTRAL', risk: 'LOW', ltv: '8900', branchCode: 'SIAM', assigned: 'mind', convStatus: 'WAITING_CUSTOMER', waitMin: 20, unread: 0, tags: ['นัดหมาย'], last: 'ขอเลื่อนัดพรุ่งนี้เป็นบ่ายได้ไหมคะ', deal: null, task: { title: 'ยืนยันนัดใหม่', days: 0 }, booking: { dayOffset: 1, hour: 14, service: 'รีทัชขนตา', staff: 'mind' } },
  { key: 'k3', convId: 'c3', name: 'คุณแนน วงษ์ดี', lineName: 'nan_w', phone: '092-888-3344', dob: '1994-07-25', tier: 'LEAD', score: 71, sentiment: 'NEUTRAL', risk: 'MEDIUM', ltv: '0', branchCode: 'SIAM', assigned: 'mind', convStatus: 'WAITING_CUSTOMER', waitMin: 65, unread: 0, tags: ['รอตัดสินใจ'], last: 'ได้รับใบเสนอราคาแล้วค่ะ ขอดูก่อนนะคะ', deal: { title: 'แพ็กเกจรายเดือน', value: '3200', stage: 'Quotation sent' }, task: { title: 'ติดตามใบเสนอราคา', days: -1 }, booking: null },
  { key: 'k4', convId: 'c4', name: 'คุณจอย รุ่งเรือง', lineName: 'joy.r ⭐', phone: '086-777-9900', dob: '1988-09-28', tier: 'VIP', score: 93, sentiment: 'POSITIVE', risk: 'LOW', ltv: '24600', branchCode: 'AREE', assigned: 'nice', convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: ['VIP'], last: 'จองคิวเรียบร้อย เสาร์ 11:00 · VIP -10%', deal: { title: 'แพ็กเกจรายปี VIP', value: '12000', stage: 'Negotiation' }, task: null, booking: { dayOffset: 2, hour: 11, service: 'เติมขนตา', staff: 'nice' } },
  { key: 'k5', convId: 'c5', name: 'คุณกิ๊ฟ ธนะดี', lineName: 'gift.t', phone: '095-222-6677', dob: '1997-05-17', tier: 'ACTIVE', score: 58, sentiment: 'POSITIVE', risk: 'LOW', ltv: '5400', branchCode: 'THONG', assigned: 'nice', convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: [], last: 'ขอบคุณมากค่ะ ประทับใจมาก', deal: null, task: null, booking: null },
  { key: 'k6', convId: 'c6', name: 'คุณมิ้นต์ พุทธิชา', lineName: 'mint.p', phone: '080-111-2233', dob: '1999-01-30', tier: 'LEAD', score: 60, sentiment: 'POSITIVE', risk: 'MEDIUM', ltv: '0', branchCode: 'SIAM', assigned: null, convStatus: 'NEW', waitMin: 45, unread: 1, tags: ['ลูกค้าใหม่'], last: 'สอบถามโปรโมชั่นเดือนนี้ค่ะ', deal: null, task: null, booking: null },
  { key: 'k7', convId: 'c7', name: 'คุณเอิร์ธ พิทักษ์', lineName: 'earth.p', phone: '081-999-0000', dob: '1985-09-21', tier: 'ACTIVE', score: 50, sentiment: 'NEUTRAL', risk: 'LOW', ltv: '3600', branchCode: 'AREE', assigned: 'nice', convStatus: 'OPEN', waitMin: 5, unread: 0, tags: [], last: 'ขอที่อยู่ร้านหน่อยครับ', deal: null, task: null, booking: null },
  { key: 'k8', convId: 'c8', name: 'คุณปูน ศิริกัญญา', lineName: 'poon.s', phone: '082-333-4455', dob: '1992-12-11', tier: 'ACTIVE', score: 68, sentiment: 'POSITIVE', risk: 'LOW', ltv: '6200', branchCode: 'THONG', assigned: 'praew', convStatus: 'WAITING_INTERNAL', waitMin: 12, unread: 1, tags: ['นัดหมาย', 'รอตรวจสลิป'], last: 'โอนมัดจำแล้วนะคะ แนบสลิป', deal: null, task: { title: 'ยืนยันสลิปโอน', days: 0 }, booking: { dayOffset: 0, hour: 16, service: 'รีทัชขนตา', staff: 'praew' } },
  { key: 'k9', convId: 'c9', name: 'คุณจ๊ะจ๋า มานะมานะ', lineName: 'jaja.m', phone: '083-777-8899', dob: '1995-06-05', tier: 'LEAD', score: 75, sentiment: 'POSITIVE', risk: 'MEDIUM', ltv: '0', branchCode: 'SIAM', assigned: null, convStatus: 'NEW', waitMin: 38, unread: 3, tags: ['ลูกค้าใหม่'], last: 'ต่อขนตาช่วงเย็นได้ไหมคะ', deal: { title: 'ต่อขนตาช่วงเย็น', value: '2500', stage: 'Qualified' }, task: null, booking: null },
  { key: 'k10', convId: 'c10', name: 'คุณแพร กิตติธร', lineName: 'prae.k', phone: '084-222-1100', dob: '1993-08-19', tier: 'LEAD', score: 55, sentiment: 'NEUTRAL', risk: 'MEDIUM', ltv: '0', branchCode: 'AREE', assigned: 'toey', convStatus: 'FOLLOW_UP', waitMin: 0, unread: 0, tags: ['ติดตาม'], last: 'ไว้ว่างจะทักมาค่ะ', deal: { title: 'ต่อขนตา Classic', value: '1500', stage: 'Contacted' }, task: { title: 'ติดตามอีกครั้ง', days: 3 }, booking: null },
  { key: 'k11', convId: 'c11', name: 'คุณโบว์ สุขุม', lineName: 'bow.s', phone: '085-444-5566', dob: '1991-02-27', tier: 'ACTIVE', score: 62, sentiment: 'NEGATIVE', risk: 'HIGH', ltv: '4500', branchCode: 'SIAM', assigned: 'mind', convStatus: 'OPEN', waitMin: 20, unread: 0, tags: ['ดูแลหลังการขาย', 'complaint'], last: 'ขนตาหลุดเร็วมากทำไงดีคะ', deal: null, task: null, booking: null },
  { key: 'k12', convId: 'c12', name: 'คุณฝน พิมลวรรณ', lineName: 'fon.p', phone: '086-000-1122', dob: '1989-04-08', tier: 'ACTIVE', score: 70, sentiment: 'POSITIVE', risk: 'LOW', ltv: '9800', branchCode: 'THONG', assigned: 'praew', convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: [], last: 'ขอบคุณมากค่ะ', deal: null, task: null, booking: null },
  { key: 'k13', convId: 'c13', name: 'คุณต้นน้ำ ชลธาร', lineName: 'tonnam.c', phone: '087-555-6677', dob: '2000-10-13', tier: 'LEAD', score: 48, sentiment: 'POSITIVE', risk: 'MEDIUM', ltv: '0', branchCode: 'AREE', assigned: null, convStatus: 'NEW', waitMin: 33, unread: 1, tags: ['ลูกค้าใหม่'], last: 'รับต่อขนตาผู้ชายไหมครับ', deal: null, task: null, booking: null },
  { key: 'k14', convId: 'c14', name: 'คุณอิ๊ง ประภากร', lineName: 'ing.p', phone: '088-666-7788', dob: '1987-03-03', tier: 'ACTIVE', score: 66, sentiment: 'POSITIVE', risk: 'LOW', ltv: '5000', branchCode: 'SIAM', assigned: 'nice', convStatus: 'WAITING_INTERNAL', waitMin: 8, unread: 0, tags: ['นัดหมาย'], last: 'รอเช็คคิวช่างอยู่ค่ะ', deal: null, task: { title: 'เช็คคิวช่างว่าง', days: 0 }, booking: { dayOffset: 3, hour: 18, service: 'ต่อขนตา Natural', staff: 'nice' } },
] as const;

// Age (days before today) of each customer record, index-aligned with ROOM45_CUSTOMERS.
// Spread so the CRM dashboard period tabs (today / 7 days / this month / this quarter)
// each return a different, non-empty "new customers" count instead of all-today.
const ROOM45_CUSTOMER_AGE_DAYS = [0, 0, 2, 4, 6, 9, 3, 1, 8, 35, 50, 20, 70, 88];

// Age (days before today) of each *resolved* conversation, index-aligned with
// ROOM45_CUSTOMERS. Backdates historical resolved chats across report periods so the
// reports date filter (today / 7 days / this month / this quarter / last month) shows a
// realistic spread; live-queue conversations always stay near "now" (age 0).
// k4→last month, k5→earlier this month, k12→this week.
const ROOM45_CONVERSATION_AGE_DAYS = [0, 0, 0, 38, 10, 0, 0, 0, 0, 0, 0, 4, 0, 0];

const ROOM45_MESSAGES: Record<string, Array<{ dir: 'in' | 'out' | 'note'; text: string; by?: Room45StaffKey; ai?: boolean; type?: 'TEXT' | 'IMAGE'; contentJson?: Record<string, unknown> }>> = {
  c1: [{ dir: 'in', text: 'สวัสดีค่ะ สนใจต่อขนตาค่ะ' }, { dir: 'in', text: 'แบบ Volume ราคาเท่าไหร่คะ แล้วทำนานกี่ชั่วโมง' }],
  c2: [{ dir: 'in', text: 'พรุ่งนี้นัดไว้ 10 โมงใช่ไหมคะ' }, { dir: 'out', text: 'ใช่ค่ะ คุณเบลนัดรีทัชขนตา 10:00 นะคะ', by: 'mind' }, { dir: 'in', text: 'ขอเลื่อนนัดพรุ่งนี้เป็นบ่ายได้ไหมคะ' }, { dir: 'note', text: 'ลูกค้าเคยเลื่อนนัดบ่อย — เช็คคิวช่างก่อนยืนยัน', by: 'mind' }],
  c3: [{ dir: 'out', text: 'ส่งใบเสนอราคาแพ็กเกจรายเดือนให้แล้วนะคะ', by: 'mind' }, { dir: 'in', text: 'ได้รับใบเสนอราคาแล้วค่ะ ขอดูก่อนนะคะ' }],
  c4: [{ dir: 'in', text: 'สวัสดีค่ะ อยากทำเล็บเจลเพิ่มตอนมาต่อขนตาครั้งหน้าได้ไหมคะ' }, { dir: 'out', text: 'ได้เลยค่ะคุณจอย ทำเล็บเจล + ต่อขนตาได้ในครั้งเดียวเลยค่ะ ลูกค้า VIP รับส่วนลด 10% ด้วยนะคะ', by: 'nice' }, { dir: 'in', text: 'วันเสาร์นี้ช่วงเช้าได้ไหมคะ' }, { dir: 'out', text: 'เสาร์นี้ 11:00 มีคิวว่างพอดีค่ะ จองให้เลยนะคะ', by: 'nice' }, { dir: 'out', ai: true, text: 'จองคิวเรียบร้อยค่ะ — ต่อขนตา Volume + เล็บเจล เสาร์ 11:00 น.', by: 'nice' }, { dir: 'in', text: 'ขอบคุณมากค่ะ' }],
  c5: [{ dir: 'in', text: 'ขอบคุณมากค่ะ ประทับใจมาก' }, { dir: 'out', text: 'ขอบคุณมากเช่นกันค่ะ แล้วมาใหม่นะคะ', by: 'nice' }],
  c6: [{ dir: 'in', text: 'สอบถามโปรโมชั่นเดือนนี้ค่ะ มีอะไรบ้าง' }],
  c7: [{ dir: 'in', text: 'ขอที่อยู่ร้านหน่อยครับ' }],
  c8: [{ dir: 'in', text: 'สนใจจองคิวต่อขนตา Volume วันเสาร์นี้ค่ะ' }, { dir: 'out', text: 'ได้เลยค่ะคุณปูน เสาร์นี้ 14:00 ว่างพอดีค่ะ รบกวนโอนมัดจำ 1,800 บาท เพื่อยืนยันคิวนะคะ', by: 'praew' }, { dir: 'out', text: 'บัญชี กสิกรไทย 123-4-56789-0 ร้าน Room45 Eyes Lashes ค่ะ', by: 'praew' }, { dir: 'in', text: 'โอนมัดจำแล้วนะคะ แนบสลิปค่ะ' }, { dir: 'in', text: 'สลิปโอนเงิน 1,800 บาท · กสิกรไทย K PLUS · ref 0157XX8842', type: 'IMAGE', contentJson: { fileName: 'payment-proof-k8.png', seededPreviewFixture: true } }],
  c9: [{ dir: 'in', text: 'ต่อขนตาช่วงเย็นได้ไหมคะ' }, { dir: 'in', text: 'ร้านปิดกี่โมงคะ' }],
  c10: [{ dir: 'out', text: 'ส่งโปรโมชั่นให้แล้วนะคะ สนใจทักมาได้เลยค่ะ', by: 'toey' }, { dir: 'in', text: 'ไว้ว่างจะทักมาค่ะ' }],
  c11: [{ dir: 'in', text: 'ขนตาหลุดเร็วมากทำไงดีคะ เพิ่งทำมาอาทิตย์เดียว' }],
  c12: [{ dir: 'in', text: 'ขอบคุณมากค่ะ' }, { dir: 'out', text: 'ดูแลตัวเองนะคะ แล้วมาใหม่นะคะ', by: 'praew' }],
  c13: [{ dir: 'in', text: 'รับต่อขนตาผู้ชายไหมครับ' }],
  c14: [{ dir: 'in', text: 'รอเช็คคิวช่างอยู่ค่ะ' }, { dir: 'note', text: 'ช่างคิวเต็มถึงบ่าย รอเช็คคิวเย็น', by: 'nice' }],
};

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function customerPhone(value: string): string {
  const raw = digits(value);
  const thaiLocal = raw.startsWith('0066') ? raw.slice(4) : raw.startsWith('66') ? raw.slice(2) : raw;
  return thaiLocal.replace(/^0+/, '');
}

function customerName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function moneyNumber(value: string): string {
  return String(parseInt(value.replace(/[^0-9]/g, ''), 10) || 0);
}

// `hour` is a Bangkok wall-clock hour (UTC+7, no DST), resolved against the Bangkok calendar day —
// NOT the seeding host's clock. setHours() wrote the host's local time, so the same seed produced
// different instants on a UTC container and on a Thai laptop, and every booking landed 7 hours late
// in the week grid, which reads local hours over a 09:00-19:00 window (bookings.model.ts:15-16):
// a booking seeded for 11:00 rendered at 18:00, and 14:00/16:00/18:00 fell off the grid entirely.
function dateAt(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(bangkokDayStart(new Date()).getTime() + ((dayOffset * 24 + hour) * 60 + minute) * 60_000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

// UTC instant of the current Bangkok (UTC+7) calendar-day start. Used to keep "live" seed
// conversations inside today's report window even when the seed runs just after midnight.
function bangkokDayStart(now: Date): Date {
  const offset = 7 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offset) / 86_400_000) * 86_400_000 - offset);
}

async function seedQaRoleAccounts(companyId: string, branchId: string, createdByUserId: string) {
  for (const [index, account] of QA_ROLE_ACCOUNTS.entries()) {
    const user = await prisma.user.upsert({
      where: { username: account.username },
      update: { displayName: account.displayName, email: account.email, status: 'ACTIVE' },
      create: {
        id: `seed-qa-user-${account.roleKey.toLowerCase()}`,
        username: account.username,
        displayName: account.displayName,
        email: account.email,
        status: 'ACTIVE',
      },
    });

    // QA credentials are intentionally repaired on every local seed run so the documented
    // role matrix remains reliable for regression and permission testing.
    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: {
        passwordHash: hashPassword(account.password),
        status: 'ACTIVE',
        mustChangePassword: false,
        expiresAt: null,
        tempPasswordEncrypted: null,
      },
      create: {
        userId: user.id,
        passwordHash: hashPassword(account.password),
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });

    const membership = await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId, userId: user.id } },
      update: { status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: branchId },
      create: { companyId, userId: user.id, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: branchId },
    });
    const role = await prisma.role.findUniqueOrThrow({
      where: { scopeKey_key: { scopeKey: 'system', key: account.roleKey } },
    });
    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      update: {},
      create: { membershipId: membership.id, roleId: role.id },
    });

    const suffix = String(index + 1).padStart(2, '0');
    await prisma.employeeAccessProfile.upsert({
      where: { id: `seed-qa-profile-${account.roleKey.toLowerCase()}` },
      update: {
        displayName: account.displayName,
        legalName: account.displayName,
        phoneNumber: `08990010${suffix}`,
        status: 'ACTIVE',
        updatedByUserId: createdByUserId,
      },
      create: {
        id: `seed-qa-profile-${account.roleKey.toLowerCase()}`,
        companyId,
        userId: user.id,
        membershipId: membership.id,
        displayName: account.displayName,
        legalName: account.displayName,
        jobTitle: account.jobTitle,
        firstName: account.displayName.split(' ')[0],
        nickname: account.username.replace('qa.', '').toUpperCase(),
        identityType: 'THAI_NATIONAL_ID',
        identityLast4: `90${suffix}`,
        identityHash: `seed-qa-identity-${account.roleKey.toLowerCase()}`,
        identityEncryptedRef: `seed://qa/identity/${account.roleKey.toLowerCase()}`,
        phoneNumber: `08990010${suffix}`,
        status: 'ACTIVE',
        createdByUserId,
      },
    });
    await prisma.employeeAccessProfile.updateMany({
      where: { id: `seed-qa-profile-${account.roleKey.toLowerCase()}`, companyId, OR: [{ jobTitle: null }, { jobTitle: '' }] },
      data: { jobTitle: account.jobTitle },
    });
  }
}

async function seedRoom45DemoWorkspace(companyId: string, ownerUserId: string, headOfficeBranchId: string) {
  const db = prisma as any;

  const branchByCode = new Map<Room45BranchCode | 'HO', string>([['HO', headOfficeBranchId]]);
  for (const branch of ROOM45_BRANCHES) {
    const row = await prisma.branch.upsert({
      where: { id: branch.id },
      update: {
        code: branch.code,
        name: branch.name,
        type: 'BRANCH',
        taxBranchCode: branch.taxBranchCode,
        isVatEstablishment: branch.taxBranchCode != null,
        phone: branch.phone,
        email: branch.email,
        status: 'ACTIVE',
      },
      create: {
        id: branch.id,
        companyId,
        code: branch.code,
        name: branch.name,
        type: 'BRANCH',
        taxBranchCode: branch.taxBranchCode,
        isVatEstablishment: branch.taxBranchCode != null,
        phone: branch.phone,
        email: branch.email,
        status: 'ACTIVE',
        createdByUserId: ownerUserId,
      },
    });
    branchByCode.set(branch.code, row.id);
  }

  const roleByKey = new Map<string, string>();
  for (const key of ['OWNER', 'ADMIN', 'MANAGER', 'SALES']) {
    const role = await prisma.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key } } });
    if (role) roleByKey.set(key, role.id);
  }

  const staffUserByKey = new Map<Room45StaffKey, string>();
  for (const staff of ROOM45_STAFF) {
    const user = await prisma.user.upsert({
      where: { email: staff.email },
      update: { displayName: staff.displayName, status: 'ACTIVE' },
      create: { id: staff.userId, username: staff.email, email: staff.email, displayName: staff.displayName, status: 'ACTIVE' },
    });
    staffUserByKey.set(staff.key, user.id);

    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: { status: 'ACTIVE', mustChangePassword: false, expiresAt: null },
      create: { userId: user.id, passwordHash: hashPassword('Staff@123'), status: 'ACTIVE', mustChangePassword: false },
    });

    const defaultBranchId = branchByCode.get(staff.branchCode)!;
    const membership = await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId, userId: user.id } },
      update: { status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId },
      create: { companyId, userId: user.id, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId },
    });
    const roleId = roleByKey.get(staff.roleKey);
    if (roleId) {
      await prisma.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId: membership.id, roleId } },
        update: {},
        create: { membershipId: membership.id, roleId },
      });
    }

    await db.employeeAccessProfile.upsert({
      where: { id: staff.profileId },
      update: {
        displayName: staff.displayName,
        legalName: staff.legalName,
        firstName: staff.displayName,
        phoneNumber: staff.phoneNumber,
        status: 'ACTIVE',
        updatedByUserId: ownerUserId,
      },
      create: {
        id: staff.profileId,
        companyId,
        userId: user.id,
        membershipId: membership.id,
        displayName: staff.displayName,
        legalName: staff.legalName,
        firstName: staff.displayName,
        jobTitle: staff.jobTitle,
        identityType: 'THAI_NATIONAL_ID',
        identityLast4: staff.identityLast4,
        identityHash: `seed-room45-identity-${staff.key}`,
        identityEncryptedRef: `seed://room45/identity/${staff.key}`,
        phoneNumber: staff.phoneNumber,
        status: 'ACTIVE',
        createdByUserId: ownerUserId,
      },
    });
    await db.employeeAccessProfile.updateMany({
      where: { id: staff.profileId, companyId, OR: [{ jobTitle: null }, { jobTitle: '' }] },
      data: { jobTitle: staff.jobTitle },
    });
  }

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await db.crmPipelineStage.upsert({
      where: { companyId_name: { companyId, name: stage.name } },
      update: {
        canonicalGroup: stage.canonicalGroup,
        sortOrder: stage.sortOrder,
        probabilityDefault: stage.probabilityDefault,
        isTerminalWon: stage.isTerminalWon,
        isTerminalLost: stage.isTerminalLost,
        isActive: true,
        updatedByUserId: ownerUserId,
      },
      create: { companyId, createdByUserId: ownerUserId, ...stage },
    });
  }
  const stages = await db.crmPipelineStage.findMany({ where: { companyId } });
  const stageByName = new Map<string, any>(stages.map((stage: any) => [stage.name, stage]));

  const channel = await db.companyMessagingChannel.upsert({
    where: { id: 'seed-room45-line-channel' },
    update: {
      displayName: 'Room45 LINE OA (Local)',
      lineChannelId: 'room45-local-oa',
      status: 'ACTIVE',
      lastWebhookAt: new Date(),
      lastValidatedAt: new Date(),
    },
    create: {
      id: 'seed-room45-line-channel',
      companyId,
      provider: 'LINE_OA',
      displayName: 'Room45 LINE OA (Local)',
      lineChannelId: 'room45-local-oa',
      encryptedSecretJson: '{"seed":true,"kind":"local-demo"}',
      credentialLast4: 'demo',
      webhookKey: 'seed-room45-local-webhook',
      status: 'ACTIVE',
      lastWebhookAt: new Date(),
      lastValidatedAt: new Date(),
      connectedByUserId: ownerUserId,
    },
  });

  await db.crmInboxPolicy.upsert({
    where: { companyId },
    update: { firstResponseMinutes: 30, businessHoursJson: { timezone: 'Asia/Bangkok', days: [1, 2, 3, 4, 5, 6, 0], start: '09:00', end: '20:00' }, updatedByUserId: ownerUserId },
    create: { companyId, firstResponseMinutes: 30, businessHoursJson: { timezone: 'Asia/Bangkok', days: [1, 2, 3, 4, 5, 6, 0], start: '09:00', end: '20:00' }, updatedByUserId: ownerUserId },
  });

  const now = new Date();
  for (const [custIndex, customer] of ROOM45_CUSTOMERS.entries()) {
    const staffUserId = customer.assigned ? staffUserByKey.get(customer.assigned) : undefined;
    const branchId = branchByCode.get(customer.branchCode)!;
    const customerId = `seed-crm-customer-${customer.key}`;
    // Registration date, spread across periods for the dashboard filters.
    const customerCreatedAt = dateAt(-(ROOM45_CUSTOMER_AGE_DAYS[custIndex] ?? 0), 10);
    const hasStaffCustomerReply = ROOM45_MESSAGES[customer.convId]?.some((m) => m.dir === 'out') ?? false;
    // Live-queue conversations stay near now; resolved ones are backdated across report periods.
    const convAgeDays = customer.convStatus === 'RESOLVED' ? (ROOM45_CONVERSATION_AGE_DAYS[custIndex] ?? 0) : 0;
    const liveLastAt = customer.waitMin > 0 ? addMinutes(now, -customer.waitMin) : addMinutes(now, -90);
    // Clamp live conversations to today's Bangkok day so "วันนี้" is never empty just
    // because the seed ran shortly after midnight.
    const conversationCreatedAt = convAgeDays > 0
      ? dateAt(-convAgeDays, 10)
      : new Date(Math.max(addMinutes(liveLastAt, -60).getTime(), bangkokDayStart(now).getTime() + 60_000));
    const respMin = Math.min(customer.waitMin > 0 ? customer.waitMin : 55, 55);
    // Last activity + first response are anchored to creation for aged chats so the
    // response-time metric stays realistic (minutes, not days).
    const lastAt = convAgeDays > 0 ? addMinutes(conversationCreatedAt, respMin + 30) : liveLastAt;
    const firstResponseDueAt = customer.convStatus === 'RESOLVED' ? null : addMinutes(liveLastAt, 30);
    const firstRespondedAt = hasStaffCustomerReply
      ? (convAgeDays > 0 ? addMinutes(conversationCreatedAt, respMin) : addMinutes(liveLastAt, -5))
      : null;
    const slaBreachedAt = !firstRespondedAt && firstResponseDueAt && firstResponseDueAt < now ? now : null;

    await db.crmCustomer.upsert({
      where: { id: customerId },
      update: {
        branchId,
        displayName: customer.name,
        displayNameNormalized: customerName(customer.name),
        ownerUserId: staffUserId ?? ownerUserId,
        primaryPhone: customer.phone,
        primaryPhoneNormalized: customerPhone(customer.phone),
        lineUserId: null,
        consentStatus: 'GRANTED',
        source: 'LINE',
        originSource: 'LINE',
        createdByType: 'SYSTEM',
        notes: `LINE: ${customer.lineName}`,
        lastActivityAt: lastAt,
        lastContactedAt: firstRespondedAt ?? undefined,
        nextFollowUpAt: customer.task ? dateAt(customer.task.days, 17) : undefined,
        leadScore: customer.score,
        leadScoreUpdatedAt: now,
        sentiment: customer.sentiment,
        riskLevel: customer.risk,
        lifetimeValueAmount: moneyNumber(customer.ltv),
        lifetimeValueUpdatedAt: now,
        tier: customer.tier,
        engagementScore: customer.score,
        createdAt: customerCreatedAt,
        updatedByUserId: ownerUserId,
      },
      create: {
        id: customerId,
        companyId,
        branchId,
        code: `CRM-${customer.key.toUpperCase()}`,
        displayName: customer.name,
        displayNameNormalized: customerName(customer.name),
        customerType: 'PERSON',
        status: 'ACTIVE',
        ownerUserId: staffUserId ?? ownerUserId,
        primaryPhone: customer.phone,
        primaryPhoneNormalized: customerPhone(customer.phone),
        consentStatus: 'GRANTED',
        consentUpdatedAt: now,
        source: 'LINE',
        originSource: 'LINE',
        createdByType: 'SYSTEM',
        notes: `LINE: ${customer.lineName}`,
        lastActivityAt: lastAt,
        lastContactedAt: firstRespondedAt ?? undefined,
        nextFollowUpAt: customer.task ? dateAt(customer.task.days, 17) : undefined,
        leadScore: customer.score,
        leadScoreUpdatedAt: now,
        sentiment: customer.sentiment,
        riskLevel: customer.risk,
        lifetimeValueAmount: moneyNumber(customer.ltv),
        lifetimeValueUpdatedAt: now,
        tier: customer.tier,
        engagementScore: customer.score,
        createdAt: customerCreatedAt,
        createdByUserId: ownerUserId,
      },
    });

    await db.crmContactPerson.upsert({
      where: { id: `seed-crm-contact-${customer.key}` },
      update: { name: customer.name, phone: customer.phone, phoneNormalized: digits(customer.phone), lineUserId: `line-${customer.key}`, consentStatus: 'GRANTED', isPrimary: true, updatedByUserId: ownerUserId },
      create: {
        id: `seed-crm-contact-${customer.key}`,
        companyId,
        customerId,
        name: customer.name,
        role: 'LINE customer',
        phone: customer.phone,
        phoneNormalized: digits(customer.phone),
        lineUserId: `line-${customer.key}`,
        preferredChannel: 'LINE',
        consentStatus: 'GRANTED',
        isPrimary: true,
        createdByUserId: ownerUserId,
      },
    });

    if (customer.tier === 'LEAD') {
      await db.crmLead.upsert({
        where: { id: `seed-crm-lead-${customer.key}` },
        update: { rawName: customer.name, rawPhone: customer.phone, rawPhoneNormalized: digits(customer.phone), status: customer.deal ? 'QUALIFIED' : 'NEW', assignedToUserId: staffUserId ?? null, updatedByUserId: ownerUserId },
        create: {
          id: `seed-crm-lead-${customer.key}`,
          companyId,
          branchId,
          source: 'LINE',
          sourceRefType: 'crm_conversation',
          sourceRefId: `seed-crm-conversation-${customer.convId}`,
          rawName: customer.name,
          rawPhone: customer.phone,
          rawPhoneNormalized: digits(customer.phone),
          status: customer.deal ? 'QUALIFIED' : 'NEW',
          assignedToUserId: staffUserId ?? null,
          createdByUserId: ownerUserId,
        },
      });
    }

    if (customer.deal) {
      const stage = stageByName.get(customer.deal.stage) ?? stageByName.get('New lead');
      await db.crmOpportunity.upsert({
        where: { id: `seed-crm-opportunity-${customer.key}` },
        update: {
          branchId,
          customerId,
          ownerUserId: staffUserId ?? ownerUserId,
          title: customer.deal.title,
          stageId: stage.id,
          canonicalStageGroup: stage.canonicalGroup,
          amountEstimate: customer.deal.value,
          probability: stage.probabilityDefault,
          lastActivityAt: lastAt,
          nextFollowUpAt: customer.task ? dateAt(customer.task.days, 17) : dateAt(7, 17),
          updatedByUserId: ownerUserId,
        },
        create: {
          id: `seed-crm-opportunity-${customer.key}`,
          companyId,
          branchId,
          customerId,
          ownerUserId: staffUserId ?? ownerUserId,
          title: customer.deal.title,
          stageId: stage.id,
          canonicalStageGroup: stage.canonicalGroup,
          status: 'OPEN',
          amountEstimate: customer.deal.value,
          currency: 'THB',
          probability: stage.probabilityDefault,
          expectedCloseDate: dateAt(14, 17),
          lastActivityAt: lastAt,
          nextFollowUpAt: customer.task ? dateAt(customer.task.days, 17) : dateAt(7, 17),
          createdByUserId: ownerUserId,
        },
      });
    }

    if (customer.task) {
      await db.crmFollowUpTask.upsert({
        where: { id: `seed-crm-followup-${customer.key}` },
        update: { title: customer.task.title, dueAt: dateAt(customer.task.days, 17), ownerUserId: staffUserId ?? ownerUserId, priority: customer.task.days < 0 ? 'HIGH' : 'NORMAL', updatedByUserId: ownerUserId },
        create: {
          id: `seed-crm-followup-${customer.key}`,
          companyId,
          customerId,
          opportunityId: customer.deal ? `seed-crm-opportunity-${customer.key}` : undefined,
          ownerUserId: staffUserId ?? ownerUserId,
          title: customer.task.title,
          dueAt: dateAt(customer.task.days, 17),
          priority: customer.task.days < 0 ? 'HIGH' : 'NORMAL',
          channel: 'LINE',
          status: customer.task.days < 0 ? 'OVERDUE' : 'OPEN',
          createdByUserId: ownerUserId,
        },
      });
    }

    if (customer.booking) {
      const startAt = dateAt(customer.booking.dayOffset, customer.booking.hour);
      const endAt = addMinutes(startAt, 90);
      await db.crmBooking.upsert({
        where: { id: `seed-crm-booking-${customer.key}` },
        update: {
          branchId,
          customerId,
          customerName: customer.name,
          serviceName: customer.booking.service,
          staffUserId: staffUserByKey.get(customer.booking.staff),
          startAt,
          endAt,
          sourceConversationId: `seed-crm-conversation-${customer.convId}`,
          status: 'BOOKED',
          updatedByUserId: ownerUserId,
        },
        create: {
          id: `seed-crm-booking-${customer.key}`,
          companyId,
          branchId,
          customerId,
          customerName: customer.name,
          serviceName: customer.booking.service,
          staffUserId: staffUserByKey.get(customer.booking.staff),
          startAt,
          endAt,
          sourceConversationId: `seed-crm-conversation-${customer.convId}`,
          status: 'BOOKED',
          createdByUserId: ownerUserId,
        },
      });
    }

    const identity = await db.crmChannelIdentity.upsert({
      where: { id: `seed-crm-identity-${customer.key}` },
      update: { displayName: customer.lineName, status: 'ACTIVE', customerId },
      create: {
        id: `seed-crm-identity-${customer.key}`,
        companyId,
        channelId: channel.id,
        customerId,
        provider: 'LINE_OA',
        providerUserId: `line-user-${customer.key}`,
        displayName: customer.lineName,
        followedAt: addMinutes(now, -14_400),
        status: 'ACTIVE',
      },
    });

    await db.crmConversation.upsert({
      where: { id: `seed-crm-conversation-${customer.convId}` },
      update: {
        channelId: channel.id,
        customerId,
        channelIdentityId: identity.id,
        status: customer.convStatus,
        priority: customer.waitMin > 30 ? 'HIGH' : 'NORMAL',
        assignedToUserId: staffUserId ?? null,
        unreadCount: customer.unread,
        lastMessageAt: lastAt,
        lastInboundAt: lastAt,
        lastOutboundAt: firstRespondedAt,
        lastMessagePreview: customer.last,
        firstResponseDueAt,
        firstRespondedAt,
        slaBreachedAt,
        resolvedAt: customer.convStatus === 'RESOLVED' ? lastAt : null,
        resolvedByUserId: customer.convStatus === 'RESOLVED' ? staffUserId ?? ownerUserId : null,
        tagsJson: customer.tags,
        createdAt: conversationCreatedAt,
      },
      create: {
        id: `seed-crm-conversation-${customer.convId}`,
        companyId,
        channelId: channel.id,
        customerId,
        channelIdentityId: identity.id,
        status: customer.convStatus,
        priority: customer.waitMin > 30 ? 'HIGH' : 'NORMAL',
        assignedToUserId: staffUserId ?? null,
        unreadCount: customer.unread,
        lastMessageAt: lastAt,
        lastInboundAt: lastAt,
        lastOutboundAt: firstRespondedAt,
        lastMessagePreview: customer.last,
        firstResponseDueAt,
        firstRespondedAt,
        slaBreachedAt,
        resolvedAt: customer.convStatus === 'RESOLVED' ? lastAt : null,
        resolvedByUserId: customer.convStatus === 'RESOLVED' ? staffUserId ?? ownerUserId : null,
        tagsJson: customer.tags,
        createdAt: conversationCreatedAt,
      },
    });

    const messages = ROOM45_MESSAGES[customer.convId] ?? [];
    for (const [index, message] of messages.entries()) {
      const createdAt = addMinutes(lastAt, index - messages.length + 1);
      const authorUserId = message.by ? staffUserByKey.get(message.by) : message.dir === 'out' ? staffUserId : undefined;
      await db.crmMessage.upsert({
        where: { id: `seed-crm-message-${customer.convId}-${index + 1}` },
        update: {
          direction: message.dir === 'in' ? 'INBOUND' : 'OUTBOUND',
          visibility: message.dir === 'note' ? 'INTERNAL_NOTE' : 'CUSTOMER',
          authorType: message.dir === 'in' ? 'CUSTOMER' : message.ai ? 'SYSTEM' : 'STAFF',
          authorUserId,
          messageType: message.type ?? 'TEXT',
          contentText: message.text,
          contentJson: message.contentJson ?? undefined,
          providerMessageId: message.dir === 'in' ? `seed-provider-${customer.convId}-${index + 1}` : undefined,
          deliveryStatus: message.dir === 'in' ? 'DELIVERED' : 'SENT',
          sentAt: createdAt,
          createdAt,
        },
        create: {
          id: `seed-crm-message-${customer.convId}-${index + 1}`,
          companyId,
          conversationId: `seed-crm-conversation-${customer.convId}`,
          direction: message.dir === 'in' ? 'INBOUND' : 'OUTBOUND',
          visibility: message.dir === 'note' ? 'INTERNAL_NOTE' : 'CUSTOMER',
          authorType: message.dir === 'in' ? 'CUSTOMER' : message.ai ? 'SYSTEM' : 'STAFF',
          authorUserId,
          messageType: message.type ?? 'TEXT',
          contentText: message.text,
          contentJson: message.contentJson ?? undefined,
          providerMessageId: message.dir === 'in' ? `seed-provider-${customer.convId}-${index + 1}` : undefined,
          deliveryStatus: message.dir === 'in' ? 'DELIVERED' : 'SENT',
          sentAt: createdAt,
          createdAt,
        },
      });
    }
  }

  const templates = [
    { id: 'seed-crm-template-price-volume', title: 'ราคา Volume', bodyText: 'สวัสดีค่ะ คอร์สต่อขนตาแบบ Volume ราคา 2,500 บาท ติดทนประมาณ 4-6 สัปดาห์ค่ะ สะดวกจองคิววันไหนดีคะ?', category: 'sales' },
    { id: 'seed-crm-template-reschedule', title: 'เลื่อนนัด', bodyText: 'ได้เลยค่ะ รบกวนแจ้งวันและเวลาที่สะดวก เดี๋ยวเช็คคิวช่างให้ทันทีนะคะ', category: 'booking' },
    { id: 'seed-crm-template-payment-confirm', title: 'ยืนยันสลิป', bodyText: 'ได้รับสลิปการโอนแล้วนะคะ ยืนยันนัดเรียบร้อยค่ะ ขอบคุณค่ะ', category: 'finance' },
    { id: 'seed-crm-template-aftercare', title: 'ดูแลหลังการขาย', bodyText: 'ขอโทษนะคะ รบกวนเข้ามาให้ทางร้านเช็คให้ฟรีค่ะ สะดวกวันไหนดีคะ?', category: 'service' },
  ];
  for (const template of templates) {
    await db.crmMessageTemplate.upsert({
      where: { id: template.id },
      update: { title: template.title, bodyText: template.bodyText, category: template.category, status: 'ACTIVE', updatedByUserId: ownerUserId },
      create: { ...template, companyId, status: 'ACTIVE', createdByUserId: ownerUserId },
    });
  }

  await db.reportView.upsert({
    where: { id: 'seed-report-view-crm-pipeline' },
    update: {
      name: 'CRM Pipeline · Local Demo',
      visibility: 'COMPANY',
      filtersJson: { scope: 'all' },
      chartConfigJson: { chartKind: 'bar' },
      pinned: true,
    },
    create: {
      id: 'seed-report-view-crm-pipeline',
      companyId,
      ownerUserId,
      datasetCode: 'sales.pipeline',
      name: 'CRM Pipeline · Local Demo',
      description: 'Seeded CRM pipeline report view for local MVP testing.',
      visibility: 'COMPANY',
      filtersJson: { scope: 'all' },
      dimensionsJson: ['metric'],
      measuresJson: ['value'],
      chartConfigJson: { chartKind: 'bar' },
      pinned: true,
    },
  });
}

// ---- Second demo company (Bloom Clinic) ----
// A distinct customer company so the header company switcher has more than one
// option and branch/period filters can be exercised across two tenants.

const BLOOM_BRANCHES = [
  { id: 'seed-bloom-branch-central', code: 'BLM-CTW', name: 'Bloom Clinic · เซ็นทรัลเวิลด์', taxBranchCode: '00001', phone: '02-100-2001', email: 'ctw@bloom.local' },
  { id: 'seed-bloom-branch-ladprao', code: 'BLM-LAD', name: 'Bloom Clinic · ลาดพร้าว', taxBranchCode: '00002', phone: '02-100-2002', email: 'ladprao@bloom.local' },
] as const;

// branchCode 'HO' = head office (passed in). ageDays spreads registration dates so
// the dashboard period tabs differ; tags:['complaint'] feeds the complaints card.
const BLOOM_CUSTOMERS = [
  { key: 'b1', name: 'คุณอร ชนิกานต์', lineName: 'orn.c', phone: '061-201-0001', branchCode: 'HO', ageDays: 0, convStatus: 'NEW', waitMin: 3, unread: 2, tags: ['ลูกค้าใหม่'], last: 'สนใจโปรแกรมดูแลผิวหน้าค่ะ', deal: '4500', booking: null },
  { key: 'b2', name: 'คุณเมย์ ธัญชนก', lineName: 'may.t', phone: '061-201-0002', branchCode: 'BLM-CTW', ageDays: 0, convStatus: 'WAITING_INTERNAL', waitMin: 15, unread: 1, tags: ['นัดหมาย'], last: 'ขอยืนยันนัดพรุ่งนี้ค่ะ', deal: null, booking: { dayOffset: 0, hour: 15, service: 'ทรีตเมนต์ผิวหน้า' } },
  { key: 'b3', name: 'คุณกวาง ปิยะดา', lineName: 'kwang.p', phone: '061-201-0003', branchCode: 'BLM-LAD', ageDays: 3, convStatus: 'OPEN', waitMin: 40, unread: 0, tags: ['ดูแลหลังการขาย', 'complaint'], last: 'ผิวแพ้หลังทำทรีตเมนต์ค่ะ', deal: null, booking: null },
  { key: 'b4', name: 'คุณนุ่น วรินทร', lineName: 'nun.w', phone: '061-201-0004', branchCode: 'HO', ageDays: 5, convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: ['VIP'], last: 'ขอบคุณค่ะ ประทับใจมาก', deal: '18000', booking: { dayOffset: 2, hour: 11, service: 'คอร์สเลเซอร์' } },
  { key: 'b5', name: 'คุณแอน สุรีรัตน์', lineName: 'ann.s', phone: '061-201-0005', branchCode: 'BLM-CTW', ageDays: 2, convStatus: 'WAITING_CUSTOMER', waitMin: 25, unread: 0, tags: ['รอตัดสินใจ'], last: 'ขอดูใบเสนอราคาก่อนนะคะ', deal: '6200', booking: null },
  { key: 'b6', name: 'คุณจีน่า พัชรี', lineName: 'gina.p', phone: '061-201-0006', branchCode: 'BLM-LAD', ageDays: 9, convStatus: 'NEW', waitMin: 50, unread: 1, tags: ['ลูกค้าใหม่'], last: 'สอบถามโปรเลเซอร์เดือนนี้ค่ะ', deal: null, booking: null },
  { key: 'b7', name: 'คุณฟ้า ณัฐริกา', lineName: 'fah.n', phone: '061-201-0007', branchCode: 'HO', ageDays: 1, convStatus: 'OPEN', waitMin: 6, unread: 0, tags: [], last: 'ร้านเปิดกี่โมงคะ', deal: null, booking: null },
  { key: 'b8', name: 'คุณบีม ศศิธร', lineName: 'beam.s', phone: '061-201-0008', branchCode: 'BLM-CTW', ageDays: 6, convStatus: 'FOLLOW_UP', waitMin: 0, unread: 0, tags: ['ติดตาม'], last: 'ไว้ว่างจะแวะไปค่ะ', deal: '3200', booking: null },
  { key: 'b9', name: 'คุณแพน กมลชนก', lineName: 'pan.k', phone: '061-201-0009', branchCode: 'BLM-LAD', ageDays: 15, convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: [], last: 'จองคิวเรียบร้อยค่ะ', deal: null, booking: null },
  { key: 'b10', name: 'คุณโอปอล์ ธีรดา', lineName: 'opal.t', phone: '061-201-0010', branchCode: 'HO', ageDays: 25, convStatus: 'WAITING_INTERNAL', waitMin: 12, unread: 1, tags: ['นัดหมาย'], last: 'โอนมัดจำแล้วค่ะ', deal: null, booking: { dayOffset: 1, hour: 13, service: 'ทรีตเมนต์ผิวหน้า' } },
  { key: 'b11', name: 'คุณไอซ์ ปวีณา', lineName: 'ice.p', phone: '061-201-0011', branchCode: 'BLM-CTW', ageDays: 45, convStatus: 'OPEN', waitMin: 20, unread: 0, tags: ['ดูแลหลังการขาย'], last: 'อยากปรึกษาเรื่องผิวค่ะ', deal: null, booking: null },
  { key: 'b12', name: 'คุณเจี๊ยบ อารยา', lineName: 'jeab.a', phone: '061-201-0012', branchCode: 'BLM-LAD', ageDays: 70, convStatus: 'RESOLVED', waitMin: 0, unread: 0, tags: [], last: 'ขอบคุณมากค่ะ', deal: '9800', booking: null },
] as const;

async function seedBloomDemoWorkspace(companyId: string, ownerUserId: string, headOfficeBranchId: string) {
  const db = prisma as any;

  const branchByCode = new Map<string, string>([['HO', headOfficeBranchId]]);
  for (const branch of BLOOM_BRANCHES) {
    const row = await prisma.branch.upsert({
      where: { id: branch.id },
      update: { code: branch.code, name: branch.name, type: 'BRANCH', taxBranchCode: branch.taxBranchCode, isVatEstablishment: branch.taxBranchCode != null, phone: branch.phone, email: branch.email, status: 'ACTIVE' },
      create: { id: branch.id, companyId, code: branch.code, name: branch.name, type: 'BRANCH', taxBranchCode: branch.taxBranchCode, isVatEstablishment: branch.taxBranchCode != null, phone: branch.phone, email: branch.email, status: 'ACTIVE', createdByUserId: ownerUserId },
    });
    branchByCode.set(branch.code, row.id);
  }

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await db.crmPipelineStage.upsert({
      where: { companyId_name: { companyId, name: stage.name } },
      update: { canonicalGroup: stage.canonicalGroup, sortOrder: stage.sortOrder, probabilityDefault: stage.probabilityDefault, isTerminalWon: stage.isTerminalWon, isTerminalLost: stage.isTerminalLost, isActive: true, updatedByUserId: ownerUserId },
      create: { companyId, createdByUserId: ownerUserId, ...stage },
    });
  }
  const stages = await db.crmPipelineStage.findMany({ where: { companyId } });
  const stageByName = new Map<string, any>(stages.map((stage: any) => [stage.name, stage]));
  const firstStage = stageByName.get('New lead') ?? stages[0];

  const channel = await db.companyMessagingChannel.upsert({
    where: { id: 'seed-bloom-line-channel' },
    update: { displayName: 'Bloom Clinic LINE OA (Local)', lineChannelId: 'bloom-local-oa', status: 'ACTIVE', lastWebhookAt: new Date(), lastValidatedAt: new Date() },
    create: {
      id: 'seed-bloom-line-channel', companyId, provider: 'LINE_OA', displayName: 'Bloom Clinic LINE OA (Local)', lineChannelId: 'bloom-local-oa',
      encryptedSecretJson: '{"seed":true,"kind":"local-demo"}', credentialLast4: 'demo', webhookKey: 'seed-bloom-local-webhook', status: 'ACTIVE',
      lastWebhookAt: new Date(), lastValidatedAt: new Date(), connectedByUserId: ownerUserId,
    },
  });

  await db.crmInboxPolicy.upsert({
    where: { companyId },
    update: { firstResponseMinutes: 30, businessHoursJson: { timezone: 'Asia/Bangkok', days: [1, 2, 3, 4, 5, 6, 0], start: '09:00', end: '20:00' }, updatedByUserId: ownerUserId },
    create: { companyId, firstResponseMinutes: 30, businessHoursJson: { timezone: 'Asia/Bangkok', days: [1, 2, 3, 4, 5, 6, 0], start: '09:00', end: '20:00' }, updatedByUserId: ownerUserId },
  });

  const now = new Date();
  for (const customer of BLOOM_CUSTOMERS) {
    const branchId = branchByCode.get(customer.branchCode)!;
    const customerId = `seed-bloom-customer-${customer.key}`;
    const customerCreatedAt = dateAt(-customer.ageDays, 10);
    const lastAt = customer.waitMin > 0 ? addMinutes(now, -customer.waitMin) : addMinutes(now, -120);
    const firstRespondedAt = customer.convStatus === 'NEW' ? null : addMinutes(lastAt, -8);
    const firstResponseDueAt = customer.convStatus === 'RESOLVED' ? null : addMinutes(lastAt, 30);
    const slaBreachedAt = !firstRespondedAt && firstResponseDueAt && firstResponseDueAt < now ? now : null;

    await db.crmCustomer.upsert({
      where: { id: customerId },
      update: { branchId, displayName: customer.name, displayNameNormalized: customerName(customer.name), ownerUserId, primaryPhone: customer.phone, primaryPhoneNormalized: customerPhone(customer.phone), lineUserId: null, consentStatus: 'GRANTED', source: 'LINE', originSource: 'LINE', createdByType: 'SYSTEM', lastActivityAt: lastAt, createdAt: customerCreatedAt, updatedByUserId: ownerUserId },
      create: {
        id: customerId, companyId, branchId, code: `BLM-${customer.key.toUpperCase()}`, displayName: customer.name, displayNameNormalized: customerName(customer.name), customerType: 'PERSON', status: 'ACTIVE',
        ownerUserId, primaryPhone: customer.phone, primaryPhoneNormalized: customerPhone(customer.phone), consentStatus: 'GRANTED', consentUpdatedAt: now,
        source: 'LINE', originSource: 'LINE', createdByType: 'SYSTEM', notes: `LINE: ${customer.lineName}`, lastActivityAt: lastAt, createdAt: customerCreatedAt, createdByUserId: ownerUserId,
      },
    });

    const identity = await db.crmChannelIdentity.upsert({
      where: { id: `seed-bloom-identity-${customer.key}` },
      update: { displayName: customer.lineName, status: 'ACTIVE', customerId },
      create: { id: `seed-bloom-identity-${customer.key}`, companyId, channelId: channel.id, customerId, provider: 'LINE_OA', providerUserId: `bloom-line-${customer.key}`, displayName: customer.lineName, followedAt: addMinutes(now, -14_400), status: 'ACTIVE' },
    });

    await db.crmConversation.upsert({
      where: { id: `seed-bloom-conversation-${customer.key}` },
      update: { channelId: channel.id, customerId, channelIdentityId: identity.id, status: customer.convStatus, assignedToUserId: null, unreadCount: customer.unread, lastMessageAt: lastAt, lastInboundAt: lastAt, lastOutboundAt: firstRespondedAt, lastMessagePreview: customer.last, firstResponseDueAt, firstRespondedAt, slaBreachedAt, resolvedAt: customer.convStatus === 'RESOLVED' ? lastAt : null, tagsJson: customer.tags, createdAt: customerCreatedAt },
      create: {
        id: `seed-bloom-conversation-${customer.key}`, companyId, channelId: channel.id, customerId, channelIdentityId: identity.id, status: customer.convStatus,
        priority: customer.waitMin > 30 ? 'HIGH' : 'NORMAL', assignedToUserId: null, unreadCount: customer.unread, lastMessageAt: lastAt, lastInboundAt: lastAt, lastOutboundAt: firstRespondedAt,
        lastMessagePreview: customer.last, firstResponseDueAt, firstRespondedAt, slaBreachedAt, resolvedAt: customer.convStatus === 'RESOLVED' ? lastAt : null,
        resolvedByUserId: customer.convStatus === 'RESOLVED' ? ownerUserId : null, tagsJson: customer.tags, createdAt: customerCreatedAt,
      },
    });

    await db.crmMessage.upsert({
      where: { id: `seed-bloom-message-${customer.key}-1` },
      update: {
        direction: 'INBOUND',
        visibility: 'CUSTOMER',
        authorType: 'CUSTOMER',
        messageType: 'TEXT',
        contentText: customer.last,
        providerMessageId: `seed-bloom-provider-${customer.key}-1`,
        deliveryStatus: 'DELIVERED',
        sentAt: lastAt,
        createdAt: lastAt,
      },
      create: {
        id: `seed-bloom-message-${customer.key}-1`,
        companyId,
        conversationId: `seed-bloom-conversation-${customer.key}`,
        direction: 'INBOUND',
        visibility: 'CUSTOMER',
        authorType: 'CUSTOMER',
        messageType: 'TEXT',
        contentText: customer.last,
        providerMessageId: `seed-bloom-provider-${customer.key}-1`,
        deliveryStatus: 'DELIVERED',
        sentAt: lastAt,
        createdAt: lastAt,
      },
    });

    if (customer.booking) {
      const startAt = dateAt(customer.booking.dayOffset, customer.booking.hour);
      await db.crmBooking.upsert({
        where: { id: `seed-bloom-booking-${customer.key}` },
        update: { branchId, customerId, customerName: customer.name, serviceName: customer.booking.service, startAt, endAt: addMinutes(startAt, 90), status: 'BOOKED', updatedByUserId: ownerUserId },
        create: { id: `seed-bloom-booking-${customer.key}`, companyId, branchId, customerId, customerName: customer.name, serviceName: customer.booking.service, startAt, endAt: addMinutes(startAt, 90), status: 'BOOKED', createdByUserId: ownerUserId },
      });
    }

    if (customer.deal) {
      const stage = firstStage;
      await db.crmOpportunity.upsert({
        where: { id: `seed-bloom-opportunity-${customer.key}` },
        update: { branchId, customerId, ownerUserId, title: `ดีล ${customer.name}`, stageId: stage.id, canonicalStageGroup: stage.canonicalGroup, amountEstimate: customer.deal, probability: stage.probabilityDefault, lastActivityAt: lastAt, updatedByUserId: ownerUserId },
        create: { id: `seed-bloom-opportunity-${customer.key}`, companyId, branchId, customerId, ownerUserId, title: `ดีล ${customer.name}`, stageId: stage.id, canonicalStageGroup: stage.canonicalGroup, status: 'OPEN', amountEstimate: customer.deal, currency: 'THB', probability: stage.probabilityDefault, expectedCloseDate: dateAt(14, 17), lastActivityAt: lastAt, nextFollowUpAt: dateAt(7, 17), createdByUserId: ownerUserId },
      });
    }
  }
}

async function upsertStoredSeedAttachment(input: {
  db: any;
  id: string;
  companyId: string;
  branchId: string;
  originalFileName: string;
  mimeType: string;
  bytes: Buffer;
  stored: SeedStoredAttachment;
  uploadedByUserId: string;
  uploadedAt: Date;
  persistBlob?: boolean;
}) {
  const attachmentData = {
    branchId: input.branchId,
    storageProvider: input.stored.storageProvider,
    bucket: input.stored.bucket,
    objectKey: input.stored.objectKey,
    objectVersionId: input.stored.objectVersionId,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    byteSize: input.stored.byteSize,
    checksumSha256: input.stored.checksumSha256,
    visibility: 'INTERNAL',
    status: 'ACTIVE',
    uploadedByUserId: input.uploadedByUserId,
    uploadedAt: input.uploadedAt,
    deletedAt: null,
    metadataJson: { seededPreviewFixture: true },
  };
  await input.db.attachmentObject.upsert({
    where: { id: input.id },
    update: attachmentData,
    create: {
      id: input.id,
      companyId: input.companyId,
      ...attachmentData,
    },
  });
  if (input.persistBlob) {
    await input.db.attachmentBlob.upsert({
      where: { attachmentId: input.id },
      update: { companyId: input.companyId, data: new Uint8Array(input.bytes) },
      create: { attachmentId: input.id, companyId: input.companyId, data: new Uint8Array(input.bytes) },
    });
  }
}

async function seedOperationalDemoData(input: {
  companyId: string;
  ownerUserId: string;
  branchId: string;
  inventoryLocationId: string;
  productId: string;
}) {
  const db = prisma as any;
  const { companyId, ownerUserId, branchId, inventoryLocationId, productId } = input;
  const at = (dayOffset: number, hour: number, minute = 0) => dateAt(dayOffset, hour, minute);

  const expenseCategories = [
    { id: 'seed-expense-category-office', name: 'ค่าสำนักงาน', accountHintKey: 'expense.office_supplies', sortOrder: 1 },
    { id: 'seed-expense-category-marketing', name: 'ค่าโฆษณาและการตลาด', accountHintKey: 'expense.marketing', sortOrder: 2 },
    { id: 'seed-expense-category-travel', name: 'ค่าเดินทาง', accountHintKey: 'expense.travel', sortOrder: 3 },
    { id: 'seed-expense-category-rent', name: 'ค่าเช่า', accountHintKey: 'expense.rent', sortOrder: 4 },
    { id: 'seed-expense-category-utilities', name: 'ค่าสาธารณูปโภค', accountHintKey: 'expense.utilities', sortOrder: 5 },
    { id: 'seed-expense-category-meals', name: 'ค่าอาหารและเครื่องดื่ม', accountHintKey: 'expense.meals', sortOrder: 6 },
  ] as const;
  for (const cat of expenseCategories) {
    await db.expenseCategory.upsert({
      where: { id: cat.id },
      update: {
        name: cat.name,
        accountHintKey: cat.accountHintKey,
        sortOrder: cat.sortOrder,
        status: 'ACTIVE',
      },
      create: {
        id: cat.id,
        companyId,
        name: cat.name,
        accountHintKey: cat.accountHintKey,
        sortOrder: cat.sortOrder,
        status: 'ACTIVE',
      },
    });
  }

  await seedExpenses(prisma, { companyId, ownerUserId, branchId }, seedExpenseRows(at));

  const customerCounterparty = await db.accountingCounterparty.upsert({
    where: { id: 'seed-counterparty-customer-joy' },
    update: {
      displayName: 'คุณจอย รุ่งเรือง',
      legalName: 'คุณจอย รุ่งเรือง',
      phone: '086-777-9900',
      type: 'CUSTOMER',
      status: 'ACTIVE',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-counterparty-customer-joy',
      companyId,
      type: 'CUSTOMER',
      displayName: 'คุณจอย รุ่งเรือง',
      legalName: 'คุณจอย รุ่งเรือง',
      phone: '086-777-9900',
      status: 'ACTIVE',
      createdByUserId: ownerUserId,
    },
  });

  // Link the matching CRM customer to this counterparty so the daily-brief
  // "overdue payments" card (which only counts customer-linked receivables) fires.
  await db.crmCustomer.updateMany({
    where: { id: 'seed-crm-customer-k4' },
    data: { accountingCounterpartyId: customerCounterparty.id },
  });

  await db.accountingDocument.upsert({
    where: { id: 'seed-accounting-document-invoice' },
    update: {
      branchId,
      documentType: 'INVOICE',
      documentNumber: 'INV-LOCAL-0001',
      status: 'ISSUED',
      documentDate: at(-3, 12),
      dueDate: at(4, 12),
      counterpartyId: customerCounterparty.id,
      vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '12000',
      taxableAmount: '12000',
      vatAmount: '840',
      grandTotalAmount: '12840',
      paidAmount: '5000',
      outstandingAmount: '7840',
      paymentStatus: 'PARTIALLY_PAID',
      issuedByUserId: ownerUserId,
      issuedAt: at(-3, 12, 30),
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-accounting-document-invoice',
      companyId,
      branchId,
      documentType: 'INVOICE',
      documentNumber: 'INV-LOCAL-0001',
      status: 'ISSUED',
      documentDate: at(-3, 12),
      dueDate: at(4, 12),
      counterpartyId: customerCounterparty.id,
      counterpartySnapshotJson: { displayName: customerCounterparty.displayName, phone: customerCounterparty.phone },
      vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '12000',
      taxableAmount: '12000',
      vatAmount: '840',
      grandTotalAmount: '12840',
      paidAmount: '5000',
      outstandingAmount: '7840',
      paymentStatus: 'PARTIALLY_PAID',
      issuedByUserId: ownerUserId,
      issuedAt: at(-3, 12, 30),
      createdByUserId: ownerUserId,
    },
  });
  await db.accountingDocumentLine.upsert({
    where: { id: 'seed-accounting-document-line-invoice' },
    update: {
      description: 'แพ็กเกจ VIP รายปี',
      quantity: '1',
      unitPrice: '12000',
      vatRate: '0.07',
      vatAmount: '840',
      lineSubtotalAmount: '12000',
      lineTotalAmount: '12840',
    },
    create: {
      id: 'seed-accounting-document-line-invoice',
      companyId,
      documentId: 'seed-accounting-document-invoice',
      lineNumber: 1,
      description: 'แพ็กเกจ VIP รายปี',
      quantity: '1',
      unitPrice: '12000',
      vatRate: '0.07',
      vatAmount: '840',
      lineSubtotalAmount: '12000',
      lineTotalAmount: '12840',
      revenueCategory: 'service',
    },
  });

  // Overdue receivable (item 3 "ยอดค้างชำระเกินกำหนด" card): issued, due in the past,
  // outstanding > 0, counterparty linked to CRM customer k4.
  await db.accountingDocument.upsert({
    where: { id: 'seed-accounting-document-invoice-overdue' },
    update: { branchId, documentType: 'INVOICE', documentNumber: 'INV-LOCAL-0002', status: 'ISSUED', documentDate: at(-40, 12), dueDate: at(-12, 12), counterpartyId: customerCounterparty.id, vatMode: 'VAT_EXCLUDED', subtotalAmount: '8500', taxableAmount: '8500', vatAmount: '595', grandTotalAmount: '9095', paidAmount: '0', outstandingAmount: '9095', paymentStatus: 'OVERDUE', issuedByUserId: ownerUserId, issuedAt: at(-40, 12, 30), updatedByUserId: ownerUserId },
    create: {
      id: 'seed-accounting-document-invoice-overdue', companyId, branchId, documentType: 'INVOICE', documentNumber: 'INV-LOCAL-0002', status: 'ISSUED', documentDate: at(-40, 12), dueDate: at(-12, 12),
      counterpartyId: customerCounterparty.id, counterpartySnapshotJson: { displayName: customerCounterparty.displayName, phone: customerCounterparty.phone }, vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '8500', taxableAmount: '8500', vatAmount: '595', grandTotalAmount: '9095', paidAmount: '0', outstandingAmount: '9095', paymentStatus: 'OVERDUE', issuedByUserId: ownerUserId, issuedAt: at(-40, 12, 30), createdByUserId: ownerUserId,
    },
  });

  // Issued quotation awaiting customer acceptance (item 3 "ใบเสนอรอลูกค้าตอบรับ" card).
  await db.accountingDocument.upsert({
    where: { id: 'seed-accounting-document-quotation' },
    update: { branchId, documentType: 'QUOTATION', documentNumber: 'QT-LOCAL-0001', status: 'ISSUED', documentDate: at(-2, 12), dueDate: at(12, 12), counterpartyId: customerCounterparty.id, vatMode: 'VAT_EXCLUDED', subtotalAmount: '15000', taxableAmount: '15000', vatAmount: '1050', grandTotalAmount: '16050', paidAmount: '0', outstandingAmount: '16050', paymentStatus: 'UNPAID', issuedByUserId: ownerUserId, issuedAt: at(-2, 12, 30), updatedByUserId: ownerUserId },
    create: {
      id: 'seed-accounting-document-quotation', companyId, branchId, documentType: 'QUOTATION', documentNumber: 'QT-LOCAL-0001', status: 'ISSUED', documentDate: at(-2, 12), dueDate: at(12, 12),
      counterpartyId: customerCounterparty.id, counterpartySnapshotJson: { displayName: customerCounterparty.displayName, phone: customerCounterparty.phone }, vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '15000', taxableAmount: '15000', vatAmount: '1050', grandTotalAmount: '16050', paidAmount: '0', outstandingAmount: '16050', paymentStatus: 'UNPAID', issuedByUserId: ownerUserId, issuedAt: at(-2, 12, 30), createdByUserId: ownerUserId,
    },
  });

  // Real passive files for local preview paths. Upload before marking metadata ACTIVE so a
  // successful seed can never leave a dangling attachment row behind.
  const paymentProofBytes = buildSeedPaymentProofPng();
  const supportingPdfBytes = buildSeedSupportingPdf();
  const [paymentProofStored, expensePaymentStored, expenseSupportingStored] = await Promise.all([
    putSeedAttachmentObject({
      objectKey: `seed/${companyId}/crm/payment-proof-k8.png`,
      mimeType: 'image/png',
      bytes: paymentProofBytes,
    }),
    putSeedAttachmentObject({
      objectKey: `seed/${companyId}/expenses/team-meal-payment.png`,
      mimeType: 'image/png',
      bytes: paymentProofBytes,
    }),
    putSeedAttachmentObject({
      objectKey: `seed/${companyId}/expenses/team-meal-supporting.pdf`,
      mimeType: 'application/pdf',
      bytes: supportingPdfBytes,
    }),
  ]);

  // Payment proof awaiting finance verification (item 3 "หลักฐานโอนรอตรวจ" card).
  // CRM deliberately serves retained message media from AttachmentBlob, while AttachmentObject
  // also points at the real S3 object so generic signed-download paths exercise the same bytes.
  await upsertStoredSeedAttachment({
    db,
    id: 'seed-attachment-payment-proof',
    companyId,
    branchId,
    originalFileName: 'payment-proof-k8.png',
    mimeType: 'image/png',
    bytes: paymentProofBytes,
    stored: paymentProofStored,
    uploadedByUserId: ownerUserId,
    uploadedAt: at(0, 9),
    persistBlob: true,
  });
  await db.attachmentLink.upsert({
    where: { id: 'seed-attachment-link-payment-proof' },
    update: {
      attachmentId: 'seed-attachment-payment-proof',
      targetType: 'crm_conversation',
      targetId: 'seed-crm-conversation-c8',
      purpose: 'payment_proof',
      linkedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-attachment-link-payment-proof', companyId, attachmentId: 'seed-attachment-payment-proof',
      targetType: 'crm_conversation', targetId: 'seed-crm-conversation-c8', purpose: 'payment_proof', linkedByUserId: ownerUserId,
    },
  });
  const updatedPaymentProofMessage = await db.crmMessage.updateMany({
    where: { id: 'seed-crm-message-c8-5', companyId, conversationId: 'seed-crm-conversation-c8' },
    data: {
      attachmentId: 'seed-attachment-payment-proof',
      contentJson: { fileName: 'payment-proof-k8.png', seededPreviewFixture: true },
    },
  });
  if (updatedPaymentProofMessage.count !== 1) {
    throw new Error('Could not bind the seeded payment-proof attachment to CRM message c8-5.');
  }

  // Supporting-only evidence keeps EXP-LOCAL-0005 eligible for a substitute receipt while
  // giving the expense UI one real image and one real PDF to preview. It intentionally does not
  // set primaryAttachmentId or alter the expense review/payment/tax states.
  await upsertStoredSeedAttachment({
    db,
    id: 'seed-expense-attachment-team-meal-payment',
    companyId,
    branchId,
    originalFileName: 'team-meal-payment.png',
    mimeType: 'image/png',
    bytes: paymentProofBytes,
    stored: expensePaymentStored,
    uploadedByUserId: ownerUserId,
    uploadedAt: at(-3, 19, 5),
  });
  await upsertStoredSeedAttachment({
    db,
    id: 'seed-expense-attachment-team-meal-supporting',
    companyId,
    branchId,
    originalFileName: 'team-meal-supporting.pdf',
    mimeType: 'application/pdf',
    bytes: supportingPdfBytes,
    stored: expenseSupportingStored,
    uploadedByUserId: ownerUserId,
    uploadedAt: at(-3, 19, 6),
  });
  for (const link of [
    {
      id: 'seed-expense-attachment-link-team-meal-payment',
      attachmentId: 'seed-expense-attachment-team-meal-payment',
      purpose: 'expense.payment.evidence',
    },
    {
      id: 'seed-expense-attachment-link-team-meal-supporting',
      attachmentId: 'seed-expense-attachment-team-meal-supporting',
      purpose: 'expense.receipt.supporting',
    },
  ]) {
    await db.attachmentLink.upsert({
      where: { id: link.id },
      update: {
        attachmentId: link.attachmentId,
        targetType: 'expense.record',
        targetId: 'seed-expense-record-team-meal',
        purpose: link.purpose,
        linkedByUserId: ownerUserId,
      },
      create: {
        id: link.id,
        companyId,
        attachmentId: link.attachmentId,
        targetType: 'expense.record',
        targetId: 'seed-expense-record-team-meal',
        purpose: link.purpose,
        linkedByUserId: ownerUserId,
      },
    });
  }

  await db.accountingPayment.upsert({
    where: { id: 'seed-accounting-payment-received' },
    update: {
      branchId,
      paymentNumber: 'RCPT-LOCAL-0001',
      direction: 'RECEIVED',
      status: 'RECORDED',
      counterpartyId: customerCounterparty.id,
      method: 'BANK_TRANSFER',
      amount: '5000',
      allocatedAmount: '5000',
      paidAt: at(-2, 15),
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-accounting-payment-received',
      companyId,
      branchId,
      paymentNumber: 'RCPT-LOCAL-0001',
      direction: 'RECEIVED',
      status: 'RECORDED',
      counterpartyId: customerCounterparty.id,
      counterpartySnapshotJson: { displayName: customerCounterparty.displayName },
      method: 'BANK_TRANSFER',
      amount: '5000',
      allocatedAmount: '5000',
      paidAt: at(-2, 15),
      externalReference: 'KBANK-SEED-5000',
      createdByUserId: ownerUserId,
    },
  });
  await db.accountingPaymentAllocation.upsert({
    where: { id: 'seed-accounting-payment-allocation' },
    update: { amount: '5000' },
    create: {
      id: 'seed-accounting-payment-allocation',
      companyId,
      paymentId: 'seed-accounting-payment-received',
      documentId: 'seed-accounting-document-invoice',
      amount: '5000',
      createdByUserId: ownerUserId,
    },
  });

  const bankAccount = await db.bankAccount.upsert({
    where: { id: 'seed-bank-account-kbank' },
    update: {
      branchId,
      displayName: 'KBANK Operating 1234',
      bankName: 'Kasikornbank',
      accountType: 'BANK_SAVINGS',
      accountNumberMasked: 'xxx-x-x1234-x',
      accountNumberLast4: '1234',
      openingBalanceAmount: '80000',
      status: 'ACTIVE',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-bank-account-kbank',
      companyId,
      branchId,
      displayName: 'KBANK Operating 1234',
      bankName: 'Kasikornbank',
      bankCode: '004',
      accountType: 'BANK_SAVINGS',
      accountNumberMasked: 'xxx-x-x1234-x',
      accountNumberLast4: '1234',
      accountHolderName: 'WatchDog Local Company',
      openingBalanceAmount: '80000',
      openingBalanceDate: at(-30, 9),
      status: 'ACTIVE',
      createdByUserId: ownerUserId,
    },
  });
  await db.bankStatementImport.upsert({
    where: { id: 'seed-bank-import-july' },
    update: {
      bankAccountId: bankAccount.id,
      status: 'COMMITTED',
      lineCount: 3,
      committedAt: at(-1, 18),
      committedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-bank-import-july',
      companyId,
      bankAccountId: bankAccount.id,
      sourceType: 'IMPORT',
      originalFileName: 'kbank-local-july.csv',
      fileHash: 'seed-bank-import-july',
      status: 'COMMITTED',
      lineCount: 3,
      statementStartDate: at(-7, 0),
      statementEndDate: at(0, 23),
      committedAt: at(-1, 18),
      committedByUserId: ownerUserId,
      createdByUserId: ownerUserId,
    },
  });
  const statementLines = [
    { id: 'seed-bank-line-deposit', rowNumber: 1, hash: 'seed-bank-line-deposit', desc: 'รับโอนมัดจำ คุณปูน', counterparty: 'คุณปูน ศิริกัญญา', direction: 'DEPOSIT', signed: '1800', credit: '1800', debit: null, balance: '81800', status: 'SUGGESTED' },
    { id: 'seed-bank-line-expense', rowNumber: 2, hash: 'seed-bank-line-expense', desc: 'จ่าย Studio Supply', counterparty: 'Studio Supply', direction: 'WITHDRAWAL', signed: '-1979.50', credit: null, debit: '1979.50', balance: '79820.50', status: 'MATCHED' },
    { id: 'seed-bank-line-fee', rowNumber: 3, hash: 'seed-bank-line-fee', desc: 'ค่าธรรมเนียมธนาคาร', counterparty: 'Kasikornbank', direction: 'WITHDRAWAL', signed: '-25', credit: null, debit: '25', balance: '79795.50', status: 'UNMATCHED' },
  ] as const;
  for (const line of statementLines) {
    await db.bankStatementLine.upsert({
      where: { id: line.id },
      update: {
        bankAccountId: bankAccount.id,
        importId: 'seed-bank-import-july',
        rowNumber: line.rowNumber,
        lineHash: line.hash,
        postedDate: at(-line.rowNumber, 14),
        description: line.desc,
        counterpartyName: line.counterparty,
        direction: line.direction,
        signedAmount: line.signed,
        debitAmount: line.debit,
        creditAmount: line.credit,
        runningBalanceAmount: line.balance,
        status: line.status,
      },
      create: {
        id: line.id,
        companyId,
        bankAccountId: bankAccount.id,
        importId: 'seed-bank-import-july',
        sourceType: 'IMPORT',
        rowNumber: line.rowNumber,
        lineHash: line.hash,
        postedDate: at(-line.rowNumber, 14),
        description: line.desc,
        normalizedDescription: line.desc.toLowerCase(),
        counterpartyName: line.counterparty,
        bankReference: `SEED-${line.rowNumber}`,
        direction: line.direction,
        signedAmount: line.signed,
        debitAmount: line.debit,
        creditAmount: line.credit,
        runningBalanceAmount: line.balance,
        status: line.status,
        createdByUserId: ownerUserId,
      },
    });
  }
  await db.bankAdjustment.upsert({
    where: { id: 'seed-bank-adjustment-fee' },
    update: {
      bankAccountId: bankAccount.id,
      category: 'BANK_FEE',
      status: 'APPROVED',
      adjustmentDate: at(-1, 16),
      description: 'บันทึกค่าธรรมเนียมธนาคารจาก statement',
      signedAmount: '-25',
      approvedByUserId: ownerUserId,
      approvedAt: at(-1, 16, 30),
    },
    create: {
      id: 'seed-bank-adjustment-fee',
      companyId,
      bankAccountId: bankAccount.id,
      adjustmentNumber: 'BADJ-LOCAL-0001',
      category: 'BANK_FEE',
      status: 'APPROVED',
      adjustmentDate: at(-1, 16),
      description: 'บันทึกค่าธรรมเนียมธนาคารจาก statement',
      signedAmount: '-25',
      approvedByUserId: ownerUserId,
      approvedAt: at(-1, 16, 30),
      createdByUserId: ownerUserId,
    },
  });
  await db.bankReconciliationSession.upsert({
    where: { id: 'seed-bank-reconciliation-july' },
    update: {
      bankAccountId: bankAccount.id,
      sessionNumber: 'BREC-LOCAL-0001',
      periodStartDate: at(-7, 0),
      periodEndDate: at(0, 23),
      openingStatementBalanceAmount: '80000',
      closingStatementBalanceAmount: '79795.50',
      calculatedStatementMovementAmount: '-204.50',
      calculatedBookMovementAmount: '-204.50',
      calculatedBookBalanceAmount: '79795.50',
      differenceAmount: '0',
      status: 'IN_REVIEW',
    },
    create: {
      id: 'seed-bank-reconciliation-july',
      companyId,
      bankAccountId: bankAccount.id,
      sessionNumber: 'BREC-LOCAL-0001',
      periodStartDate: at(-7, 0),
      periodEndDate: at(0, 23),
      openingStatementBalanceAmount: '80000',
      closingStatementBalanceAmount: '79795.50',
      calculatedStatementMovementAmount: '-204.50',
      calculatedBookMovementAmount: '-204.50',
      calculatedBookBalanceAmount: '79795.50',
      differenceAmount: '0',
      status: 'IN_REVIEW',
      createdByUserId: ownerUserId,
    },
  });

  const vendorCounterparty = await db.accountingCounterparty.upsert({
    where: { id: 'seed-counterparty-vendor-beauty' },
    update: {
      type: 'VENDOR',
      displayName: 'บริษัท บิวตี้ ซัพพลาย จำกัด',
      legalName: 'บริษัท บิวตี้ ซัพพลาย จำกัด',
      taxId: '0105566070001',
      phone: '02-045-9900',
      status: 'ACTIVE',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-counterparty-vendor-beauty',
      companyId,
      type: 'VENDOR',
      displayName: 'บริษัท บิวตี้ ซัพพลาย จำกัด',
      legalName: 'บริษัท บิวตี้ ซัพพลาย จำกัด',
      taxId: '0105566070001',
      branchCode: '00000',
      phone: '02-045-9900',
      status: 'ACTIVE',
      createdByUserId: ownerUserId,
    },
  });
  const supplier = await db.supplierProfile.upsert({
    where: { id: 'seed-supplier-beauty-supply' },
    update: {
      counterpartyId: vendorCounterparty.id,
      supplierCode: 'SUP-LOCAL-001',
      displayNameSnapshot: vendorCounterparty.displayName,
      legalNameSnapshot: vendorCounterparty.legalName,
      taxId: vendorCounterparty.taxId,
      contactName: 'คุณฝ้าย',
      phone: '02-045-9900',
      email: 'sales@beauty-supply.local',
      status: 'ACTIVE',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-supplier-beauty-supply',
      companyId,
      counterpartyId: vendorCounterparty.id,
      supplierCode: 'SUP-LOCAL-001',
      supplierType: 'JURISTIC_PERSON',
      displayNameSnapshot: vendorCounterparty.displayName,
      legalNameSnapshot: vendorCounterparty.legalName,
      taxId: vendorCounterparty.taxId,
      branchCode: '00000',
      vatRegistered: true,
      defaultVatMode: 'VAT_EXCLUDED',
      defaultInputVatClaimStatus: 'CLAIMABLE',
      defaultPaymentTermsDays: 15,
      contactName: 'คุณฝ้าย',
      phone: '02-045-9900',
      email: 'sales@beauty-supply.local',
      status: 'ACTIVE',
      createdByUserId: ownerUserId,
    },
  });
  await db.supplierBankAccount.upsert({
    where: { id: 'seed-supplier-bank-beauty' },
    update: {
      supplierId: supplier.id,
      bankName: 'Kasikornbank',
      accountName: vendorCounterparty.displayName,
      accountNumberLast4: '7788',
      isDefault: true,
      status: 'ACTIVE',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-supplier-bank-beauty',
      companyId,
      supplierId: supplier.id,
      bankName: 'Kasikornbank',
      bankCode: '004',
      accountName: vendorCounterparty.displayName,
      accountNumberLast4: '7788',
      isDefault: true,
      status: 'ACTIVE',
      createdByUserId: ownerUserId,
    },
  });

  const supplierSnapshot = { id: supplier.id, displayName: supplier.displayNameSnapshot, taxId: supplier.taxId };
  await db.purchaseRequest.upsert({
    where: { id: 'seed-purchase-request-supplies' },
    update: {
      branchId,
      requestNumber: 'PR-LOCAL-0001',
      status: 'APPROVED',
      requesterUserId: ownerUserId,
      supplierId: supplier.id,
      reason: 'เติมสต็อกวัสดุต่อขนตา',
      subtotalAmount: '4800',
      taxableAmount: '4800',
      vatAmount: '336',
      grandTotalAmount: '5136',
      approvedByUserId: ownerUserId,
      approvedAt: at(-5, 14),
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-purchase-request-supplies',
      companyId,
      branchId,
      requestNumber: 'PR-LOCAL-0001',
      status: 'APPROVED',
      requesterUserId: ownerUserId,
      supplierId: supplier.id,
      supplierSnapshotJson: supplierSnapshot,
      neededByDate: at(2, 10),
      reason: 'เติมสต็อกวัสดุต่อขนตา',
      subtotalAmount: '4800',
      taxableAmount: '4800',
      vatAmount: '336',
      grandTotalAmount: '5136',
      submittedAt: at(-6, 10),
      approvedByUserId: ownerUserId,
      approvedAt: at(-5, 14),
      createdByUserId: ownerUserId,
    },
  });
  await db.purchaseRequestLine.upsert({
    where: { id: 'seed-purchase-request-line-supplies' },
    update: {
      productId,
      description: 'วัสดุต่อขนตา Premium',
      requestedQuantity: '12',
      estimatedUnitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '336',
      lineSubtotalAmount: '4800',
      lineTotalAmount: '5136',
      inventoryLocationId,
    },
    create: {
      id: 'seed-purchase-request-line-supplies',
      companyId,
      purchaseRequestId: 'seed-purchase-request-supplies',
      lineNumber: 1,
      lineType: 'STOCK',
      productId,
      skuSnapshot: 'DEMO-001',
      description: 'วัสดุต่อขนตา Premium',
      unitName: 'PCS',
      requestedQuantity: '12',
      estimatedUnitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '336',
      lineSubtotalAmount: '4800',
      lineTotalAmount: '5136',
      inventoryLocationId,
    },
  });
  await db.purchaseOrder.upsert({
    where: { id: 'seed-purchase-order-supplies' },
    update: {
      branchId,
      purchaseOrderNumber: 'PO-LOCAL-0001',
      status: 'PARTIALLY_RECEIVED',
      supplierId: supplier.id,
      sourcePurchaseRequestId: 'seed-purchase-request-supplies',
      orderDate: at(-4, 10),
      expectedDeliveryDate: at(1, 15),
      subtotalAmount: '4800',
      taxableAmount: '4800',
      vatAmount: '336',
      grandTotalAmount: '5136',
      receivedAmount: '2568',
      outstandingAmount: '2568',
      approvedByUserId: ownerUserId,
      approvedAt: at(-4, 11),
      issuedByUserId: ownerUserId,
      issuedAt: at(-4, 11, 30),
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-purchase-order-supplies',
      companyId,
      branchId,
      purchaseOrderNumber: 'PO-LOCAL-0001',
      status: 'PARTIALLY_RECEIVED',
      supplierId: supplier.id,
      supplierSnapshotJson: supplierSnapshot,
      sourcePurchaseRequestId: 'seed-purchase-request-supplies',
      orderDate: at(-4, 10),
      expectedDeliveryDate: at(1, 15),
      paymentTermsDays: 15,
      subtotalAmount: '4800',
      taxableAmount: '4800',
      vatAmount: '336',
      grandTotalAmount: '5136',
      receivedAmount: '2568',
      outstandingAmount: '2568',
      matchingMode: 'THREE_WAY_PO_RECEIPT_BILL',
      approvedByUserId: ownerUserId,
      approvedAt: at(-4, 11),
      issuedByUserId: ownerUserId,
      issuedAt: at(-4, 11, 30),
      createdByUserId: ownerUserId,
    },
  });
  await db.purchaseOrderLine.upsert({
    where: { id: 'seed-purchase-order-line-supplies' },
    update: {
      productId,
      description: 'วัสดุต่อขนตา Premium',
      orderedQuantity: '12',
      receivedQuantity: '6',
      unitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '336',
      lineSubtotalAmount: '4800',
      lineTotalAmount: '5136',
      inventoryLocationId,
    },
    create: {
      id: 'seed-purchase-order-line-supplies',
      companyId,
      purchaseOrderId: 'seed-purchase-order-supplies',
      sourcePurchaseRequestLineId: 'seed-purchase-request-line-supplies',
      lineNumber: 1,
      lineType: 'STOCK',
      productId,
      skuSnapshot: 'DEMO-001',
      description: 'วัสดุต่อขนตา Premium',
      unitName: 'PCS',
      orderedQuantity: '12',
      receivedQuantity: '6',
      unitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '336',
      lineSubtotalAmount: '4800',
      lineTotalAmount: '5136',
      inventoryLocationId,
    },
  });
  await db.goodsReceipt.upsert({
    where: { id: 'seed-goods-receipt-supplies' },
    update: {
      branchId,
      goodsReceiptNumber: 'GR-LOCAL-0001',
      status: 'POSTED',
      purchaseOrderId: 'seed-purchase-order-supplies',
      supplierId: supplier.id,
      receivedAt: at(-1, 13),
      receivedByUserId: ownerUserId,
      note: 'รับสินค้าเข้าคลังบางส่วนจาก PO local demo',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-goods-receipt-supplies',
      companyId,
      branchId,
      goodsReceiptNumber: 'GR-LOCAL-0001',
      status: 'POSTED',
      purchaseOrderId: 'seed-purchase-order-supplies',
      supplierId: supplier.id,
      supplierSnapshotJson: supplierSnapshot,
      receivedAt: at(-1, 13),
      receivedByUserId: ownerUserId,
      note: 'รับสินค้าเข้าคลังบางส่วนจาก PO local demo',
      createdByUserId: ownerUserId,
    },
  });
  await db.goodsReceiptLine.upsert({
    where: { id: 'seed-goods-receipt-line-supplies' },
    update: {
      purchaseOrderLineId: 'seed-purchase-order-line-supplies',
      productId,
      inventoryLocationId,
      orderedQuantity: '12',
      receivedQuantity: '6',
      acceptedQuantity: '6',
      description: 'วัสดุต่อขนตา Premium',
    },
    create: {
      id: 'seed-goods-receipt-line-supplies',
      companyId,
      goodsReceiptId: 'seed-goods-receipt-supplies',
      purchaseOrderLineId: 'seed-purchase-order-line-supplies',
      lineNumber: 1,
      lineType: 'STOCK',
      productId,
      description: 'วัสดุต่อขนตา Premium',
      inventoryLocationId,
      orderedQuantity: '12',
      receivedQuantity: '6',
      acceptedQuantity: '6',
      unitName: 'PCS',
    },
  });
  await db.vendorBill.upsert({
    where: { id: 'seed-vendor-bill-supplies' },
    update: {
      branchId,
      vendorBillNumber: 'VB-LOCAL-0001',
      supplierDocumentNumber: 'BS-202607-001',
      status: 'PARTIALLY_PAID',
      supplierId: supplier.id,
      purchaseOrderId: 'seed-purchase-order-supplies',
      goodsReceiptId: 'seed-goods-receipt-supplies',
      billDate: at(-1, 14),
      dueDate: at(14, 17),
      subtotalAmount: '2400',
      taxableAmount: '2400',
      vatAmount: '168',
      grandTotalAmount: '2568',
      netPayableAmount: '2568',
      paidAmount: '1200',
      outstandingAmount: '1368',
      matchingStatus: 'MATCHED',
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-vendor-bill-supplies',
      companyId,
      branchId,
      vendorBillNumber: 'VB-LOCAL-0001',
      supplierDocumentNumber: 'BS-202607-001',
      status: 'PARTIALLY_PAID',
      supplierId: supplier.id,
      supplierSnapshotJson: supplierSnapshot,
      purchaseOrderId: 'seed-purchase-order-supplies',
      goodsReceiptId: 'seed-goods-receipt-supplies',
      billDate: at(-1, 14),
      receivedDate: at(-1, 14),
      dueDate: at(14, 17),
      paymentTermsDays: 15,
      vatMode: 'VAT_EXCLUDED',
      subtotalAmount: '2400',
      taxableAmount: '2400',
      vatAmount: '168',
      inputVatClaimStatus: 'CLAIMABLE',
      grandTotalAmount: '2568',
      netPayableAmount: '2568',
      paidAmount: '1200',
      outstandingAmount: '1368',
      matchingMode: 'THREE_WAY_PO_RECEIPT_BILL',
      matchingStatus: 'MATCHED',
      approvedByUserId: ownerUserId,
      approvedAt: at(0, 10),
      createdByUserId: ownerUserId,
    },
  });
  await db.vendorBillLine.upsert({
    where: { id: 'seed-vendor-bill-line-supplies' },
    update: {
      purchaseOrderLineId: 'seed-purchase-order-line-supplies',
      goodsReceiptLineId: 'seed-goods-receipt-line-supplies',
      productId,
      description: 'วัสดุต่อขนตา Premium',
      quantity: '6',
      unitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '168',
      lineSubtotalAmount: '2400',
      lineTotalAmount: '2568',
      inputVatClaimStatus: 'CLAIMABLE',
    },
    create: {
      id: 'seed-vendor-bill-line-supplies',
      companyId,
      vendorBillId: 'seed-vendor-bill-supplies',
      purchaseOrderLineId: 'seed-purchase-order-line-supplies',
      goodsReceiptLineId: 'seed-goods-receipt-line-supplies',
      lineNumber: 1,
      lineType: 'STOCK',
      productId,
      skuSnapshot: 'DEMO-001',
      description: 'วัสดุต่อขนตา Premium',
      unitName: 'PCS',
      quantity: '6',
      unitPrice: '400',
      vatMode: 'VAT_EXCLUDED',
      vatRate: '0.07',
      vatAmount: '168',
      inputVatClaimStatus: 'CLAIMABLE',
      lineSubtotalAmount: '2400',
      lineTotalAmount: '2568',
    },
  });
  await db.supplierPayment.upsert({
    where: { id: 'seed-supplier-payment-supplies' },
    update: {
      branchId,
      paymentNumber: 'PAY-LOCAL-0001',
      status: 'RECORDED',
      supplierId: supplier.id,
      paymentDate: at(0, 11),
      method: 'BANK_TRANSFER',
      grossAmount: '1200',
      netPaidAmount: '1200',
      allocatedAmount: '1200',
      bankAccountRef: bankAccount.displayName,
      supplierBankAccountId: 'seed-supplier-bank-beauty',
      recordedByUserId: ownerUserId,
      recordedAt: at(0, 11, 30),
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-supplier-payment-supplies',
      companyId,
      branchId,
      paymentNumber: 'PAY-LOCAL-0001',
      status: 'RECORDED',
      supplierId: supplier.id,
      supplierSnapshotJson: supplierSnapshot,
      paymentDate: at(0, 11),
      method: 'BANK_TRANSFER',
      grossAmount: '1200',
      netPaidAmount: '1200',
      allocatedAmount: '1200',
      bankAccountRef: bankAccount.displayName,
      supplierBankAccountId: 'seed-supplier-bank-beauty',
      externalReference: 'KBANK-PAY-SUP-001',
      recordedByUserId: ownerUserId,
      recordedAt: at(0, 11, 30),
      createdByUserId: ownerUserId,
    },
  });
  await db.supplierPaymentAllocation.upsert({
    where: { id: 'seed-supplier-payment-allocation' },
    update: { amount: '1200' },
    create: {
      id: 'seed-supplier-payment-allocation',
      companyId,
      supplierPaymentId: 'seed-supplier-payment-supplies',
      vendorBillId: 'seed-vendor-bill-supplies',
      amount: '1200',
      createdByUserId: ownerUserId,
    },
  });

  // A draft its requester has not sent yet: sending it from the claim page writes its step, route, policy snapshot and
  // hash for real. It used to be seeded as waiting for approval without them, so nobody could approve or withdraw it
  // while the page read "รอ Local Owner อนุมัติ". A claim already in the database is left as it is (whoever tries the
  // demo may have sent, approved or paid it since), apart from that stuck state below.
  await db.reimbursementRequest.upsert({
    where: { id: 'seed-reimbursement-request-travel' },
    update: {},
    create: {
      id: 'seed-reimbursement-request-travel',
      companyId,
      branchId,
      requesterUserId: ownerUserId,
      requesterDisplayNameSnapshot: 'Local Owner',
      title: 'ค่าเดินทางพบลูกค้า VIP',
      reason: 'เดินทางไปตรวจงานและรับ brief ลูกค้า VIP',
      categoryKey: 'travel',
      categoryLabelSnapshot: 'ค่าเดินทาง',
      amount: '650',
      incurredDate: at(-2, 8),
      status: 'DRAFT',
      paymentStatus: 'NOT_PAYABLE',
      financeReviewStatus: 'NOT_REQUIRED',
      duplicateStatus: 'NOT_CHECKED',
      receiptRequirementStatus: 'REQUIRED',
      outstandingAmount: '650',
      idempotencyKey: 'seed-reimbursement-request-travel',
      createdByUserId: ownerUserId,
    },
  });
  // Every claim owns at least one line (the header total is their rollup).
  await db.reimbursementLine.upsert({
    where: { reimbursementRequestId_lineNo: { reimbursementRequestId: 'seed-reimbursement-request-travel', lineNo: 1 } },
    update: {},
    create: {
      companyId,
      reimbursementRequestId: 'seed-reimbursement-request-travel',
      lineNo: 1,
      incurredDate: at(-2, 8),
      description: 'ค่าเดินทางพบลูกค้า VIP',
      categoryKey: 'travel',
      categoryLabelSnapshot: 'ค่าเดินทาง',
      amount: '650',
    },
  });
  // A database seeded before holds the sample stuck: waiting for approval with no current step. Only while it is still
  // so, it becomes the draft a fresh database gets, without the step written then or a signature given on it since.
  const stuckSample = await db.reimbursementRequest.updateMany({
    where: { id: 'seed-reimbursement-request-travel', status: 'PENDING_APPROVAL', currentApprovalStepId: null },
    data: {
      requestNo: null, submittedAt: null, submittedByUserId: null, currentApproverUserId: null, approvalSnapshotHash: null,
      status: 'DRAFT', paymentStatus: 'NOT_PAYABLE', financeReviewStatus: 'NOT_REQUIRED', duplicateStatus: 'NOT_CHECKED',
      updatedByUserId: ownerUserId,
    },
  });
  if (stuckSample.count > 0) {
    await db.reimbursementClaimSignature.deleteMany({ where: { reimbursementRequestId: 'seed-reimbursement-request-travel' } });
    await db.reimbursementApprovalStep.deleteMany({ where: { reimbursementRequestId: 'seed-reimbursement-request-travel' } });
  }

  const workflowTemplate = await db.workflowTemplate.findUnique({ where: { key: 'low_stock_alert' } });
  await db.workflowRule.upsert({
    where: { id: 'seed-workflow-rule-low-stock' },
    update: {
      templateId: workflowTemplate?.id ?? null,
      name: 'แจ้งเตือนสินค้าใกล้หมด',
      status: 'ENABLED',
      triggerType: 'THRESHOLD_SCAN',
      conditionJson: { field: 'balance', op: 'LTE', value: 20 },
      actionJson: [{ actionKey: 'create_reorder_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { priority: 'HIGH' } }],
      enabledByUserId: ownerUserId,
      enabledAt: at(-1, 9),
      currentVersion: 1,
      updatedByUserId: ownerUserId,
    },
    create: {
      id: 'seed-workflow-rule-low-stock',
      companyId,
      templateId: workflowTemplate?.id ?? null,
      name: 'แจ้งเตือนสินค้าใกล้หมด',
      description: 'สร้าง task ให้ทีมคลังเมื่อสินค้าต่ำกว่า reorder point',
      status: 'ENABLED',
      triggerType: 'THRESHOLD_SCAN',
      triggerConfigJson: { scan: 'inventory.low_stock' },
      conditionJson: { field: 'balance', op: 'LTE', value: 20 },
      actionJson: [{ actionKey: 'create_reorder_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { priority: 'HIGH' } }],
      recipientConfigJson: { roles: ['OWNER', 'INVENTORY'] },
      cooldownSeconds: 3600,
      createdByUserId: ownerUserId,
      enabledByUserId: ownerUserId,
      enabledAt: at(-1, 9),
      currentVersion: 1,
    },
  });
  await db.workflowRuleVersion.upsert({
    where: { id: 'seed-workflow-version-low-stock-v1' },
    update: {
      ruleId: 'seed-workflow-rule-low-stock',
      status: 'ENABLED',
      triggerSnapshotJson: { scan: 'inventory.low_stock' },
      conditionSnapshotJson: { field: 'balance', op: 'LTE', value: 20 },
      actionSnapshotJson: [{ actionKey: 'create_reorder_task', actionType: 'CREATE_WORKFLOW_TASK' }],
      recipientSnapshotJson: { roles: ['OWNER', 'INVENTORY'] },
    },
    create: {
      id: 'seed-workflow-version-low-stock-v1',
      ruleId: 'seed-workflow-rule-low-stock',
      companyId,
      version: 1,
      status: 'ENABLED',
      triggerSnapshotJson: { scan: 'inventory.low_stock' },
      conditionSnapshotJson: { field: 'balance', op: 'LTE', value: 20 },
      actionSnapshotJson: [{ actionKey: 'create_reorder_task', actionType: 'CREATE_WORKFLOW_TASK' }],
      recipientSnapshotJson: { roles: ['OWNER', 'INVENTORY'] },
      cooldownSeconds: 3600,
      createdByUserId: ownerUserId,
    },
  });
  await db.workflowRun.upsert({
    where: { id: 'seed-workflow-run-low-stock' },
    update: {
      ruleId: 'seed-workflow-rule-low-stock',
      ruleVersionId: 'seed-workflow-version-low-stock-v1',
      status: 'SUCCEEDED',
      sourceModule: 'inventory',
      sourceType: 'product',
      sourceId: productId,
      conditionResultJson: { matched: true, balance: 15 },
      startedAt: at(0, 8),
      finishedAt: at(0, 8, 1),
    },
    create: {
      id: 'seed-workflow-run-low-stock',
      companyId,
      ruleId: 'seed-workflow-rule-low-stock',
      ruleVersionId: 'seed-workflow-version-low-stock-v1',
      triggerType: 'THRESHOLD_SCAN',
      sourceModule: 'inventory',
      sourceType: 'product',
      sourceId: productId,
      dedupKey: 'seed-workflow-run-low-stock',
      triggerPayloadJson: { productId, balance: 15 },
      conditionResultJson: { matched: true, balance: 15 },
      status: 'SUCCEEDED',
      startedAt: at(0, 8),
      finishedAt: at(0, 8, 1),
    },
  });
  await db.workflowActionRun.upsert({
    where: { id: 'seed-workflow-action-low-stock' },
    update: {
      workflowRunId: 'seed-workflow-run-low-stock',
      status: 'SUCCEEDED',
      targetType: 'workflow_task',
      targetId: 'seed-workflow-task-low-stock',
      resultJson: { createdTaskId: 'seed-workflow-task-low-stock' },
      finishedAt: at(0, 8, 2),
    },
    create: {
      id: 'seed-workflow-action-low-stock',
      companyId,
      workflowRunId: 'seed-workflow-run-low-stock',
      actionKey: 'create_reorder_task',
      actionType: 'CREATE_WORKFLOW_TASK',
      actionConfigSnapshotJson: { priority: 'HIGH' },
      status: 'SUCCEEDED',
      idempotencyKey: 'seed-workflow-action-low-stock',
      targetType: 'workflow_task',
      targetId: 'seed-workflow-task-low-stock',
      resultJson: { createdTaskId: 'seed-workflow-task-low-stock' },
      startedAt: at(0, 8, 1),
      finishedAt: at(0, 8, 2),
    },
  });
  await db.workflowTask.upsert({
    where: { id: 'seed-workflow-task-low-stock' },
    update: {
      workflowRunId: 'seed-workflow-run-low-stock',
      workflowActionRunId: 'seed-workflow-action-low-stock',
      title: 'ตรวจสต็อก Demo Product ต่ำกว่า reorder point',
      description: 'สร้างจาก workflow seed เพื่อทดสอบเมนู Workflow Tasks',
      assigneeUserId: ownerUserId,
      priority: 'HIGH',
      status: 'OPEN',
      dueAt: at(1, 18),
      webDeepLink: `/companies/${companyId}/inventory/products/${productId}`,
    },
    create: {
      id: 'seed-workflow-task-low-stock',
      companyId,
      workflowRunId: 'seed-workflow-run-low-stock',
      workflowActionRunId: 'seed-workflow-action-low-stock',
      sourceModule: 'inventory',
      sourceType: 'product',
      sourceId: productId,
      title: 'ตรวจสต็อก Demo Product ต่ำกว่า reorder point',
      description: 'สร้างจาก workflow seed เพื่อทดสอบเมนู Workflow Tasks',
      assigneeUserId: ownerUserId,
      assigneeRole: 'INVENTORY',
      priority: 'HIGH',
      status: 'OPEN',
      dueAt: at(1, 18),
      webDeepLink: `/companies/${companyId}/inventory/products/${productId}`,
    },
  });
  await db.workflowWebhookEndpoint.upsert({
    where: { id: 'seed-workflow-webhook-demo' },
    update: {
      name: 'Local CRM webhook',
      url: 'http://localhost:3001/v1/webhooks/local-demo',
      status: 'ENABLED',
      allowedEventTypes: ['crm.customer.created', 'inventory.low_stock'],
    },
    create: {
      id: 'seed-workflow-webhook-demo',
      companyId,
      name: 'Local CRM webhook',
      url: 'http://localhost:3001/v1/webhooks/local-demo',
      status: 'ENABLED',
      allowedEventTypes: ['crm.customer.created', 'inventory.low_stock'],
      secretRef: 'local-demo-secret',
      createdByUserId: ownerUserId,
    },
  });

  await db.aiDraftRequest.upsert({
    where: { id: 'seed-ai-draft-request-follow-up' },
    update: {
      requesterUserId: ownerUserId,
      origin: 'WEB',
      agent: 'CRM',
      templateKey: 'crm_follow_up_next_best_action',
      sourceModule: 'crm',
      sourceRecordType: 'customer',
      sourceRecordId: 'seed-crm-customer-k11',
      status: 'READY',
      updatedAt: at(0, 9),
    },
    create: {
      id: 'seed-ai-draft-request-follow-up',
      companyId,
      requesterUserId: ownerUserId,
      origin: 'WEB',
      agent: 'CRM',
      templateKey: 'crm_follow_up_next_best_action',
      sourceModule: 'crm',
      sourceRecordType: 'customer',
      sourceRecordId: 'seed-crm-customer-k11',
      sourceRefsJson: { customerId: 'seed-crm-customer-k11' },
      requestedPromptPreview: 'แนะนำวิธีดูแลลูกค้าที่แจ้งปัญหาขนตาหลุดเร็ว',
      requestedPromptHash: 'seed-ai-follow-up',
      status: 'READY',
      idempotencyKey: 'seed-ai-draft-request-follow-up',
    },
  });
  await db.aiSuggestion.upsert({
    where: { id: 'seed-ai-suggestion-follow-up' },
    update: {
      draftRequestId: 'seed-ai-draft-request-follow-up',
      title: 'ดูแลลูกค้าเสี่ยงเสียความพึงพอใจ',
      summary: 'ลูกค้าแจ้งว่าขนตาหลุดเร็วหลังทำบริการ ควรตอบกลับด้วยโทนขอโทษและนัดตรวจฟรี',
      recommendation: 'ส่งข้อความขอโทษ เสนอเข้าร้านเพื่อตรวจฟรี และให้ส่วนลด aftercare ครั้งถัดไป',
      riskLevel: 'HIGH',
      confidence: 86,
      status: 'NEW',
      reviewOwnerUserId: ownerUserId,
    },
    create: {
      id: 'seed-ai-suggestion-follow-up',
      companyId,
      draftRequestId: 'seed-ai-draft-request-follow-up',
      templateKey: 'crm_follow_up_next_best_action',
      agent: 'CRM',
      domain: 'SALES_CRM',
      title: 'ดูแลลูกค้าเสี่ยงเสียความพึงพอใจ',
      summary: 'ลูกค้าแจ้งว่าขนตาหลุดเร็วหลังทำบริการ ควรตอบกลับด้วยโทนขอโทษและนัดตรวจฟรี',
      recommendation: 'ส่งข้อความขอโทษ เสนอเข้าร้านเพื่อตรวจฟรี และให้ส่วนลด aftercare ครั้งถัดไป',
      riskLevel: 'HIGH',
      confidence: 86,
      status: 'NEW',
      sourceModule: 'crm',
      sourceRecordType: 'customer',
      sourceRecordId: 'seed-crm-customer-k11',
      candidateActionCount: 1,
      reviewOwnerUserId: ownerUserId,
      assignedRole: 'MANAGER',
    },
  });
  await db.aiDraftArtifact.upsert({
    where: { id: 'seed-ai-artifact-follow-up' },
    update: {
      suggestionId: 'seed-ai-suggestion-follow-up',
      artifactType: 'TEXT',
      contentPreview: 'สวัสดีค่ะคุณโบว์ ขอโทษที่ขนตาหลุดเร็วกว่าที่ควรนะคะ ทางร้านขอนัดเข้ามาตรวจและแก้ไขให้ฟรีค่ะ',
      status: 'DRAFT',
    },
    create: {
      id: 'seed-ai-artifact-follow-up',
      suggestionId: 'seed-ai-suggestion-follow-up',
      companyId,
      version: 1,
      artifactType: 'TEXT',
      contentPreview: 'สวัสดีค่ะคุณโบว์ ขอโทษที่ขนตาหลุดเร็วกว่าที่ควรนะคะ ทางร้านขอนัดเข้ามาตรวจและแก้ไขให้ฟรีค่ะ',
      contentHash: 'seed-ai-artifact-follow-up',
      structuredContentJson: { channel: 'line', tone: 'apologetic', offer: 'free_check' },
      status: 'DRAFT',
      modelProvider: 'seed',
      modelName: 'local-demo',
    },
  });
  await db.aiSuggestionCitation.upsert({
    where: { id: 'seed-ai-citation-follow-up' },
    update: {
      suggestionId: 'seed-ai-suggestion-follow-up',
      sourceModule: 'crm',
      sourceRecordType: 'conversation',
      sourceRecordId: 'seed-crm-conversation-c11',
      label: 'ข้อความล่าสุดจากลูกค้า',
      valuePreview: 'ขนตาหลุดเร็วมากทำไงดีคะ',
      webDeepLink: `/companies/${companyId}/inbox`,
    },
    create: {
      id: 'seed-ai-citation-follow-up',
      suggestionId: 'seed-ai-suggestion-follow-up',
      companyId,
      sourceModule: 'crm',
      sourceRecordType: 'conversation',
      sourceRecordId: 'seed-crm-conversation-c11',
      sourceField: 'lastMessage',
      label: 'ข้อความล่าสุดจากลูกค้า',
      valuePreview: 'ขนตาหลุดเร็วมากทำไงดีคะ',
      valueHash: 'seed-ai-citation-follow-up',
      webDeepLink: `/companies/${companyId}/inbox`,
    },
  });
  await db.aiCandidateAction.upsert({
    where: { id: 'seed-ai-action-follow-up' },
    update: {
      suggestionId: 'seed-ai-suggestion-follow-up',
      artifactId: 'seed-ai-artifact-follow-up',
      actionType: 'CREATE_CRM_FOLLOW_UP_DRAFT',
      targetModule: 'crm',
      targetRecordType: 'customer',
      targetRecordId: 'seed-crm-customer-k11',
      draftPayloadJson: { title: 'นัดตรวจหลังการขาย', dueInDays: 0 },
      status: 'PROPOSED',
    },
    create: {
      id: 'seed-ai-action-follow-up',
      suggestionId: 'seed-ai-suggestion-follow-up',
      artifactId: 'seed-ai-artifact-follow-up',
      companyId,
      actionType: 'CREATE_CRM_FOLLOW_UP_DRAFT',
      targetModule: 'crm',
      targetRecordType: 'customer',
      targetRecordId: 'seed-crm-customer-k11',
      draftPayloadJson: { title: 'นัดตรวจหลังการขาย', dueInDays: 0 },
      payloadHash: 'seed-ai-action-follow-up',
      requiredPermissions: ['crm.follow_up.create'],
      riskLevel: 'MEDIUM',
      idempotencyKey: 'seed-ai-action-follow-up',
      status: 'PROPOSED',
    },
  });

  // Derive the periods and VAT/WHT events from the same source adapters as the workspace.
  // A synthetic header-only VAT event used to bypass source identity and correction retirement.
  const service = { client: prisma } as PrismaService;
  await new SyncTaxEventsUseCase(new PrismaTaxRepository(service), new AccountingDocumentSourceAdapter(service),
    new ExpenseSourceAdapter(service), new SupplierPaymentSourceAdapter(service)).execute(companyId);

}

async function main() {
  // Local/dev bootstrap only — it creates the demo company/owner/DEV identity.
  // Production bootstraps via prisma/reset-system-admin-password.ts (system tenant
  // + protected admin only), wired in start-production.sh. Refuse outright
  // so a mistyped manual run can never write demo rows into a production database.
  if (process.env['APP_ENV'] === 'production') {
    throw new Error('seed.ts is local/dev only. Production bootstrap uses prisma/reset-system-admin-password.ts.');
  }

  // Permissions, system roles and their grants come from the same reconciler production boots
  // with. Seeding used to keep its own additive copy that upserted grants but never revoked ones
  // dropped from the registry, so a database that had only ever been seeded silently kept
  // permissions the code had removed — ADMIN still held access.role.manage months after the
  // decision that a default ADMIN cannot hand out permissions.
  await syncPermissions(prisma);

  // Permanent platform tenant and super user. This membership never grants access
  // to customer-company data; it only carries the SYSTEM_ADMIN permission set.
  const systemCompany = await prisma.company.upsert({
    where: { id: SYSTEM_COMPANY.id },
    update: { name: SYSTEM_COMPANY.name },
    create: { id: SYSTEM_COMPANY.id, name: SYSTEM_COMPANY.name },
  });

  const systemAdmin = await prisma.user.upsert({
    where: { username: SYSTEM_ADMIN_USERNAME },
    update: {
      displayName: 'ผู้ดูแลระบบมั่งมีพลัส',
      status: 'ACTIVE',
      isSystemProtected: true,
    },
    create: {
      id: SEED_SYSTEM_ADMIN_ID,
      username: SYSTEM_ADMIN_USERNAME,
      displayName: 'ผู้ดูแลระบบมั่งมีพลัส',
      status: 'ACTIVE',
      isSystemProtected: true,
    },
  });

  // Do not overwrite passwordHash on repeated seed runs: password change remains valid.
  await prisma.userCredential.upsert({
    where: { userId: systemAdmin.id },
    update: { status: 'ACTIVE', mustChangePassword: false, expiresAt: null },
    create: {
      userId: systemAdmin.id,
      passwordHash: hashPassword(SYSTEM_ADMIN_PASSWORD),
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });

  const systemMembership = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: systemCompany.id, userId: systemAdmin.id } },
    update: { status: 'ACTIVE' },
    create: { companyId: systemCompany.id, userId: systemAdmin.id, status: 'ACTIVE' },
  });

  const systemAdminRole = await prisma.role.findUniqueOrThrow({
    where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: systemMembership.id, roleId: systemAdminRole.id } },
    update: {},
    create: { membershipId: systemMembership.id, roleId: systemAdminRole.id },
  });

  // ── QA sales-team accounts (Phase 2 sales console) ──────────────────────────────────
  // Platform-tenant memberships, NOT tenant employees, so they stay out of QA_ROLE_ACCOUNTS:
  // a sales agent has no EmployeeAccessProfile and no HR record anywhere (S09). The web e2e
  // signs in as exactly these two, so `mustChangePassword` is false for both — the forced
  // first-login change is exercised by the console's own create-agent flow instead.
  for (const agent of SEED_SALES_AGENTS) {
    const user = await prisma.user.upsert({
      where: { username: agent.username },
      update: { displayName: agent.displayName, status: 'ACTIVE' },
      create: { id: agent.id, username: agent.username, displayName: agent.displayName, status: 'ACTIVE' },
    });
    // Same rule as the system admin above: never overwrite a password a QA run has changed.
    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: { status: 'ACTIVE', mustChangePassword: false, expiresAt: null },
      create: { userId: user.id, passwordHash: hashPassword(agent.password), status: 'ACTIVE', mustChangePassword: false },
    });
    const membership = await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId: systemCompany.id, userId: user.id } },
      update: { status: 'ACTIVE' },
      create: { companyId: systemCompany.id, userId: user.id, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: agent.role } } });
    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      update: {},
      create: { membershipId: membership.id, roleId: role.id },
    });
    // Dummy PII, encrypted exactly as the console encrypts it, so a local run exercises the
    // decrypt path and the CSV export without inventing a second storage shape.
    await prisma.salesAgentProfile.upsert({
      where: { userId: user.id },
      update: { salesCode: agent.salesCode, status: 'ACTIVE', teamLeadUserId: agent.teamLeadUserId ?? null },
      create: {
        userId: user.id,
        teamLeadUserId: agent.teamLeadUserId ?? null,
        salesCode: agent.salesCode,
        legalName: agent.displayName,
        nationalIdEncrypted: seedEncrypt('1103700000001'),
        taxIdEncrypted: null,
        address: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110',
        bankName: 'กสิกรไทย',
        bankAccountEncrypted: seedEncrypt('1234567890'),
        whtRatePercent: 3,
        status: 'ACTIVE',
        createdByUserId: systemAdmin.id,
      },
    });
  }

  // Default local company
  const company = await prisma.company.upsert({
    where: { id: DEFAULT_COMPANY.id },
    update: { name: DEFAULT_COMPANY.name },
    create: { id: DEFAULT_COMPANY.id, name: DEFAULT_COMPANY.name },
  });

  const messagingChannelId = process.env['LINE_MESSAGING_CHANNEL_ID'];
  if (messagingChannelId) {
    await prisma.lineChannelBinding.upsert({
      where: { companyId_messagingChannelId: { companyId: company.id, messagingChannelId } },
      update: {
        lineOfficialAccountId: messagingChannelId,
        liffChannelId: process.env['LINE_LIFF_ID'] || null,
        status: 'ACTIVE',
      },
      create: {
        companyId: company.id,
        lineOfficialAccountId: messagingChannelId,
        messagingChannelId,
        liffChannelId: process.env['LINE_LIFF_ID'] || null,
        status: 'ACTIVE',
      },
    });
  }

  // Default local owner user
  const owner = await prisma.user.upsert({
    where: { email: DEFAULT_OWNER.email },
    update: { username: DEFAULT_OWNER.username, displayName: DEFAULT_OWNER.displayName, status: 'ACTIVE' },
    create: { id: DEFAULT_OWNER.id, username: DEFAULT_OWNER.username, displayName: DEFAULT_OWNER.displayName, email: DEFAULT_OWNER.email, status: 'ACTIVE' },
  });

  await prisma.userCredential.upsert({
    where: { userId: owner.id },
    update: {
      passwordHash: hashPassword(DEFAULT_OWNER.password),
      status: 'ACTIVE',
      mustChangePassword: false,
      expiresAt: null,
    },
    create: {
      userId: owner.id,
      passwordHash: hashPassword(DEFAULT_OWNER.password),
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });

  // DEV external identity for local owner
  await prisma.externalIdentity.upsert({
    where: { provider_providerChannelId_providerUserId: { provider: 'DEV', providerChannelId: DEV_CHANNEL_ID, providerUserId: DEV_PROVIDER_USER_ID } },
    update: { userId: owner.id },
    create: { provider: 'DEV', providerChannelId: DEV_CHANNEL_ID, providerUserId: DEV_PROVIDER_USER_ID, userId: owner.id },
  });

  // Company membership
  const membership = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    update: {},
    create: { companyId: company.id, userId: owner.id },
  });

  // Assign OWNER role to membership
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'OWNER' } } });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId: ownerRole.id } },
    update: {},
    create: { membershipId: membership.id, roleId: ownerRole.id },
  });

  // Company-view demo account used by the มั่งมี design handoff and local Docker
  // smoke path. Keep this password repairable on repeated seed runs so the
  // documented credential always works in fresh or reused local volumes.
  const companyViewUser = await prisma.user.upsert({
    where: { username: COMPANY_VIEW_USER.username },
    update: {
      displayName: COMPANY_VIEW_USER.displayName,
      email: COMPANY_VIEW_USER.email,
      status: 'ACTIVE',
    },
    create: {
      id: COMPANY_VIEW_USER.id,
      username: COMPANY_VIEW_USER.username,
      displayName: COMPANY_VIEW_USER.displayName,
      email: COMPANY_VIEW_USER.email,
      status: 'ACTIVE',
    },
  });

  await prisma.userCredential.upsert({
    where: { userId: companyViewUser.id },
    update: {
      passwordHash: hashPassword(COMPANY_VIEW_USER.password),
      status: 'ACTIVE',
      mustChangePassword: false,
      expiresAt: null,
    },
    create: {
      userId: companyViewUser.id,
      passwordHash: hashPassword(COMPANY_VIEW_USER.password),
      status: 'ACTIVE',
      mustChangePassword: false,
    },
  });

  const companyViewMembership = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: companyViewUser.id } },
    update: { status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null },
    create: { companyId: company.id, userId: companyViewUser.id, status: 'ACTIVE' },
  });

  const companyViewRole = await prisma.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'COMPANY_VIEW' } } });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: companyViewMembership.id, roleId: companyViewRole.id } },
    update: {},
    create: { membershipId: companyViewMembership.id, roleId: companyViewRole.id },
  });

  // Head office branch
  const SEED_BRANCH_ID = 'seed-local-branch-ho';
  const branch = await prisma.branch.upsert({
    where: { id: SEED_BRANCH_ID },
    update: { name: 'Head Office', type: 'HEAD_OFFICE', taxBranchCode: '00000', isVatEstablishment: true, status: 'ACTIVE' },
    create: {
      id: SEED_BRANCH_ID,
      companyId: company.id,
      code: 'HO',
      name: 'Head Office',
      type: 'HEAD_OFFICE',
      taxBranchCode: '00000',
      isVatEstablishment: true,
      status: 'ACTIVE',
      createdByUserId: owner.id,
    },
  });

  await seedQaRoleAccounts(company.id, branch.id, owner.id);
  await seedRoom45DemoWorkspace(company.id, owner.id, branch.id);

  // Second company (item 1): its own head office + branches + CRM demo, with owner
  // and company-view memberships so the header company switcher lists two companies.
  const company2 = await prisma.company.upsert({
    where: { id: SECOND_COMPANY.id },
    update: { name: SECOND_COMPANY.name },
    create: { id: SECOND_COMPANY.id, name: SECOND_COMPANY.name },
  });
  const branch2 = await prisma.branch.upsert({
    where: { id: 'seed-bloom-branch-ho' },
    update: { name: 'Bloom Clinic · สำนักงานใหญ่', type: 'HEAD_OFFICE', taxBranchCode: '00000', isVatEstablishment: true, status: 'ACTIVE' },
    create: { id: 'seed-bloom-branch-ho', companyId: company2.id, code: 'BLM-HO', name: 'Bloom Clinic · สำนักงานใหญ่', type: 'HEAD_OFFICE', taxBranchCode: '00000', isVatEstablishment: true, status: 'ACTIVE', createdByUserId: owner.id },
  });
  const ownerMembership2 = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company2.id, userId: owner.id } },
    update: { status: 'ACTIVE' },
    create: { companyId: company2.id, userId: owner.id, status: 'ACTIVE' },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: ownerMembership2.id, roleId: ownerRole.id } },
    update: {},
    create: { membershipId: ownerMembership2.id, roleId: ownerRole.id },
  });
  const companyView2 = await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company2.id, userId: companyViewUser.id } },
    update: { status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null },
    create: { companyId: company2.id, userId: companyViewUser.id, status: 'ACTIVE' },
  });
  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: companyView2.id, roleId: companyViewRole.id } },
    update: {},
    create: { membershipId: companyView2.id, roleId: companyViewRole.id },
  });
  await seedBloomDemoWorkspace(company2.id, owner.id, branch2.id);

  // "แสดงเมนูบันทึกด้วยมือบนเว็บ": a company without a row reads as NOT shown
  // (MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW), and the demo and e2e journeys open that page — so both
  // demo companies are switched on here, in the seed, instead of in each test. Re-seeding restores
  // the value; the setting's version is left alone.
  for (const tenantCompany of [company, company2]) {
    await prisma.companyWebEntrySetting.upsert({
      where: { companyId: tenantCompany.id },
      update: { manualExpenseEntryEnabled: true, disbursementVoucherEntryEnabled: true },
      create: { companyId: tenantCompany.id, manualExpenseEntryEnabled: true, disbursementVoucherEntryEnabled: true },
    });
  }

  // Default document sequences (monthly reset, padding 5)
  const DEFAULT_SEQUENCES = [
    { documentType: 'accounting.quotation',    prefixTemplate: 'QT-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.invoice',      prefixTemplate: 'INV-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.billing_note', prefixTemplate: 'BN-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.receipt',      prefixTemplate: 'REC-{YYYY}{MM}-{SEQ}' },
    { documentType: 'tax.invoice',             prefixTemplate: 'TAX-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.payment',      prefixTemplate: 'PAY-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.credit_note',  prefixTemplate: 'CN-{YYYY}{MM}-{SEQ}' },
    { documentType: 'accounting.debit_note',   prefixTemplate: 'DN-{YYYY}{MM}-{SEQ}' },
    { documentType: 'inventory.movement',      prefixTemplate: 'MOV-{YYYY}{MM}-{SEQ}' },
    { documentType: 'expense.claim',           prefixTemplate: 'EXP-{YYYY}{MM}-{SEQ}' },
    { documentType: 'expense.record',          prefixTemplate: 'EXP-{YYYY}{MM}-{SEQ}' },
    { documentType: 'ledger.journal',          prefixTemplate: 'JRN-{YYYY}{MM}-{SEQ}' },
    // Item 11 sequences handled in tax section below
  ];

  const now = new Date();
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const tenantCompany of [company, company2]) {
    for (const seq of DEFAULT_SEQUENCES) {
      await prisma.documentSequence.upsert({
        where: {
          companyId_branchScopeKey_documentType_periodKey: {
            companyId: tenantCompany.id,
            branchScopeKey: 'GLOBAL',
            documentType: seq.documentType,
            periodKey,
          },
        },
        update: { prefixTemplate: seq.prefixTemplate },
        create: {
          companyId: tenantCompany.id,
          branchScopeKey: 'GLOBAL',
          documentType: seq.documentType,
          periodKey,
          prefixTemplate: seq.prefixTemplate,
          nextNumber: 1,
          padding: 5,
          resetPolicy: 'MONTHLY',
          status: 'ACTIVE',
          createdByUserId: owner.id,
        },
      });
    }
  }

  // ---- Item 10: one reviewed chart catalog; existing IDs survive local reseeds ----
  await prisma.$transaction(async (tx) => {
    for (const account of TH_SME_COA_V1.accounts) {
      const data = chartTemplateAccountWriteData(account, owner.id);
      await tx.chartOfAccount.upsert({
        where: { companyId_code: { companyId: company.id, code: account.code } },
        update: data as any,
        create: {
          ...data,
          companyId: company.id,
          createdByUserId: owner.id,
        } as any,
      });
    }

    const codes = TH_SME_COA_V1.accounts.map((account) => account.code);
    const [preview, companyOwnedTemplateRows] = await Promise.all([
      loadChartTemplatePreview(tx, company.id),
      tx.chartOfAccount.count({
        where: { companyId: company.id, code: { in: codes }, isSystem: false },
      }),
    ]);
    if (
      preview.exact !== TH_SME_COA_V1.accounts.length
      || preview.missing !== 0
      || preview.unusedConflicts !== 0
      || preview.inUseConflicts !== 0
      || companyOwnedTemplateRows !== TH_SME_COA_V1.accounts.length
    ) {
      throw new Error('seed_chart_of_accounts_postcondition_failed');
    }

    await tx.company.update({
      where: { id: company.id },
      data: {
        chartOfAccountsTemplateKey: TH_SME_COA_V1.key,
        chartOfAccountsTemplateVersion: TH_SME_COA_V1.version,
        chartOfAccountsTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
        chartOfAccountsTemplateAppliedAt: new Date(),
      },
    });
  }, { maxWait: 5_000, timeout: 120_000 });

  // ---- Inventory seed ----
  const SEED_LOCATION_ID = 'seed-local-location-main';
  const mainLocation = await prisma.inventoryLocation.upsert({
    where: { id: SEED_LOCATION_ID },
    update: { name: 'Main Stock', type: 'MAIN', status: 'ACTIVE' },
    create: {
      id: SEED_LOCATION_ID,
      companyId: company.id,
      code: 'MAIN',
      name: 'Main Stock',
      type: 'MAIN',
      status: 'ACTIVE',
      createdByUserId: owner.id,
    },
  });

  const SEED_PRODUCT_ID = 'seed-local-product-demo';
  const demoProduct = await prisma.product.upsert({
    where: { id: SEED_PRODUCT_ID },
    update: { name: 'Demo Product', sku: 'DEMO-001' },
    create: {
      id: SEED_PRODUCT_ID,
      companyId: company.id,
      sku: 'DEMO-001',
      name: 'Demo Product',
      unit: 'PCS',
      kind: 'STOCKABLE',
      status: 'ACTIVE',
      createdByUserId: owner.id,
    },
  });

  // Initial stock-in movement for demo product
  const existingMovement = await prisma.stockMovement.findFirst({
    where: { companyId: company.id, productId: demoProduct.id, movementType: 'STOCK_IN' },
  });
  if (!existingMovement) {
    await prisma.stockMovement.create({
      data: {
        companyId: company.id,
        productId: demoProduct.id,
        locationId: mainLocation.id,
        movementType: 'STOCK_IN',
        direction: 'IN',
        quantity: '100',
        reason: 'Initial seed stock',
        actorUserId: owner.id,
      },
    });
  }

  // Extra demo products with reorder points so low-stock/stock-balance/movement tools return
  // realistic data. Water + Box end below their reorder point (low stock); Coffee stays above.
  const demoInventory = [
    { id: 'seed-local-product-water', sku: 'WATER-600', name: 'น้ำดื่ม 600ml (แพ็ค 12)', reorderPoint: '50', movements: [['STOCK_IN', 'IN', '200'], ['STOCK_OUT', 'OUT', '185']] },
    { id: 'seed-local-product-coffee', sku: 'COFFEE-1KG', name: 'กาแฟคั่วบด 1kg', reorderPoint: '10', movements: [['STOCK_IN', 'IN', '40'], ['STOCK_OUT', 'OUT', '5']] },
    { id: 'seed-local-product-box', sku: 'BOX-M', name: 'กล่องพัสดุ ไซซ์ M', reorderPoint: '100', movements: [['STOCK_IN', 'IN', '500'], ['STOCK_OUT', 'OUT', '490']] },
  ] as const;
  for (const p of demoInventory) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: { name: p.name, sku: p.sku, reorderPoint: p.reorderPoint },
      create: {
        id: p.id,
        companyId: company.id,
        sku: p.sku,
        name: p.name,
        unit: 'PCS',
        kind: 'STOCKABLE',
        reorderPoint: p.reorderPoint,
        status: 'ACTIVE',
        createdByUserId: owner.id,
      },
    });
    for (const [movementType, direction, quantity] of p.movements) {
      const reason = `seed ${p.sku} ${direction} ${quantity}`;
      const exists = await prisma.stockMovement.findFirst({ where: { companyId: company.id, productId: p.id, reason } });
      if (!exists) {
        await prisma.stockMovement.create({
          data: { companyId: company.id, productId: p.id, locationId: mainLocation.id, movementType, direction, quantity, reason, actorUserId: owner.id },
        });
      }
    }
  }

  // ---- Item 06: Default notification rules ----
  const DEFAULT_RULES = [
    {
      triggerKey: 'daily_owner_summary',
      name: 'Daily Owner Summary',
      severity: 'INFO' as const,
      conditionJson: { scheduleHour: 7, timezone: 'Asia/Bangkok' },
      recipientPolicyJson: { roles: ['OWNER', 'ADMIN'] },
      channelPolicyJson: { channels: ['web', 'line'] },
      cooldownMinutes: 20 * 60,
      digestPolicy: 'NONE' as const,
      status: 'ENABLED' as const,
    },
    {
      triggerKey: 'stock_low',
      name: 'Low Stock Alert',
      severity: 'ACTION' as const,
      conditionJson: { condition: 'balance_lte_reorder_point' },
      recipientPolicyJson: { roles: ['OWNER', 'INVENTORY', 'ADMIN'] },
      channelPolicyJson: { channels: ['web', 'line'] },
      cooldownMinutes: 12 * 60,
      digestPolicy: 'NONE' as const,
      status: 'ENABLED' as const,
    },
    // Future triggers — seeded as SYSTEM/disabled
    ...['stockout_risk', 'sales_today_low', 'invoice_overdue', 'tax_due_soon',
       'approval_pending', 'follow_up_due', 'campaign_opportunity', 'report_ready', 'system_security_alert'].map((triggerKey) => ({
      triggerKey,
      name: triggerKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      severity: 'INFO' as const,
      conditionJson: {},
      recipientPolicyJson: {},
      channelPolicyJson: {},
      cooldownMinutes: 60,
      digestPolicy: 'NONE' as const,
      status: 'SYSTEM' as const,
    })),
  ];

  for (const rule of DEFAULT_RULES) {
    await prisma.notificationRule.upsert({
      where: { companyId_triggerKey: { companyId: company.id, triggerKey: rule.triggerKey } },
      update: { name: rule.name, status: rule.status },
      create: {
        companyId: company.id,
        triggerKey: rule.triggerKey,
        name: rule.name,
        severity: rule.severity,
        conditionJson: rule.conditionJson,
        recipientPolicyJson: rule.recipientPolicyJson,
        channelPolicyJson: rule.channelPolicyJson,
        cooldownMinutes: rule.cooldownMinutes,
        digestPolicy: rule.digestPolicy,
        status: rule.status,
        createdByUserId: owner.id,
      },
    });
  }

  // Default notification preference for owner. enabledTriggerKeysJson mirrors the whole
  // implemented list (the column is non-null with a `[]` default, and `[]` means "suppress
  // everything"): a seeded row must not narrow what the owner receives — opting out is the
  // preferences UI's job. Also applied on update so a re-seeded dev DB drops the old narrowing.
  const ownerPreference = {
    enabledChannelsJson: ['web', 'line'],
    enabledTriggerKeysJson: IMPLEMENTED_TRIGGER_KEYS,
    timezone: 'Asia/Bangkok',
    digestFrequency: 'NONE' as const,
  };
  await prisma.notificationPreference.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    update: { enabledTriggerKeysJson: ownerPreference.enabledTriggerKeysJson },
    create: { companyId: company.id, userId: owner.id, ...ownerPreference },
  });

  // ── Item 09: Default expense categories ────────────────────────────────────
  const DEFAULT_EXPENSE_CATEGORIES = [
    { name: 'ค่าสำนักงาน',        accountHintKey: 'expense.office_supplies',   sortOrder: 1 },
    { name: 'ค่าเช่า',            accountHintKey: 'expense.rent',             sortOrder: 2 },
    { name: 'ค่าสาธารณูปโภค',     accountHintKey: 'expense.utilities',         sortOrder: 3 },
    { name: 'ค่าเดินทาง',         accountHintKey: 'expense.travel',            sortOrder: 4 },
    { name: 'ค่าอาหารและเครื่องดื่ม', accountHintKey: 'expense.meals',       sortOrder: 5 },
    { name: 'ค่าโฆษณาและการตลาด', accountHintKey: 'expense.marketing',             sortOrder: 6 },
    { name: 'ค่าซอฟต์แวร์/บริการ',accountHintKey: 'expense.software',              sortOrder: 7 },
    { name: 'ค่าวิชาชีพ',         accountHintKey: 'expense.professional_fees', sortOrder: 8 },
    { name: 'ค่าซ่อมแซม',         accountHintKey: 'expense.repairs',               sortOrder: 9 },
    { name: 'ค่าขนส่ง',           accountHintKey: 'expense.shipping',              sortOrder: 10 },
    { name: 'อื่นๆ',              accountHintKey: 'expense.other',              sortOrder: 99 },
  ] as const;

  // These are the GLOBAL defaults (companyId NULL), and they cannot be upserted by
  // `@@unique([companyId, name])`: Postgres treats every NULL as distinct, so that key never
  // matches a global row — the previous upsert failed on every run and the swallowed error hid it,
  // which is why a seeded database had zero global categories. findFirst is the only read that
  // finds them; anything that goes wrong now throws instead of being caught.
  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { companyId: null, name: cat.name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.expenseCategory.create({
        data: { companyId: null, name: cat.name, accountHintKey: cat.accountHintKey, sortOrder: cat.sortOrder, status: 'ACTIVE' },
      });
    }
  }

  // ── Item 11: Tax document sequences ────────────────────────────────────────
  const TAX_SEQUENCES = [
    { documentType: 'tax.wht_certificate', prefixTemplate: 'WHT-{YYYY}-{SEQ}' },
    { documentType: 'tax.filing_export',   prefixTemplate: 'TAXEXP-{YYYY}{MM}-{SEQ}' },
  ];
  for (const tenantCompany of [company, company2]) {
    for (const seq of TAX_SEQUENCES) {
      await prisma.documentSequence.upsert({
        where: {
          companyId_branchScopeKey_documentType_periodKey: {
            companyId: tenantCompany.id,
            branchScopeKey: 'GLOBAL',
            documentType: seq.documentType,
            periodKey,
          },
        },
        update: { prefixTemplate: seq.prefixTemplate },
        create: {
          companyId: tenantCompany.id,
          branchScopeKey: 'GLOBAL',
          documentType: seq.documentType,
          periodKey,
          prefixTemplate: seq.prefixTemplate,
          nextNumber: 1,
          padding: 5,
          resetPolicy: seq.documentType === 'tax.wht_certificate' ? 'YEARLY' : 'MONTHLY',
          status: 'ACTIVE',
          createdByUserId: owner.id,
        },
      });
    }
  }

  // ── Item 11: Global WHT catalog — owner decision 2026-10-04 ──
  // Source baseline: RD withholding tax page (https://www.rd.go.th/14929.html) checked 2026-06-23.
  // Open the approved baseline and the individual prize; other new rates await accountant review.
  // This slice fixes the status of its route rows; other catalogue statuses stay as saved.
  const WHT_CATEGORIES = [
    { code: 'WHT_SERVICE_3',        nameTh: 'ค่าบริการ (บุคคลธรรมดา)',       nameEn: 'Service fee (individual)',          formType: 'PND3',  defaultRate: '3.0000', status: 'ACTIVE' },
    { code: 'WHT_SERVICE_5',        nameTh: 'ค่าบริการ (นิติบุคคล)',           nameEn: 'Service fee (juristic)',             formType: 'PND53', defaultRate: '3.0000', status: 'ACTIVE' },
    { code: 'WHT_RENT_IND',         nameTh: 'ค่าเช่า (บุคคลธรรมดา)',          nameEn: 'Rent (individual)',                  formType: 'PND3',  defaultRate: '5.0000', status: 'ACTIVE' },
    { code: 'WHT_RENT_JUR',         nameTh: 'ค่าเช่า (นิติบุคคล)',             nameEn: 'Rent (juristic)',                    formType: 'PND53', defaultRate: '5.0000', status: 'ACTIVE' },
    { code: 'WHT_PROFESSIONAL_IND', nameTh: 'ค่าวิชาชีพ (บุคคลธรรมดา)',      nameEn: 'Professional fee (individual)',      formType: 'PND3',  defaultRate: '3.0000', status: 'ACTIVE' },
    { code: 'WHT_PROFESSIONAL_JUR', nameTh: 'ค่าวิชาชีพ (นิติบุคคล)',         nameEn: 'Professional fee (juristic)',        formType: 'PND53', defaultRate: '3.0000', status: 'ACTIVE' },
    { code: 'WHT_ADVERTISING_IND',  nameTh: 'ค่าโฆษณา (บุคคลธรรมดา)',        nameEn: 'Advertising fee (individual)',       formType: 'PND3',  defaultRate: '2.0000', status: 'ACTIVE' },
    { code: 'WHT_ADVERTISING_JUR',  nameTh: 'ค่าโฆษณา (นิติบุคคล)',           nameEn: 'Advertising fee (juristic)',         formType: 'PND53', defaultRate: '2.0000', status: 'ACTIVE' },
    { code: 'WHT_TRANSPORT_IND',    nameTh: 'ค่าขนส่ง (บุคคลธรรมดา)',         nameEn: 'Transport fee (individual)',         formType: 'PND3',  defaultRate: '1.0000', status: 'ACTIVE' },
    { code: 'WHT_TRANSPORT_JUR',    nameTh: 'ค่าขนส่ง (นิติบุคคล)',            nameEn: 'Transport fee (juristic)',           formType: 'PND53', defaultRate: '1.0000', status: 'ACTIVE' },
    { code: 'WHT_DIVIDEND', nameTh: 'เงินปันผล (นิติบุคคล)', nameEn: 'Dividend', formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES', defaultRate: '10.0000', status: 'DRAFT' },
    { code: 'WHT_INTEREST', nameTh: 'ดอกเบี้ย (บุคคลธรรมดา)', nameEn: 'Interest', formType: 'PND2', filingRoute: 'SEPARATE_PND2', defaultRate: '1.0000', status: 'DRAFT' },
    { code: 'WHT_PRIZE', nameTh: 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา)', nameEn: 'Prize / award', formType: 'PND3', filingRoute: 'SYSTEM_FILLS', defaultRate: '5.0000', status: 'ACTIVE' },
    { code: 'WHT_OTHER_IND', nameTh: 'อื่นๆ (บุคคลธรรมดา)', nameEn: 'Other (individual)', formType: 'PND3', filingRoute: 'ACCOUNTANT_PREPARES', defaultRate: '3.0000', status: 'ACTIVE' },
    { code: 'WHT_OTHER_JUR', nameTh: 'อื่นๆ (นิติบุคคล)', nameEn: 'Other (juristic)', formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES', defaultRate: '3.0000', status: 'ACTIVE' },

    { code: 'WHT_PRIZE_JUR', nameTh: 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (นิติบุคคล)', nameEn: null, formType: 'PND53', filingRoute: 'SYSTEM_FILLS', defaultRate: '0.0000', status: 'DRAFT' },

    { code: 'WHT_INTEREST_JUR', nameTh: 'ดอกเบี้ย (นิติบุคคล)', nameEn: null, formType: 'PND53', filingRoute: 'ACCOUNTANT_PREPARES', defaultRate: '0.0000', status: 'DRAFT' },

    { code: 'WHT_DIVIDEND_IND', nameTh: 'เงินปันผล (บุคคลธรรมดา)', nameEn: null, formType: 'PND2', filingRoute: 'SEPARATE_PND2', defaultRate: '0.0000', status: 'DRAFT' },
  ] as const;

  for (const cat of WHT_CATEGORIES) {
    await (prisma as any).whtIncomeCategory.upsert({
      where: { code: cat.code },
      update: { nameTh: cat.nameTh, nameEn: cat.nameEn, formType: cat.formType, ...('filingRoute' in cat ? { filingRoute: cat.filingRoute, status: cat.status, ...(cat.code === 'WHT_PRIZE' ? { defaultRate: cat.defaultRate } : {}) } : {}) },
      create: {
        code: cat.code,
        nameTh: cat.nameTh,
        nameEn: cat.nameEn,
        formType: cat.formType,
        filingRoute: 'filingRoute' in cat ? cat.filingRoute : 'SYSTEM_FILLS',
        defaultRate: cat.defaultRate,
        status: cat.status,
        conditionNote: cat.status === 'DRAFT' ? 'รอนักบัญชีตรวจสอบก่อนเปิดใช้' : null,
      },
    });
  }

  // ── Item 11: Company tax profile (default) ──────────────────────────────────
  for (const tenantCompany of [company, company2]) {
    await (prisma as any).companyTaxProfile.upsert({
      where: { companyId: tenantCompany.id },
      update: {},
      create: {
        companyId: tenantCompany.id,
        vatRegistered: true,
        branchPolicy: 'HEAD_OFFICE_ONLY',
        accountingPeriodMonth: 12,
        taxReviewerRole: 'ACCOUNTANT',
      },
    });
  }

  // ── Item 12: Procurement document sequences ──────────────────────────────────
  const PROCUREMENT_SEQUENCES = [
    { documentType: 'procurement.purchase_request', prefixTemplate: 'PR-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
    { documentType: 'procurement.purchase_order',   prefixTemplate: 'PO-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
    { documentType: 'procurement.goods_receipt',    prefixTemplate: 'GR-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
    { documentType: 'accounts_payable.vendor_bill', prefixTemplate: 'VB-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
    { documentType: 'accounts_payable.payment',     prefixTemplate: 'PAY-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
  ];
  for (const tenantCompany of [company, company2]) {
    for (const seq of PROCUREMENT_SEQUENCES) {
      await prisma.documentSequence.upsert({
        where: {
          companyId_branchScopeKey_documentType_periodKey: {
            companyId: tenantCompany.id, branchScopeKey: 'GLOBAL', documentType: seq.documentType, periodKey,
          },
        },
        update: { prefixTemplate: seq.prefixTemplate },
        create: {
          companyId: tenantCompany.id, branchScopeKey: 'GLOBAL', documentType: seq.documentType, periodKey,
          prefixTemplate: seq.prefixTemplate, nextNumber: 1, padding: 5, resetPolicy: seq.resetPolicy, status: 'ACTIVE', createdByUserId: owner.id,
        },
      });
    }
  }

  // ── Item 14: Reimbursement document sequences ────────────────────────────────
  const REIMBURSEMENT_SEQUENCES = [
    { documentType: 'reimbursement.request', prefixTemplate: 'RB-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
    { documentType: 'reimbursement.payment', prefixTemplate: 'RBPAY-{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY' as const },
  ];
  for (const tenantCompany of [company, company2]) {
    for (const seq of REIMBURSEMENT_SEQUENCES) {
      await prisma.documentSequence.upsert({
        where: {
          companyId_branchScopeKey_documentType_periodKey: {
            companyId: tenantCompany.id, branchScopeKey: 'GLOBAL', documentType: seq.documentType, periodKey,
          },
        },
        update: { prefixTemplate: seq.prefixTemplate },
        create: {
          companyId: tenantCompany.id, branchScopeKey: 'GLOBAL', documentType: seq.documentType, periodKey,
          prefixTemplate: seq.prefixTemplate, nextNumber: 1, padding: 5, resetPolicy: seq.resetPolicy, status: 'ACTIVE', createdByUserId: owner.id,
        },
      });
    }
  }

  // ── Item 14: Reimbursement default company policy ────────────────────────────
  for (const tenantCompany of [company, company2]) {
    await (prisma as any).reimbursementPolicy.upsert({
      where: { companyId_branchId: { companyId: tenantCompany.id, branchId: null } },
      update: {},
      create: { companyId: tenantCompany.id, createdByUserId: owner.id },
    }).catch(() => { /* table may not exist in all envs */ });
  }

  // ── Item 16: Workflow Automation template catalog (global, not company-scoped) ──
  for (const t of WORKFLOW_TEMPLATE_CATALOG) {
    await prisma.workflowTemplate.upsert({
      where: { key: t.key },
      update: {
        name: t.name,
        description: t.description,
        category: t.category,
        sourceModule: t.sourceModule,
        triggerType: t.triggerType as any,
        defaultConditionJson: t.defaultConditionJson as any,
        defaultActionJson: t.defaultActionJson as any,
        requiredPermissions: t.requiredPermissions as any,
        requiredSourceModules: t.requiredSourceModules as any,
        defaultEnabled: t.defaultEnabled,
        status: t.status as any,
        unavailableReason: t.unavailableReason ?? null,
      },
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        sourceModule: t.sourceModule,
        triggerType: t.triggerType as any,
        defaultConditionJson: t.defaultConditionJson as any,
        defaultActionJson: t.defaultActionJson as any,
        requiredPermissions: t.requiredPermissions as any,
        requiredSourceModules: t.requiredSourceModules as any,
        defaultEnabled: t.defaultEnabled,
        status: t.status as any,
        unavailableReason: t.unavailableReason ?? null,
      },
    });
  }

  // Same auto-enable seam prod uses (prisma/sync-workflow-templates.ts) so a locally seeded
  // company has the reimbursement notification rules ENABLED with no admin clicks.
  const workflowRepo = new PrismaWorkflowRepository({ client: prisma } as any);
  for (const tenantCompany of [company, company2]) {
    await autoEnableWorkflowTemplatesForCompany(workflowRepo, tenantCompany.id);
  }

  await seedOperationalDemoData({
    companyId: company.id,
    ownerUserId: owner.id,
    branchId: branch.id,
    inventoryLocationId: mainLocation.id,
    productId: demoProduct.id,
  });

  await seedPlainShop(prisma);
  await seedPlainShop(prisma, UNANSWERED_PLAIN_SHOP);
  await seedPlainShop(prisma, INPUT_VAT_SHOP);
  await seedPlainShop(prisma, PACKAGE_SHOP);
  await seedPlainShop(prisma, FREE_DRAFT_SHOP);

  console.log(`Seed complete: company, owner, ${QA_ROLE_ACCOUNTS.length} QA role accounts, roles, permissions, branch (${branch.id}), Room45 CRM demo workspace, operational menu demo data, location (${mainLocation.id}), product (${demoProduct.id}), document sequences, expense categories, notification rules, WHT categories, company tax profile, procurement sequences, reimbursement sequences/policy, and workflow template catalog (${WORKFLOW_TEMPLATE_CATALOG.length}) upserted.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
