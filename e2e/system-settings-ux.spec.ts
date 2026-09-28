import { test, expect } from './harness/fixtures';
import { COMPANY_ID, SEED_USERS, ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import type { SystemEmailDeliveryDto, EmailHistoryPolicyDto, SharedLineMessagingSettings } from '@watchdog-bms/contracts';
import type { Page } from '@playwright/test';

async function login(page:Page) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button',{name:/^(เข้าสู่ระบบ|Sign in)$/i}).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
}
function watchWrites(page:Page) {
  const writes:string[]=[];
  page.on('request',request=>{if(request.url().includes('/system/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
  return writes;
}
async function noOverflow(page:Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
}
const when='2026-09-16T10:00:00.000Z';

test('console renames an owner without employee credentials and retains drafts on conflict', async ({ page }) => {
  const ownerId = 'ui-only-owner';
  let name = 'MangmeePlus.Test', conflict = false;
  const writes: unknown[] = [];
  await page.route(`**/v1/system/partners/${COMPANY_ID}/members`, route => route.fulfill({ json: { items: [
    { userId: ownerId, displayName: name, roles: ['OWNER'], membershipStatus: 'ACTIVE', lineLinked: true },
    { userId: 'ui-only-staff', displayName: 'Employee', roles: ['STAFF'], membershipStatus: 'ACTIVE', lineLinked: false },
  ] } }));
  await page.route(`**/v1/system/partners/${COMPANY_ID}/members/${ownerId}/display-name`, route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (conflict) return route.fulfill({ status: 409, json: { code: 'partner_owner_name_conflict' } });
    expect(route.request().method()).toBe('PATCH');
    expect(body.expectedDisplayName).toBe(name);
    expect(Object.keys(body).sort()).toEqual(['displayName', 'expectedDisplayName']);
    name = body.displayName;
    return route.fulfill({ json: { displayName: name } });
  });
  await login(page);
  await page.goto(`/system/partners/${COMPANY_ID}?view=members`);
  const ownerRow = page.getByRole('row').filter({ hasText: 'MangmeePlus.Test' });
  await ownerRow.getByText('จัดการสมาชิก', { exact: true }).click();
  await ownerRow.getByRole('button', { name: 'แก้ไขชื่อที่แสดง', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'แก้ไขชื่อที่แสดง', exact: true });
  await expect(dialog.getByRole('button', { name: 'บันทึกชื่อ', exact: true })).toBeDisabled();
  await dialog.getByLabel('ชื่อที่แสดง', { exact: true }).fill('ยกเลิกชื่อนี้');
  await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  expect(writes).toEqual([]);
  await ownerRow.getByRole('button', { name: 'แก้ไขชื่อที่แสดง', exact: true }).click();
  await dialog.getByLabel('ชื่อที่แสดง', { exact: true }).fill('สมชาย ทดสอบ');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'บันทึกชื่อ', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'สมชาย ทดสอบ' })).toContainText('OWNER');
  await page.reload();
  const renamed = page.getByRole('row').filter({ hasText: 'สมชาย ทดสอบ' });
  await renamed.getByText('จัดการสมาชิก', { exact: true }).click();
  await renamed.getByRole('button', { name: 'แก้ไขชื่อที่แสดง', exact: true }).click();
  conflict = true;
  await dialog.getByLabel('ชื่อที่แสดง', { exact: true }).fill('ชื่อร่างที่ต้องเก็บ');
  await dialog.getByRole('button', { name: 'บันทึกชื่อ', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ชื่อบัญชีถูกแก้ไขแล้ว');
  await expect(dialog.getByLabel('ชื่อที่แสดง', { exact: true })).toHaveValue('ชื่อร่างที่ต้องเก็บ');
  expect(writes).toHaveLength(2);
  await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  const staff = page.getByRole('row').filter({ hasText: 'Employee' });
  await staff.getByText('จัดการสมาชิก', { exact: true }).click();
  await expect(staff.getByRole('button', { name: 'แก้ไขชื่อที่แสดง', exact: true })).toHaveCount(0);
  await expectNoClientError(page);
});

const mail: SystemEmailDeliveryDto={observedAt:when,windowStartedAt:'2026-09-09T10:00:00.000Z',configured:true,outboundSelected:true,
  totals:{intents:8,attempts:10,accepted:7,delivered:6,suppressed:1,possibleDuplicates:1},pending:{attempts:3,oldestCreatedAt:when,needsReview:1,overdueRecovery:2},callbacks:null,
  items:[{id:'ui-only-email',purpose:'password_reset',state:'UNKNOWN',generation:1,createdAt:when,submittedAt:null,deliveredAt:null,suppressedAt:null,deadlineAt:null,nextRecoveryAt:null,possibleDuplicate:false,needsReview:true,signupHistoryPath:null,billingHistoryPath:null}],nextCursor:'ui-only-next'};
const policy:EmailHistoryPolicyDto={configured:true,canManage:true,scopeKey:'ui-only-scope',version:1,retentionDays:180,enabled:false,eligibleCount:0,lastCleanupAt:null,lastArchivedCount:0,history:[]};

test('email theme keeps history and filters together, preserves retention drafts and handles unavailable history',async({page})=>{
  const writes=watchWrites(page),queries:string[]=[];
  let denied=false,configured=true;
  await page.route('**/v1/system/email-delivery?*',route=>{
    const url=new URL(route.request().url());queries.push(url.search);
    return denied?route.fulfill({status:403,json:{}}):route.fulfill({json:!configured?{...mail,configured:false,outboundSelected:false,totals:null,pending:null,items:[],nextCursor:null}:{...mail,items:url.searchParams.has('purpose')?[]:mail.items,nextCursor:url.searchParams.has('cursor')?null:mail.nextCursor}});
  });
  await page.route('**/v1/system/email-delivery/retention',route=>route.fulfill({json:policy}));
  await login(page);await page.goto('/system/email-delivery');
  await expect(page.getByRole('heading',{name:'สถานะอีเมล',exact:true})).toBeVisible();
  const history=page.getByRole('region',{name:'ประวัติการส่งอีเมล',exact:true});
  await expect(history.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'ตรวจการเชื่อมต่อ Postmark',exact:true})).toBeHidden();
  const clear=history.getByRole('button',{name:'ล้างตัวกรอง',exact:true});
  await expect(clear).toBeVisible();
  await history.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
  await expect(history.getByRole('button',{name:'กลับหน้าแรก',exact:true})).toBeVisible();
  expect(queries.at(-1)).toContain('cursor=');
  await history.getByRole('combobox',{name:'ประเภทอีเมล',exact:true}).click();
  await page.getByRole('option',{name:'กู้รหัสผ่าน',exact:true}).click();
  await expect(history.getByText('ไม่พบประวัติตามตัวกรองนี้',{exact:true})).toBeVisible();
  expect(queries.at(-1)).toBe('?purpose=password_reset');
  await clear.click();await expect(history.getByRole('article')).toHaveCount(1);
  await page.getByText('การเก็บประวัติอีเมล',{exact:true}).click();
  await page.getByLabel('เก็บประวัติทั่วไปกี่วัน',{exact:true}).fill('90');
  await page.getByLabel('เหตุผลที่แก้ไข',{exact:true}).fill('ร่างทดสอบ ต้องไม่หาย');
  await history.getByRole('button',{name:'อัปเดตประวัติ',exact:true}).click();
  await expect(history.getByRole('button',{name:'อัปเดตประวัติ',exact:true})).toBeEnabled();
  await expect(page.getByLabel('เก็บประวัติทั่วไปกี่วัน',{exact:true})).toHaveValue('90');
  await expect(page.getByRole('button',{name:'อัปเดตการตั้งค่า',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'ตรวจรายการก่อนบันทึก',exact:true}).click();
  await expect(page.getByLabel('เก็บประวัติทั่วไปกี่วัน',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'ตรวจการเปลี่ยนแปลงก่อนยืนยัน',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'กลับไปแก้ไข',exact:true}).click();
  await expect(page.getByLabel('เหตุผลที่แก้ไข',{exact:true})).toHaveValue('ร่างทดสอบ ต้องไม่หาย');
  denied=true;await history.getByRole('button',{name:'อัปเดตประวัติ',exact:true}).click();
  await expect(history.getByRole('alert')).toContainText('ไม่มีสิทธิ์');
  await expect(history.getByRole('article')).toHaveCount(0);
  denied=false;configured=false;await history.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).click();
  await expect(page.getByRole('region',{name:'ภาพรวมอีเมล',exact:true})).toContainText('ยังดูประวัติการส่งอีเมลไม่ได้');
  await expect(history.getByText('ยังเปิดประวัติไม่ได้',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await noOverflow(page);await expectNoClientError(page);expect(writes).toEqual([]);
});

test('LINE settings prioritizes evidence, hides credential replacement and keeps drafts across read refresh',async({page})=>{
  const writes=watchWrites(page);
  let denied=false;
  let data:SharedLineMessagingSettings={kind:'LINE_MESSAGING_API',version:1,channelId:null,runtimeStatus:'INCOMPLETE',source:'ENVIRONMENT',publishedAt:null,tokenValidatedAt:null,inboundVerifiedAt:null,canReplace:false,updatedAt:null};
  await page.route('**/v1/system/line/shared-credentials',route=>denied?route.fulfill({status:403,json:{code:'FORBIDDEN'}}):route.fulfill({json:data}));
  await login(page);await page.goto('/system/line-settings');
  await expect(page.getByRole('heading',{name:'ยังตั้งค่า LINE ไม่ครบ',exact:true})).toBeVisible();
  await expect(page.getByLabel('Channel Secret ใหม่',{exact:true})).toHaveCount(0);
  data={...data,channelId:'1234567890',runtimeStatus:'AVAILABLE',canReplace:true};
  await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ระบบอ่านค่าการเชื่อมต่อได้',exact:true})).toBeVisible();
  await expect(page.getByLabel('Channel Secret ใหม่',{exact:true})).toBeHidden();
  await page.getByText('เปลี่ยนกุญแจเชื่อมต่อ LINE',{exact:true}).click();
  await page.getByLabel('เหตุผลการเปลี่ยน',{exact:true}).fill('ร่างทดสอบการจัดหน้า');
  await expect(page.getByRole('button',{name:'ตรวจและบันทึกกุญแจ LINE',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
  await expect(page.getByRole('button',{name:'อัปเดตสถานะ',exact:true})).toBeEnabled();
  await expect(page.getByLabel('เหตุผลการเปลี่ยน',{exact:true})).toHaveValue('ร่างทดสอบการจัดหน้า');
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  denied=true;await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Channel Secret ใหม่',{exact:true})).toHaveCount(0);
  expect(writes).toEqual([]);await expectNoClientError(page);
});

test('company detail opens one section, preserves drafts and browser navigation and groups feature controls',async({page})=>{
  const writes=watchWrites(page);
  await login(page);await page.goto(`/system/partners/${COMPANY_ID}`);
  const nav=page.getByRole('navigation',{name:'หมวดข้อมูลบริษัท',exact:true});
  await expect(page.getByRole('region',{name:'ภาพรวมบริษัท',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'สมาชิกบริษัท',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'ปิดใช้งานบริษัท',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'แก้ไขข้อมูลบริษัท',exact:true}).click();
  await page.getByRole('textbox',{name:'ชื่อร้าน / แบรนด์',exact:true}).fill('ร่างชื่อแบรนด์');
  await nav.getByRole('link',{name:'ติดต่อและประวัติ',exact:true}).click();
  await expect(page).toHaveURL(/view=contact/);
  await page.getByRole('textbox',{name:'ข้อความถึงร้าน',exact:true}).fill('ร่างข้อความ ไม่ส่งจริง');
  await nav.getByRole('link',{name:'ภาพรวม',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'ชื่อร้าน / แบรนด์',exact:true})).toHaveValue('ร่างชื่อแบรนด์');
  await page.goBack();await expect(page.getByRole('textbox',{name:'ข้อความถึงร้าน',exact:true})).toHaveValue('ร่างข้อความ ไม่ส่งจริง');
  await nav.getByRole('link',{name:'แพ็กเกจและฟีเจอร์',exact:true}).click();
  const menus=page.getByRole('combobox',{name:'หมวดเมนู',exact:true});
  await expect(menus).toContainText('เมนูหลัก');
  await page.getByRole('searchbox',{name:'ค้นหาเมนู',exact:true}).fill('เอกสารขาย');
  await expect(page.getByText('ค้นหาในทุกหมวดเมนู',{exact:true})).toBeVisible();
  await nav.getByRole('link',{name:'สมาชิก',exact:true}).click();
  await expect(page.getByRole('heading',{name:'สมาชิกบริษัท',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ออกรหัสผ่านชั่วคราวใหม่',exact:true}).first()).toBeHidden();
  await page.getByText('จัดการสมาชิก',{exact:true}).first().click();
  await page.getByRole('button',{name:'แก้ไขข้อมูลติดต่อ',exact:true}).first().click();
  await page.getByRole('textbox',{name:'อีเมลสมาชิก',exact:true}).fill('draft-only@example.test');
  await nav.getByRole('link',{name:'แพ็กเกจและฟีเจอร์',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'ค้นหาเมนู',exact:true})).toHaveValue('เอกสารขาย');
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await nav.getByRole('link',{name:'สมาชิก',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'อีเมลสมาชิก',exact:true})).toHaveValue('draft-only@example.test');
  await noOverflow(page);
  await nav.getByRole('link',{name:'AI และโควตา',exact:true}).click();
  await expect(page.getByRole('region',{name:'AI และโควตาบริษัท',exact:true})).toBeVisible();
  await page.getByText('เปลี่ยนรุ่น AI ของบริษัท',{exact:true}).click();
  await page.getByLabel('เหตุผลที่เปลี่ยนรุ่น AI',{exact:true}).fill('ร่างการปรับ AI');
  await nav.getByRole('link',{name:'ภาพรวม',exact:true}).click();await noOverflow(page);
  await nav.getByRole('link',{name:'AI และโควตา',exact:true}).click();
  await expect(page.getByLabel('เหตุผลที่เปลี่ยนรุ่น AI',{exact:true})).toHaveValue('ร่างการปรับ AI');
  await noOverflow(page);
  expect(writes).toEqual([]);await expectNoClientError(page);
  await page.goto(`/system/partners/${COMPANY_ID}?support=ui-only-support&asker=review`);
  await expect(page.getByRole('region',{name:'ติดต่อและประวัติบริษัท',exact:true})).toBeVisible();
  await expect(page.getByText('ตอบถึง: ผู้ขอ review',{exact:false})).toBeVisible();
  expect(writes).toEqual([]);
});
