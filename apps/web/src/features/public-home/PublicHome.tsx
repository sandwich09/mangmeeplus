import * as React from 'react';
import { HomePricing, HomeMenu, ChatReel, SignupReel, DocumentGallery, HomeAbilityPop } from './HomeInteractions';
import { HomeSignupSteps } from './HomeSignupSteps';
import { HomeReceiptStory } from './HomeReceiptStory';
import { HOME_FAQ, HOME_JSON_LD } from './home-content';
import { DEFAULT_HOME_EVENT_PALETTE, HomeEventArtwork, HomeEventPreviewTools, type HomeEvent, type HomeEventPalette } from './HomeEventTheme';
import { HomeEventEffects } from './HomeEventEffects';
import { HomeHalloweenActivities } from './HomeHalloweenActivities';

function HomeFaq() { return <div className="faq">{HOME_FAQ.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>; }

export function HomeStructuredData({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_JSON_LD).replace(/</g, '\\u003c') }} />;
}

export function PublicHome({ event = 'default', preview = false, palette = DEFAULT_HOME_EVENT_PALETTE }: { event?: HomeEvent; preview?: boolean; palette?: HomeEventPalette }) { return <div className="public-home" data-home-event={event === 'default' ? undefined : event} data-home-palette={event === 'halloween' ? palette : undefined}>
{preview && <HomeEventPreviewTools event={event} palette={palette} />}
{event === 'halloween' && <HomeEventEffects />}
<div className="pg">
<a className="skip" href="#main">ข้ามไปเนื้อหาหลัก</a>
<header className="hdr">
<div className="w">
<div className="hdr-row">
<a className="brand" href="#top" aria-label="มั่งมีพลัส หน้าแรก">
<svg aria-hidden="true" width="30" height="28" viewBox="0 0 30 28" fill="none"><rect x="0" y="16" width="5.5" height="12" rx="2.75" fill="#4ADE80"></rect><rect x="8" y="10.5" width="5.5" height="17.5" rx="2.75" fill="#16A34A"></rect><rect x="16" y="5.5" width="5.5" height="22.5" rx="2.75" fill="#22C55E"></rect><rect x="24" y="0" width="5.5" height="28" rx="2.75" fill="#F59E0B"></rect></svg>
<span>มั่งมี<span className="plus">พลัส</span><small>MANGMEEPLUS</small></span>
</a>
<nav className="nav" aria-label="เมนูหลัก">
<a href="#how">วิธีใช้</a>
<a href="#pricing">ราคา</a>
<a href="#use">ใช้ทำอะไรได้</a>
<a href="#line">น้องมั่งมี</a>
<a href="#faq">คำถามที่พบบ่อย</a>
</nav>
<div className="hdr-act">
<a className="login" href="/login">เข้าสู่ระบบ</a>
<a className="btn btn-soft btn-sm" href="https://lin.ee/U5oRBx1" target="_blank" rel="noopener">เริ่มใช้งานผ่าน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a>
<HomeMenu /></div></div></div></header>

<main id="main">
<section className="hero dark" id="top" aria-labelledby="hero-title">
<HomeEventArtwork event={event} placement="hero" />
<div className="orb orb-a" aria-hidden="true"></div><div className="orb orb-b" aria-hidden="true"></div>
<div className="w hero-c">
<p className="kicker">มั่งมี Plus ส่งรูปใบเสร็จทาง LINE <span className="nw">ให้น้องมั่งมีช่วยอ่าน</span></p>
<h1 id="hero-title">ขายได้ทุกวัน <span>แต่จ่ายไปเท่าไร<span className="nw">ไม่รู้?</span></span></h1>
<p className="lead">เงินที่ขายได้ถูกหมุนจ่ายทุกวัน ใบเสร็จกองไว้<span className="nw">ไม่มีเวลาจด</span> สิ้นเดือนเงินหายไป<span className="nw">เหมือนตกหลุม</span> มั่งมีพลัสช่วยให้เห็น<span className="nw">ทุกบาทที่จ่ายออก</span></p>
<div className="acts">
<a className="btn btn-primary btn-lg" href="https://lin.ee/U5oRBx1" target="_blank" rel="noopener">เริ่มใช้งานผ่าน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a>
<a className="btn btn-soft btn-lg" href="#pricing">ดูราคา</a>
</div>
<p className="after"><span className="free">เปิดร้านฟรี</span> <span className="nw">ไม่ต้องใส่บัตร</span><br />กดแล้วเข้า LINE ใส่ชื่อร้านกับ<span className="nw">เบอร์มือถือ</span> พร้อมใช้เมื่อเลือกและจ่าย<span className="nw">แพ็กเกจ</span> เริ่ม<span className="mangmee-unit">เดือนละ 249 บาท</span></p>
{event === 'halloween' && <HomeHalloweenActivities />}
</div>
<div className="w">
<figure className="stage">
<HomeEventArtwork event={event} placement="stage" />
<div className="dash" role="img" aria-label="ตัวอย่างหน้าเว็บสรุปรายจ่ายของร้าน: รายจ่ายเดือนนี้ 48,250 บาท ใบเสร็จรอตรวจ 4 ใบ ค้างจ่ายทั้งหมด 12,480 บาท และกราฟรายจ่ายรายเดือน">
<div className="dash-bar"><i></i><i></i><i></i><span>mangmeeplus.com</span></div>
<img className="dash-shot" src="/home/spending-dashboard.webp" width="1200" height="750" alt="ตัวอย่างหน้าสรุปรายจ่ายของร้าน" />
</div>
<ChatReel />
<img className="mascot hv-mascot stage-mascot" src="/home/mangmee-scanning.webp" width="302" height="193" alt="น้องมั่งมีช่วยสแกนใบเสร็จ" />
</figure>
</div>
<div className="marquee" role="region" tabIndex={0} aria-label="ความสามารถหลัก เลื่อนซ้ายขวาได้"><div className="mq-track"><ul><li>น้องมั่งมีอ่านใบเสร็จ</li><li>ส่งผ่าน LINE</li><li>พิมพ์บอกรายจ่ายในแชต</li><li>เบิกเงินคืนพนักงาน</li><li>ใบรับรองแทนใบเสร็จ</li><li>เซ็นรับในระบบ</li><li>ส่งเอกสารให้นักบัญชี</li><li>หน้าสรุปยอด</li><li>เลือกช่วงวันที่เอง</li><li>กำหนดสิทธิ์รายคน</li><li>50 ทวิ</li><li>ภ.ง.ด.3</li><li>ภ.ง.ด.53</li></ul><ul aria-hidden="true"><li>น้องมั่งมีอ่านใบเสร็จ</li><li>ส่งผ่าน LINE</li><li>พิมพ์บอกรายจ่ายในแชต</li><li>เบิกเงินคืนพนักงาน</li><li>ใบรับรองแทนใบเสร็จ</li><li>เซ็นรับในระบบ</li><li>ส่งเอกสารให้นักบัญชี</li><li>หน้าสรุปยอด</li><li>เลือกช่วงวันที่เอง</li><li>กำหนดสิทธิ์รายคน</li><li>50 ทวิ</li><li>ภ.ง.ด.3</li><li>ภ.ง.ด.53</li></ul></div></div>
</section>

<section className="sec alt" id="how" aria-labelledby="how-title">
<div className="w">
<ul className="stats card card-hi"><li><b><span className="sr">249</span><span className="count" aria-hidden="true" style={{"--to": "249"} as React.CSSProperties}></span></b><span className="u">บาท/เดือน</span><small>ราคาเริ่มต้น</small></li><li><b><span className="sr">500</span><span className="count" aria-hidden="true" style={{"--to": "500"} as React.CSSProperties}></span></b><span className="u">ใบ/เดือน</span><small>เมื่อจ่ายรายเดือน</small></li><li><b><span className="sr">30</span><span className="count" aria-hidden="true" style={{"--to": "30"} as React.CSSProperties}></span></b><span className="u">คน</span><small>ในแพ็กเกจธุรกิจ</small></li><li><b>LINE</b><span className="u">ผู้ช่วยในแชต</span><small>ตามสิทธิ์และเครดิตของร้าน</small></li></ul>
<div className="head">
<p className="ey">วิธีใช้</p>
<h2 id="how-title">ส่งรูปใบเสร็จทาง LINE ให้น้องมั่งมีช่วยอ่าน <span className="hl">ไม่ต้องจดเอง ทำได้ทุกที่</span></h2>
<p className="lead">พนักงานส่งรูปใบเสร็จในแชต น้องมั่งมีกรอกรายการให้ คุณแค่ตรวจแล้วกดยืนยัน จากมือถือ อยู่ที่ไหนก็ทำได้ ใช้ง่ายแค่ 3 ขั้น</p>
</div>
<ol className="steps3">
<li className="card"><div className="st-top"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle></svg><span className="ico-n" aria-hidden="true">1</span></span><span className="who">พนักงาน หรือคุณ</span></div><h3>ถ่ายรูปใบเสร็จ ส่งใน LINE</h3><p>ส่งรูปหรือ PDF ทีละหลายใบได้ หรืออัปโหลดบนเว็บก็ได้</p></li>
<li className="card"><div className="st-top"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M11 3l1.9 5 5 1.9-5 1.9L11 17l-1.9-5.2L4 9.9l5.1-1.9z"></path><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"></path></svg><span className="ico-n" aria-hidden="true">2</span></span><span className="who">น้องมั่งมี</span></div><h3>น้องมั่งมีอ่าน แล้วกรอกให้</h3><p>ได้เป็นร่าง คือรายการที่ยังไม่บันทึกจริง สถานะ “รอตรวจสอบ”</p></li>
<li className="card"><div className="st-top"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.7 2.7L16 10"></path></svg><span className="ico-n" aria-hidden="true">3</span></span><span className="who who-you">คุณ</span></div><h3>ตรวจ แก้ แล้วกดยืนยัน</h3><p>ดูเทียบกับรูปใบเสร็จ แก้ตรงที่ผิด แล้วกดยืนยัน ทำในแชตหรือบนเว็บ จากที่ไหนก็ได้</p></li>
</ol>
<div className="card fix">
<div>
<h3>น้องมั่งมีอ่านผิดได้ คุณแก้ได้ก่อนยืนยัน</h3>
<p>รูปเบลอ ใบเสร็จยับ หรือลายมือ อาจทำให้อ่านผิด น้องมั่งมีไม่กดยืนยันแทนคุณ</p>
</div>
<div className="fix-r">
<div className="field"><small>ยอดที่น้องมั่งมีอ่านได้</small><span className="num wrong">1,234.00 บาท</span><span className="tag-wrong">อ่านผิด</span></div>
<div className="field"><small>คุณแก้ตามรูปจริง</small><span className="num">1,284.00 บาท</span></div>
<span className="status status-ok">ยืนยันแล้ว</span>
</div>
</div>
</div>
</section>

<HomePricing><HomeSignupSteps /></HomePricing>

<section className="sec dark-sec dark" id="use" aria-labelledby="use-title">
{palette === 'plum' && <HomeEventArtwork event={event} placement="middle" />}
<div className="w">
<div className="head">
<p className="ey">ใช้ทำอะไรได้</p>
<h2 id="use-title">3 งานเรื่องเงินที่ร้านทำ<span className="nw hl">ทุกเดือน</span></h2>
<p className="lead">งานหลักใช้ได้ทุกแพ็กเกจ เอกสารภาษีในระบบใช้แพ็กเกจธุรกิจ</p>
</div>
<div className="bento">
<article className="card job">
<span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6M9 16h3"></path></svg></span>
<h3>บันทึกค่าใช้จ่ายของร้าน</h3>
<ul className="dot">
<li>ส่งรูปใบเสร็จทาง LINE หรือเว็บ</li>
<li>พิมพ์บอกในแชต เช่น “ค่าน้ำมัน 500”</li>
<li>ดูยอดวันนี้ เดือนนี้ หรือเลือกช่วงวันเอง</li>
</ul>
</article>
<article className="card job">
<span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"></circle><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"></path><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c1.8.8 3 2.9 3 5.6"></path></svg></span>
<h3>เบิกเงินคืนให้พนักงาน</h3>
<ol className="chain" aria-label="ขั้นตอนเบิกเงินคืน"><li>1 ส่งใบเบิก</li><li>2 อนุมัติ</li><li>3 จ่ายเงินคืน</li><li>4 เซ็นรับ</li></ol>
<ul className="dot">
<li>ร้านจ่ายเงินคืนเอง แล้วบันทึกในระบบ</li>
<li>เซ็นรับในระบบ หรือเซ็นกระดาษแล้วแนบไฟล์</li>
</ul>
</article>
<article className="card job">
<span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M8 13h8"></path></svg></span>
<h3>เก็บเอกสารให้นักบัญชี</h3>
<ul className="dot">
<li>เก็บรูปใบเสร็จตัวจริงไว้ดูย้อนหลัง</li>
<li>ส่งออกเอกสารเป็นชุด ส่งต่อให้นักบัญชี</li>
<li>ใบรับรองแทนใบเสร็จ และจด 50 ทวิ ที่ทำนอกระบบ</li>
</ul>
</article>
<div className="card card-hi mm" id="line">
<div className="mm-id">
<p className="ey">ผู้ช่วยใน LINE</p>
<h3>รู้จักน้องมั่งมี ผู้ช่วย AI ในแชต LINE</h3>
<p>อ่านใบเสร็จ กรอกรายการให้ และตอบเรื่องค่าใช้จ่าย แต่ละคนเห็นเฉพาะข้อมูลที่ได้รับสิทธิ์</p>
</div>
<HomeReceiptStory />
<details className="mm-more"><summary>ดูความสามารถทั้งหมดของน้องมั่งมี</summary><div className="mm-more-grid">
<HomeAbilityPop>
<h4>น้องมั่งมีทำอะไรได้</h4>
<ul className="dot">
<li>ส่งรูปหรือ PDF ทีละหลายใบได้ น้องอ่านให้ทีละใบ</li>
<li>แก้รายการในแชตได้ บันทึกเมื่อคุณกดยืนยันเท่านั้น</li>
<li>ตอบยอดเงิน เทียบเดือน และงานค้าง ตามสิทธิ์ของคนถาม</li>
<li>บอกใบเบิกที่รออนุมัติ และช่วยกรอกใบเบิกในแชตส่วนตัว</li>
<li>เตือนใน LINE เมื่อมีงานรออนุมัติ</li>
</ul>
</HomeAbilityPop>
<div>
<h4>ควรรู้ก่อนใช้</h4>
<ul className="dot">
<li>ตอบเฉพาะข้อมูลที่คนถามมีสิทธิ์ดู</li>
<li>คุยถามน้องตามเครดิตที่ร้านมี</li>
<li>ตอบเป็นไทย ถ้าพิมพ์อังกฤษ น้องตอบอังกฤษ</li>
</ul>
</div>
<div className="asks">
<h4>ร้านถามน้องแบบนี้</h4>
<ul><li>เดือนนี้จ่ายไปเท่าไหร่แล้วคะ</li><li>จ่ายร้านไหนเยอะสุดคะ</li><li>แยกตามหมวดให้ดูหน่อยค่ะ</li><li>เทียบกับเดือนที่แล้วเป็นยังไงบ้างคะ</li><li>มีใบเบิกรออนุมัติไหมคะ</li><li>วันนี้มีอะไรต้องเคลียร์บ้างคะก่อนปิดร้าน</li></ul>
<p>ตัวอย่างจากคำถามที่ใช้คุยกับน้องมั่งมี</p>
</div>
</div></details>
</div>
<div className="card card-hi ent dark">
<div className="ent-g"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"></path><path d="M14 3v4h4M10 12h5M10 16h5"></path></svg></span><div>
<p className="tag">แพ็กเกจธุรกิจ <span className="mangmee-unit">เดือนละ 1,999 บาท</span></p>
<h3>ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) และเตรียมแบบ ภ.ง.ด.3 กับ ภ.ง.ด.53 ได้ในระบบ</h3>
<p>ภ.ง.ด.3 สำหรับจ่ายให้บุคคล ภ.ง.ด.53 สำหรับจ่ายให้บริษัท ได้เป็นแบบฟอร์มพร้อมใบแนบ พิมพ์ไปยื่นเอง ระบบไม่ได้ยื่นภาษีแทน</p>
<ul className="ent-docs" aria-label="เอกสารที่ออกได้"><li>50 ทวิ</li><li>ภ.ง.ด.3</li><li>ภ.ง.ด.53</li></ul>
<dl className="ent-stats"><div><dt>อ่านใบเสร็จ</dt><dd><span className="mangmee-unit">500 ใบ</span></dd></div><div><dt>ใช้ได้</dt><dd><span className="mangmee-unit">30 คน</span></dd></div><div><dt>สาขา</dt><dd><span className="mangmee-unit">10 สาขา</span></dd></div></dl>
</div>
</div>
<a className="btn btn-light" href="#pricing">ดูแพ็กเกจธุรกิจ</a>
</div>
</div>
<div className="docs">
<div className="docs-head"><h3>เอกสารที่ออกจากระบบ</h3><p>ระบบทำเอกสารให้จากรายการที่ยืนยันแล้ว พิมพ์หรือส่งต่อนักบัญชีได้เลย กดที่ภาพเพื่อดูเต็ม</p></div>
<DocumentGallery />
</div>
</div>
</section>

