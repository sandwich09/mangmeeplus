// Diagnostic only: unmodified application snapshot, disposable localhost DB, target-spec assertions.
import { test, expect } from './harness/fixtures';
import { ensureBearerLegalAcceptance, SEED_USERS, API_BASE_URL, WEB_BASE_URL } from './harness/auth';
import { type RoleKey } from './harness/roles';
import { firstActiveBranch, chooseThemedOption, branchOptionName, json } from './harness/e2e-utils';
import { PNG, openUploadPanel, watchCreatedDrafts } from './harness/expense-capture';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
const requireApi=createRequire(resolve('apps/api/package.json'));
const { Pool }=requireApi('pg');
const dbUrl=new URL(process.env.DATABASE_URL!);
if(dbUrl.hostname!=='127.0.0.1'||dbUrl.port!=='25463'||dbUrl.pathname!=='/manual_flag_e2e'||API_BASE_URL!=='http://127.0.0.1:3061/v1'||WEB_BASE_URL!=='http://127.0.0.1:3060')throw new Error('Isolated local stack required');
const pool=new Pool({connectionString:dbUrl.toString()});
const company='seed-local-company',base=`companies/${company}/expenses`;
async function flag(enabled:boolean,key='expenses.manual',co=company){await pool.query('UPDATE "CompanyFeatureEntitlement" SET enabled=$1,"updatedAt"=now() WHERE "companyId"=$2 AND "featureKey"=$3',[enabled,co,key]);}
async function setup(){for(const co of [company,'seed-local-company-2'])for(const key of ALL_FEATURE_ENTITLEMENT_KEYS)await pool.query('INSERT INTO "CompanyFeatureEntitlement" (id,"companyId","featureKey",enabled,"updatedAt") VALUES ($1,$2,$3,true,now()) ON CONFLICT ("companyId","featureKey") DO UPDATE SET enabled=true',[`manual-${co}-${key}`,co,key]);}
function note(label:string,data:unknown){appendFileSync('/tmp/manual-flag-e2e-20261001/evidence/observations.jsonl',JSON.stringify({test:test.info().title,label,data})+'\n');}
async function body(res:any){return {status:res.status(),body:await res.json().catch(()=>null)};}
function input(branchId='seed-local-branch-ho',source='WEB_MANUAL'){return {branchId,captureSource:source,idempotencyKey:randomUUID(),expenseDate:'2026-10-01',vatMode:'NO_VAT',inputVatClaimStatus:'NON_CLAIMABLE',note:'Isolated manual flag E2E',missingReceiptReason:'Synthetic receipt unavailable',lines:[{lineNumber:1,description:'Manual flag synthetic expense',quantity:'1',unitPrice:'100'}]};}
async function draft(api:any,source='WEB_MANUAL'){return json<any>(await api.post(base,{data:input('seed-local-branch-ho',source)}));}
async function me(api:any){return json<any>(await api.get('auth/me'));}
async function fillManual(page:any,api:any){const branch=await firstActiveBranch(api,company);await chooseThemedOption(page,page.getByRole('combobox',{name:'สาขาของรายการ',exact:true}),branchOptionName(branch));await page.getByRole('textbox',{name:'รายละเอียดค่าใช้จ่าย',exact:true}).fill('Unsaved manual flag E2E');await page.getByRole('spinbutton',{name:'ราคาต่อหน่วย',exact:true}).fill('100');}
async function screenshot(page:any,name:string){await page.screenshot({path:test.info().outputPath(name+'.png'),fullPage:true});}
test.beforeAll(async()=>{await setup();await pool.query(`INSERT INTO "CompanyEntitlementNormalization" (id,"companyId",status,"snapshotHash","runId","normalizerVersion","cohortKind","completedAt","updatedAt") VALUES ('manual-fixture-normalization','seed-local-company','COMPLETED','synthetic-explicit-fixture','manual-e2e',1,'EXPLICIT',now(),now()) ON CONFLICT ("companyId") DO NOTHING`);});
test.beforeEach(async()=>{await flag(true);await flag(true,'expenses');});
test.afterEach(async()=>{await flag(true);await flag(true,'expenses');});
test.afterAll(async()=>{await pool.end();});

