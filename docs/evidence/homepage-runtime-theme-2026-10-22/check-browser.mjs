import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = 'http://127.0.0.1:43831';
const dir = fileURLToPath(new URL('.', import.meta.url));
const { tokens } = JSON.parse(readFileSync('/tmp/mangmee-home-theme-local-session.json','utf8'));
const browser = await chromium.launch({channel:'chrome',headless:true});
const checks = [], errors = [];
const context = await browser.newContext();
await context.addCookies([{name:'watchdog_token',value:tokens.admin,url:base,httpOnly:true,sameSite:'Lax'},{name:'watchdog_csrf',value:'local-theme-csrf',url:base,sameSite:'Lax'}]);
const admin = await context.newPage();admin.setDefaultTimeout(15000);admin.setDefaultNavigationTimeout(60000);
const visitorContext = await browser.newContext({reducedMotion:'reduce'});
const home = await visitorContext.newPage();home.setDefaultNavigationTimeout(60000);
for(const p of [admin,home]) p.on('pageerror',error=>errors.push(error.message));
const openAdmin = async()=>{await admin.goto(`${base}/system/home-theme`,{waitUntil:'networkidle'});await admin.getByRole('radio',{name:/^ปกติ/}).waitFor();};
const save = async(page=admin)=>{
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/system/home-theme')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'บันทึกธีม',exact:true}).click();return pending;
};
const choose=async(event,page=admin)=>page.getByRole('radio',{name:event==='halloween'?/^ฮาโลวีน/:/^ปกติ/}).check();
const noOverflow=async(page)=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
try {
 await openAdmin();
 // The BFF's real CSRF boundary is still enforced.
 assert.equal(await admin.evaluate(async()=> (await fetch('/api/v1/system/home-theme',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({event:'halloween',expectedVersion:0})})).status),403);
 for(const width of [390,1280]) {
   await admin.setViewportSize({width,height:width===390?844:900});
   await home.setViewportSize({width,height:width===390?844:900});
   await choose('default');assert.equal((await save()).status(),200);
   await home.goto(base,{waitUntil:'networkidle'});await home.evaluate(()=>document.fonts.ready);
   const capture=await home.locator('.public-home').evaluate(root=>({text:root.innerText,links:[...root.querySelectorAll('a')].map(a=>[a.textContent,a.getAttribute('href')]),sections:[...root.querySelectorAll('main > section')].map(el=>{let b=el.getBoundingClientRect();return{id:el.id,x:b.x,y:b.y,width:b.width,height:b.height};}),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.deepEqual(capture,JSON.parse(readFileSync(`${dir}../homepage-event-prototype-2026-10-21/baseline-${width}.json`,'utf8')));
   await choose('halloween');
   await admin.screenshot({path:`${dir}admin-selected-${width}.png`});
   assert.equal((await save()).status(),200);
   await admin.getByRole('status').filter({hasText:'บันทึกธีมแล้ว'}).waitFor();
   await home.reload({waitUntil:'networkidle'});
   assert.equal(await home.locator('.public-home').getAttribute('data-home-event'),'halloween');
   assert.equal(await home.locator('.public-home').getAttribute('data-home-palette'),'plum');
   assert.equal(await home.locator('.home-event-tools').count(),0);
   assert.equal(await home.locator('.pg').innerText(),capture.text);
   await noOverflow(admin);await noOverflow(home);
   await home.screenshot({path:`${dir}runtime-home-${width}.png`});
   await admin.screenshot({path:`${dir}admin-saved-${width}.png`});
   await choose('default');assert.equal((await save()).status(),200);
   await home.reload({waitUntil:'networkidle'});
   assert.equal(await home.locator('[data-event-art]').count(),0);
   assert.equal(await home.locator('.public-home').getAttribute('data-home-event'),null);
   checks.push(`${width}: real admin save/on/off → fresh public homepage; baseline identical; no preview toolbar`);
 }
 for(const width of [360,768,1536]){await admin.setViewportSize({width,height:900});await noOverflow(admin);}
 // Two actual admin tabs race from the same revision; the older tab must explicitly reload.
 await openAdmin();const second=await context.newPage();await second.goto(`${base}/system/home-theme`,{waitUntil:'networkidle'});
 await choose('halloween');assert.equal((await save()).status(),200);
 await choose('halloween',second);assert.equal((await save(second)).status(),409);
 await second.getByRole('alert').filter({hasText:'มีผู้ดูแลเปลี่ยนธีมแล้ว'}).waitFor();
 assert.equal(await second.getByRole('button',{name:'บันทึกธีม',exact:true}).isDisabled(),true);
 await second.getByRole('button',{name:'โหลดค่าล่าสุด'}).click();
 await second.getByText('กำลังแสดง: ฮาโลวีน',{exact:false}).waitFor();
 await choose('default',second);assert.equal((await save(second)).status(),200);await second.close();
 checks.push('real two-tab conflict: 409, no silent overwrite, reload then save');
 // Fault injection only for error/loading presentation; success paths above use real APIs.
 let releaseLoad;
 const loadGate=new Promise(resolve=>{releaseLoad=resolve;});
 await admin.route('**/api/v1/system/home-theme',async route=>{await loadGate;await route.fulfill({status:503,contentType:'application/json',body:'{"message":"synthetic outage"}'});});
 await admin.goto(`${base}/system/home-theme`,{waitUntil:'domcontentloaded'});
 await admin.getByRole('status').filter({hasText:'กำลังโหลด'}).waitFor();
 assert.equal(await admin.getByRole('button',{name:'บันทึกธีม',exact:true}).count(),0);
 releaseLoad();await admin.locator('main [role=alert]').waitFor();await admin.unroute('**/api/v1/system/home-theme');
 await admin.getByRole('button',{name:'ลองโหลดใหม่'}).click();await admin.getByRole('radio',{name:/^ฮาโลวีน/}).waitFor();
 await choose('halloween');
 await admin.route('**/api/v1/system/home-theme',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"message":"synthetic outage"}'}):route.continue());
 assert.equal((await save()).status(),503);await admin.locator('main [role=alert]').waitFor();
 assert.equal(await admin.getByRole('radio',{name:/^ฮาโลวีน/}).isChecked(),true);
 await admin.unroute('**/api/v1/system/home-theme');assert.equal((await save()).status(),200);
 checks.push('loading/retry/failed save preserves choice and real retry succeeds');
 await admin.route('**/api/v1/system/home-theme',route=>route.fulfill({status:403,contentType:'application/json',body:'{"message":"Insufficient permissions."}'}));
 await admin.reload({waitUntil:'networkidle'});await admin.getByRole('alert').filter({hasText:'คุณไม่มีสิทธิ์'}).waitFor();
 assert.equal(await admin.getByRole('button',{name:'บันทึกธีม',exact:true}).count(),0);await admin.unroute('**/api/v1/system/home-theme');
 const denied=await browser.newContext();await denied.addCookies([{name:'watchdog_token',value:tokens.restricted,url:base,httpOnly:true}]);
 const noPermission=await denied.newPage();await noPermission.goto(`${base}/system/home-theme`,{waitUntil:'networkidle'});
 await noPermission.getByRole('heading',{name:'ไม่มีสิทธิ์เข้าถึง'}).waitFor();assert.equal(await noPermission.getByRole('radio').count(),0);assert.equal(await noPermission.getByRole('link',{name:'ธีมหน้าแรก',exact:true}).count(),0);await denied.close();
 await home.goto(`${base}/system/home-theme`,{waitUntil:'domcontentloaded'});assert.match(home.url(),/\/login\?next=/);
 checks.push('real session gate redirects anonymous and denies restricted admin; API 403 removes controls');
 for(const path of ['/privacy','/login']){
   const assets=[];const record=req=>{if(req.url().includes('/home/events/'))assets.push(req.url());};home.on('request',record);
   await home.goto(`${base}${path}`,{waitUntil:'networkidle'});assert.equal(await home.locator('.public-home, [data-event-art], .home-event-effects').count(),0);assert.deepEqual(assets,[]);home.off('request',record);
 }
 await openAdmin();await choose('default');assert.equal((await save()).status(),200);
 checks.push('non-home login/privacy have no theme DOM or assets; final setting normal for regression checks');
 assert.deepEqual(errors,[]);
 writeFileSync(`${dir}browser-results.json`,JSON.stringify({passed:true,checks,pageErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
} finally {await browser.close();}