<section className="sec" id="trust" aria-labelledby="trust-title">
<div className="w">
<div className="head">
<p className="ey">เชื่อใจได้แค่ไหน</p>
<h2 id="trust-title">น้องมั่งมีช่วยกรอก คุณเป็นคนตัดสิน</h2>
<p className="lead">มั่งมีพลัสไม่ได้มาแทนนักบัญชี เราช่วยให้ข้อมูลครบ และย้อนดูได้</p>
</div>
<div className="roles">
<div className="card role"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M11 3l1.9 5 5 1.9-5 1.9L11 17l-1.9-5.2L4 9.9l5.1-1.9z"></path><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"></path></svg></span><h3>น้องมั่งมี</h3><ul className="dot"><li>อ่านรูปใบเสร็จ</li><li>กรอกรายการไว้ให้ตรวจ</li><li>ตอบคำถามในแชตตามสิทธิ์</li></ul></div>
<div className="card role"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"></circle><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"></path><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c1.8.8 3 2.9 3 5.6"></path></svg></span><h3>คุณและทีม</h3><ul className="dot"><li>ตรวจ แก้ และกดยืนยัน</li><li>อนุมัติใบเบิก และบันทึกการจ่ายเงินคืน</li><li>กำหนดว่าใครเห็นอะไร</li></ul></div>
<div className="card role"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8 7h8M8 11h1M12 11h1M16 11h0M8 15h1M12 15h1M16 15h0"></path></svg></span><h3>นักบัญชีของร้าน</h3><ul className="dot"><li>ใช้ข้อมูลและเอกสารทำบัญชี</li><li>ตรวจให้ถูกตามกฎหมาย</li><li>ยื่นภาษีตามหน้าที่ของร้าน</li></ul></div>
</div>
<div className="safe">
<div className="safe-head"><h3>ข้อมูลร้านปลอดภัย</h3><p>คุณกำหนดได้ว่าใครเห็นข้อมูลร้าน และตรวจรายการที่น้องมั่งมีช่วยกรอกได้ก่อนบันทึกจริง</p></div>
<div className="safe-g">
<div className="safe-i safe-provider"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"></path></svg></span><div><h4>ผู้ให้บริการเดียวกับ<span className="nw hl">ธนาคารชั้นนำ</span></h4><p>มั่งมีพลัสใช้ AWS ของ Amazon เพื่อให้ระบบทำงานและเก็บไฟล์ใบเสร็จของร้าน เป็นบริการคลาวด์ที่ธนาคารและบริษัทชั้นนำทั่วโลกเลือกใช้</p></div></div>
<div className="safe-i"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg></span><div><h4>ปกป้องข้อมูลและรหัสผ่านของคุณ</h4><p>ข้อมูลระหว่างคุณกับระบบถูกเข้ารหัสเพื่อป้องกันการแอบอ่าน ส่วนรหัสผ่านเก็บในรูปแบบที่แม้แต่ทีมงานก็อ่านไม่ได้</p></div></div>
<div className="safe-i"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"></circle><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"></path><path d="M17 11l2 2 3-3.5"></path></svg></span><div><h4>คุณเลือกได้ว่าใครเห็นข้อมูลร้าน</h4><p>กำหนดให้พนักงานเห็นข้อมูลและทำรายการได้ตามหน้าที่ ทั้งบนเว็บและใน LINE ระบบเก็บประวัติรายการสำคัญไว้ตรวจสอบ</p></div></div>
<div className="safe-i"><span className="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M11 3l1.9 5 5 1.9-5 1.9L11 17l-1.9-5.2L4 9.9l5.1-1.9z"></path></svg></span><div><h4>คุณตรวจได้ก่อนบันทึกจริง</h4><p>น้องมั่งมีช่วยอ่านใบเสร็จด้วยบริการของ Amazon แล้วเตรียมรายการให้คุณตรวจ แก้ไข และกดยืนยัน ไม่กดยืนยันแทนคุณ</p></div></div>
</div>
</div>
<p className="who-box"><span><b>ผู้ให้บริการ</b> บริษัท มั่งมียั่งยืน จำกัด</span><span><b>อีเมล</b> <a href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a></span><span><b>โทร</b> <a className="mangmee-unit" href="tel:0982565628">098-256-5628</a></span><span><b>LINE</b> <a href="https://line.me/R/ti/p/@695ultfm" target="_blank" rel="noopener">@mangmeeplus<span className="sr"> (เปิดแท็บใหม่)</span></a></span><span><a href="/privacy">นโยบายความเป็นส่วนตัว</a></span></p>
</div>
</section>