for(const role of ['OWNER','ADMIN','MANAGER','STAFF','FINANCE','ACCOUNTANT','COMPANY_VIEW','SALES','INVENTORY','MARKETING'] as RoleKey[]){
 test(`API ${role}: OFF must preserve role permissions and expense endpoints`,async({apiAs})=>{
  const api=await apiAs(role);const before=await me(api);const samples:any={};
  for(const enabled of [true,false]){
   await flag(true);let row:any=null,deleteRow:any=null;if(before.permissions.includes('expense.create')){row=await draft(api,'WEB_UPLOAD');deleteRow=await draft(api);}
   await flag(enabled);const current=await me(api);const sample:any={permissions:current.permissions.filter((p:string)=>p.startsWith('expense.')||p.startsWith('reimbursement.')),featureSnapshotPresent:'entitledFeatureKeys'in current};
   sample.create=await body(await api.post(base,{data:input()}));
   sample.list=await body(await api.get(base+'?pageSize=1'));
   if(row){sample.edit=await body(await api.patch(`${base}/${row.id}`,{data:{expectedUpdatedAt:row.updatedAt,note:`Updated ${enabled}`}}));const fresh=await json<any>(await api.get(`${base}/${row.id}`));sample.review=await body(await api.patch(`${base}/${row.id}/review-fields`,{data:{expectedUpdatedAt:fresh.updatedAt,note:'Reviewer check'}}));sample.ready=await body(await api.post(`${base}/${row.id}/mark-ready`,{data:{}}));sample.delete=await body(await api.delete(`${base}/${deleteRow.id}`));}
   sample.deniedTenant=await body(await api.get('companies/not-a-member/expenses'));
   samples[enabled?'ON':'OFF']=sample;
  }
  note('role-matrix',samples);
  expect.soft(samples.OFF.permissions,'OFF must retain business permissions (spec AC01)').toEqual(samples.ON.permissions);
  expect.soft(samples.OFF.create.status,'direct API create must retain same authority').toBe(samples.ON.create.status);
  expect.soft(samples.OFF.list.status).toBe(samples.ON.list.status);
  for(const action of ['edit','review','ready','delete'])if(samples.ON[action])expect.soft(samples.OFF[action].status,`${action} authority/result must be unchanged`).toBe(samples.ON[action].status);
  expect(samples.OFF.deniedTenant.status).toBe(403);
 });
}

test('API parent expenses OFF retains parent boundary',async({api})=>{await flag(false,'expenses');const current=await me(api);note('parent-off',{permissions:current.permissions.filter((x:string)=>x.startsWith('expense.'))});expect(current.permissions).not.toContain('expense.create');expect((await api.post(base,{data:input()})).status()).toBe(403);});
test('API cross-company flag isolation',async({api})=>{await flag(false);const current=await me(api);const other=await json<any>(await api.get('auth/me',{headers:{'X-Company-Id':'seed-local-company-2'}}));note('company-isolation',{current:current.permissions.includes('expense.create'),other:other.permissions.includes('expense.create')});expect(other.permissions).toContain('expense.create');});
test('API flag ON again restores create without relogin',async({api})=>{await flag(false);expect((await api.post(base,{data:input()})).status()).toBe(403);await flag(true);expect((await api.post(base,{data:input()})).status()).toBe(201);});

for(const width of [1440,390]){
 test(`Browser ${width}: ON manual create persists and survives reload`,async({authedPage:page,api})=>{await page.setViewportSize({width,height:900});await page.goto(`/companies/${company}/expenses/manual`);await fillManual(page,api);const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/expenses'));await page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();const response=await saved;const row=await response.json();expect(response.status()).toBe(201);await expect(page).toHaveURL(new RegExp(`/expenses/${row.id}`));const stored=await json<any>(await api.get(`${base}/${row.id}`));expect(stored.lines[0].description).toBe('Unsaved manual flag E2E');await page.reload();await expect(page.getByRole('textbox',{name:'รายละเอียด',exact:true})).toHaveValue('Unsaved manual flag E2E');await screenshot(page,`manual-on-${width}`);note('persisted',{id:row.id,total:stored.grandTotalAmount});});
 test(`Browser ${width}: OFF closes direct URL and legacy alias`,async({authedPage:page})=>{await page.setViewportSize({width,height:900});await flag(false);for(const path of ['/expenses/manual','/expenses?tab=manual']){await page.goto(`/companies/${company}${path}`);await expect(page.getByText(/คุณไม่มีสิทธิ์เข้าถึงส่วนนี้/)).toBeVisible();await expect(page.getByRole('textbox',{name:'รายละเอียดค่าใช้จ่าย',exact:true})).toHaveCount(0);await expect(page.locator('a[href$="/expenses/manual"]')).toHaveCount(0);}await screenshot(page,`manual-off-${width}`);});
 test(`Browser ${width}: OFF upload image still creates a readable draft`,async({authedPage:page,api})=>{await flag(false);await page.setViewportSize({width,height:900});const created=watchCreatedDrafts(page);await openUploadPanel(page,api,company);await page.locator('input[type=file].hidden').first().setInputFiles({name:`manual-flag-${randomUUID()}.png`,mimeType:'image/png',buffer:PNG});await page.getByRole('button',{name:'ให้ AI อ่านใบเสร็จ',exact:true}).click();await page.waitForURL(/\/expenses\/(?!upload$)[^/?#]+$/,{timeout:60000});const ids=await created();expect(ids).toHaveLength(1);const row=await json<any>(await api.get(`${base}/${ids[0]}`));expect(row.captureSource).toBe('WEB_UPLOAD');expect(row.primaryAttachmentId).toBeTruthy();await screenshot(page,`upload-off-${width}`);note('upload',{id:row.id,attachment:row.primaryAttachmentId});});
}
for(const path of ['/expenses','/expenses/upload','/income-expense-ledger','/user-guide/expenses','/ai-suggestions','/expenses/substitute-receipts','/reimbursements','/expenses/categories','/expenses/signatures','/expenses/evidence']){
 test(`Browser OFF route and CTA audit ${path}`,async({authedPage:page})=>{await flag(false);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`/companies/${company}${path}`);await expect(page.locator('main').first()).toBeVisible();await expect(page.locator('a[href$="/expenses/manual"]')).toHaveCount(0);await expect(page.getByText(/คุณไม่มีสิทธิ์เข้าถึงส่วนนี้/)).toHaveCount(0);note('route',{path,url:page.url(),errors,manualLinks:await page.locator('a[href*="/expenses/manual"]').count()});expect(errors).toEqual([]);await screenshot(page,'route');});
}

test('Browser OFF preserves manual creation inside substitute wizard',async({authedPage:page,api})=>{await flag(false);await page.goto(`/companies/${company}/expenses/substitute-receipts/new`);await page.getByRole('radio',{name:/ยังไม่ได้บันทึกรายการ/}).click();const branch=await firstActiveBranch(api,company);await chooseThemedOption(page,page.getByRole('combobox',{name:'สาขาของรายการ',exact:true}),branchOptionName(branch));await screenshot(page,'wizard-off');const create=page.getByRole('button',{name:'สร้างฉบับร่างและใช้รายการนี้',exact:true});note('wizard',{createButtons:await create.count(),text:(await page.locator('main').innerText()).slice(0,5500)});await expect(create).toBeEnabled();});
test('Browser admitted manual form can finish immediately after OFF',async({authedPage:page,api})=>{await page.goto(`/companies/${company}/expenses/manual`);await fillManual(page,api);await flag(false);const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/expenses'));await page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();const response=await saved;note('active-submit',await body(response));await screenshot(page,'active-submit-off');expect(response.status()).toBe(201);});
test('Browser admitted manual form survives OFF focus refresh',async({authedPage:page,api})=>{await page.goto(`/companies/${company}/expenses/manual`);await fillManual(page,api);await flag(false);const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/me'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refreshed;await expect(page.getByText(/คุณไม่มีสิทธิ์เข้าถึงส่วนนี้/)).toBeVisible();note('focus-refresh',{url:page.url(),formCount:await page.getByRole('textbox',{name:'รายละเอียดค่าใช้จ่าย',exact:true}).count()});await screenshot(page,'focus-refresh-off');await expect(page.getByRole('textbox',{name:'รายละเอียดค่าใช้จ่าย',exact:true})).toHaveValue('Unsaved manual flag E2E');});

test('Browser permission-negative reader cannot enter manual ON or OFF',async({pageAs})=>{const page=await pageAs('COMPANY_VIEW');for(const enabled of [true,false]){await flag(enabled);await page.goto(`/companies/${company}/expenses/manual`);await expect(page.getByRole('textbox',{name:'รายละเอียดค่าใช้จ่าย',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true})).toHaveCount(0);}await screenshot(page,'reader-denied');});
test('API admin command OFF replay CAS ON and runtime resolution',async({request,playwright,api})=>{
 const login=await json<any>(await request.post(`${API_BASE_URL}/auth/password/login`,{data:SEED_USERS.systemAdmin}));await ensureBearerLegalAcceptance(request,login.accessToken,'seed-watchdog-system-company');const admin=await playwright.request.newContext({baseURL:API_BASE_URL+'/',extraHTTPHeaders:{Authorization:`Bearer ${login.accessToken}`,'X-Company-Id':'seed-watchdog-system-company'}});
 try{const detail=await json<any>(await admin.get(`system/partners/${company}`));note('admin-detail-keys',Object.keys(detail));const version=detail.entitlementSetVersion??detail.setVersion??0;const cmd={features:[{featureKey:'expenses.manual',enabled:false}],commandId:randomUUID(),expectedSetVersion:version};const off=await body(await admin.put(`system/partners/${company}/features`,{data:cmd}));note('admin-off',off);expect(off.status).toBe(200);const replay=await body(await admin.put(`system/partners/${company}/features`,{data:cmd}));expect(replay.status).toBe(200);const stale=await body(await admin.put(`system/partners/${company}/features`,{data:{...cmd,commandId:randomUUID()}}));expect(stale.status).toBe(409);const on=await body(await admin.put(`system/partners/${company}/features`,{data:{features:[{featureKey:'expenses.manual',enabled:true}],commandId:randomUUID(),expectedSetVersion:off.body.setVersion}}));note('admin-on',on);expect(on.status).toBe(200);expect((await me(api)).permissions).toContain('expense.create');}finally{await admin.dispose();}
});