<section className="sec alt" id="faq" aria-label="สรุปและคำถามที่พบบ่อย">
<HomeEventArtwork event={event} placement="faq" />
<div className="w faq-g">
<div id="what">
<p className="ey">รู้จักใน 1 นาที</p>
<h2>มั่งมีพลัสคืออะไร</h2>
<p className="answer">มั่งมีพลัส (มั่งมี Plus หรือ MangmeePlus) คือโปรแกรมช่วยร้านและธุรกิจเล็กในไทยเก็บใบเสร็จและค่าใช้จ่าย พนักงานถ่ายรูปใบเสร็จส่งให้น้องมั่งมี ผู้ช่วยใน LINE น้องอ่านแล้วกรอกรายการไว้ให้ เจ้าของร้านหรือคนที่ได้รับสิทธิ์ตรวจ แก้ และกดยืนยันเอง ระบบยังช่วยเรื่องเบิกเงินคืนพนักงาน และเก็บเอกสารไว้ส่งนักบัญชี</p>
<dl className="card qf">
<div><dt>เหมาะกับ</dt><dd>ร้านที่มีใบเสร็จทุกวัน หรือมีพนักงานสำรองจ่ายไปก่อน</dd></div>
<div><dt>ราคา</dt><dd>เดือนละ <span className="nw">249 - 1,999</span> บาท มี 4 แพ็กเกจ</dd></div>
<div><dt>เปิดร้าน</dt><dd>ฟรี ไม่ต้องใส่บัตร จ่ายเมื่อเลือกแพ็กเกจ</dd></div>
<div><dt>ผู้ให้บริการ</dt><dd>บริษัท มั่งมียั่งยืน จำกัด</dd></div>
</dl>
</div>
<div>
<p className="ey">คำถามที่พบบ่อย</p>
<h2>คำถามที่คนถามบ่อย</h2>
<HomeFaq />
<p className="ask">ไม่เจอคำตอบ <a href="https://line.me/R/ti/p/@695ultfm" target="_blank" rel="noopener">ทักถามทีมงานใน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a> หรือส่งอีเมล <a href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a></p>
</div>
</div>
</section>

<section className="sec" aria-labelledby="close-title">
<div className="w">
<div className="close dark">
<div>
<h2 id="close-title">เริ่มจากใบเสร็จใบต่อไป</h2>
<p>เข้า LINE ใส่ชื่อร้านกับเบอร์มือถือ เลือกแพ็กเกจ แล้วส่งใบเสร็จใบแรกให้น้องมั่งมี</p>
</div>
<div>
<a className="btn btn-light btn-lg" href="https://lin.ee/U5oRBx1" target="_blank" rel="noopener">เริ่มใช้งานผ่าน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a>
<a className="btn btn-glass btn-lg" href="https://line.me/R/ti/p/@695ultfm" target="_blank" rel="noopener">คุยกับทีมงานก่อน<span className="sr"> (เปิดแท็บใหม่)</span></a>
<p className="fine">เปิดร้านฟรี เริ่มใช้<span className="mangmee-unit">เดือนละ 249 บาท</span></p>
</div>
<SignupReel />
</div>
</div>
</section>
</main>

<footer className="foot">
<HomeEventArtwork event={event} placement="footer" />
<div className="w">
<div className="foot-g">
<div>
<a className="brand" href="#top" aria-label="มั่งมีพลัส กลับขึ้นด้านบน" style={{"padding": "0"} as React.CSSProperties}><svg aria-hidden="true" width="27.9" height="26" viewBox="0 0 30 28" fill="none"><rect x="0" y="16" width="5.5" height="12" rx="2.75" fill="#4ADE80"></rect><rect x="8" y="10.5" width="5.5" height="17.5" rx="2.75" fill="#16A34A"></rect><rect x="16" y="5.5" width="5.5" height="22.5" rx="2.75" fill="#22C55E"></rect><rect x="24" y="0" width="5.5" height="28" rx="2.75" fill="#F59E0B"></rect></svg><span>มั่งมี<span className="plus">พลัส</span></span></a>
<p>มั่งมีพลัส (มั่งมี Plus) โปรแกรมช่วยร้านเก็บใบเสร็จและค่าใช้จ่ายผ่าน LINE<br />ดูแลโดย บริษัท มั่งมียั่งยืน จำกัด</p>
<p className="social-h">ติดตามมั่งมี Plus</p><div className="social"><a href="https://www.facebook.com/share/17k2DsH7TJ/" target="_blank" rel="noopener" aria-label="Facebook Mangmee Plus (เปิดแท็บใหม่)"><img src="/home/facebook.webp" width="44" height="44" alt="" loading="lazy" /></a><a href="https://www.instagram.com/mangmee_plus" target="_blank" rel="noopener" aria-label="Instagram @mangmee_plus (เปิดแท็บใหม่)"><img src="/home/instagram.webp" width="44" height="44" alt="" loading="lazy" /></a><a href="https://www.tiktok.com/@mangmee_plus" target="_blank" rel="noopener" aria-label="TikTok @mangmee_plus (เปิดแท็บใหม่)"><img src="/home/tiktok.webp" width="44" height="44" alt="" loading="lazy" /></a><a className="social-line" href="https://line.me/R/ti/p/@695ultfm" target="_blank" rel="noopener" aria-label="คุยกับทีมงานใน LINE @mangmeeplus (เปิดแท็บใหม่)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6c-5 0-9 3.2-9 7.1 0 3.5 3.2 6.5 7.5 7 .3.1.7.2.8.5.1.2.1.6 0 .8l-.1.8c0 .2-.2.9.8.5s5.4-3.2 7.4-5.4c1.4-1.5 2.1-3 2.1-4.2 0-3.9-4-7.1-9-7.1z" fill="#fff"></path><text x="12" y="12.7" textAnchor="middle" fontSize="5.3" fontWeight="800" fill="#06C755" fontFamily="Arial, Helvetica, sans-serif">LINE</text></svg></a></div>
</div>
<nav aria-label="รู้จักมั่งมีพลัส"><h3>รู้จักมั่งมีพลัส</h3><a href="#how">วิธีใช้</a><a href="#pricing">ราคา</a><a href="#use">ใช้ทำอะไรได้</a><a href="#line">น้องมั่งมี</a><a href="#faq">คำถามที่พบบ่อย</a></nav>
<nav aria-label="สำหรับลูกค้า"><h3>สำหรับลูกค้า</h3><a href="/login">เข้าสู่ระบบ</a><a href="https://lin.ee/U5oRBx1" target="_blank" rel="noopener">เริ่มใช้งานผ่าน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a></nav>
<div><h3>ติดต่อทีมงานมั่งมี</h3><a href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a><a className="mangmee-unit" href="tel:0982565628">098-256-5628</a><a href="https://line.me/R/ti/p/@695ultfm" target="_blank" rel="noopener">LINE @mangmeeplus<span className="sr"> (เปิดแท็บใหม่)</span></a></div>
</div>
<div className="foot-b">
<span>© 2026 บริษัท มั่งมียั่งยืน จำกัด</span>
<span><a href="/privacy">นโยบายความเป็นส่วนตัว</a> · <a href="/terms">เงื่อนไขการใช้งาน</a></span>
</div>
</div>
</footer>

<div className="mbar" role="region" aria-label="เริ่มใช้งาน">
<a className="btn btn-primary" href="https://lin.ee/U5oRBx1" target="_blank" rel="noopener">เริ่มใช้งานผ่าน LINE<span className="sr"> (เปิดแท็บใหม่)</span></a>
<span>เปิดร้านฟรี<br />ไม่ต้องใส่บัตร</span>
</div>
</div>

</div>; }
