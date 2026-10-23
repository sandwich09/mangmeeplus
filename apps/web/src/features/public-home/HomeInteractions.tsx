'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { HOME_CONTACT_URL, HOME_DOCUMENTS, HOME_LINE_URL, HOME_PLANS, homeNumber } from './home-content';

export function HomeMenu() {
  const [open, setOpen] = useState(false);
  return <><button className="menu-btn" type="button" aria-controls="mobile-nav" aria-expanded={open}
    aria-label={open ? 'ปิดเมนู' : 'เปิดเมนู'} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
  </button><nav className="mnav" id="mobile-nav" hidden={!open} aria-label="เมนูมือถือ" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    {[['how', 'วิธีใช้'], ['pricing', 'ราคา'], ['use', 'ใช้ทำอะไรได้'], ['line', 'น้องมั่งมี'], ['faq', 'คำถามที่พบบ่อย']].map(([id, label]) =>
      <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}</a>)}
  </nav></>;
}

function Reel({ signup = false }: { signup?: boolean }) {
  const [paused, setPaused] = useState(false);
  return <div className={signup ? 'reel' : 'stage-phone reel'}>
    <div className="reel-in">
      <img src={`/home/${signup ? 'signup-header' : 'line-chat-header'}.webp`} width="600" height={signup ? 79 : 81} alt="" loading={signup ? 'lazy' : 'eager'} />
      <div className={`reel-screen${signup ? ' su-screen' : ''}`} tabIndex={0} aria-label={signup ? 'ตัวอย่างหน้าเปิดร้านใหม่ เลื่อนดูภาพได้' : 'ตัวอย่างแชต LINE ส่งใบเสร็จ บันทึกสลิป และถามยอด เลื่อนดูภาพได้'}>
        <img className={signup ? 'su-strip' : 'reel-strip'} src={`/home/${signup ? 'signup-form' : 'line-receipt-payment-chat'}.webp`}
          width="600" height={signup ? 2109 : 4699} loading={signup ? 'lazy' : 'eager'}
          alt={signup ? 'หน้าเปิดร้านใหม่: ใส่ชื่อร้านและเบอร์มือถือ' : 'แชต LINE จริง: ส่งใบเสร็จและสลิปให้น้องมั่งมีอ่าน ตรวจรายการ และถามสรุปค่าใช้จ่าย'}
          style={{ animationPlayState: paused ? 'paused' : 'running' }} />
      </div>
      {!signup && <img src="/home/line-chat-input.webp" width="600" height="74" alt="" />}
    </div>
    <button className="reel-toggle" type="button" aria-label={paused ? 'เล่นวิดีโอ' : 'หยุดวิดีโอ'} title={paused ? 'เล่นวิดีโอ' : 'หยุดวิดีโอ'} onClick={() => setPaused(!paused)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d={paused ? 'M8 5v14l11-7z' : 'M6 5h4v14H6zM14 5h4v14h-4z'} /></svg>
    </button>
  </div>;
}
export function ChatReel() { return <Reel />; }
export function SignupReel() { return <figure className="close-phone"><Reel signup /><figcaption>หน้าเปิดร้านจริง กรอกชื่อร้านและเบอร์มือถือ</figcaption></figure>; }

export function HomeAbilityPop({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      element.classList.add('is-visible');
      observer.disconnect();
    }, { threshold: .25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="mm-abilities" ref={root}>{children}</div>;
}

export function DocumentGallery() {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected === null) dialog.current?.close(); else if (!dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const document = selected === null ? null : HOME_DOCUMENTS[selected];
  return <><ul className="docs-row">{HOME_DOCUMENTS.map(([file, title, height, pack], index) => <li key={file}><figure className="home-doc">
    <button type="button" className="doc-paper" onClick={() => setSelected(index)} aria-label={`ขยายภาพ${title}`}>
      <img src={`/home/${file}.webp`} width="900" height={height} alt={`ตัวอย่าง${title}ที่ออกจากระบบมั่งมีพลัส ใส่ข้อมูลตัวอย่าง`} loading="lazy" />
    </button><figcaption><b>{title}</b><span>{pack}</span></figcaption></figure></li>)}</ul>
    <dialog className="home-document-dialog" ref={dialog} aria-label={document ? `ตัวอย่าง${document[1]}` : 'ตัวอย่างเอกสาร'}
      onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <div><button type="button" className="btn btn-soft" onClick={() => setSelected(null)}>ปิดภาพ</button>
        {document && <img src={`/home/${document[0]}.webp`} width="900" height={document[2]} alt={`ตัวอย่าง${document[1]}`} />}
      </div>
    </dialog></>;
}

const CHOOSER_QUESTIONS = [
  { label: 'ในร้านมีคนช่วยจัดการใบเสร็จและค่าใช้จ่ายกี่คน นับตัวเองด้วย', options: ['1 - 2 คน', '3 - 5 คน', '6 - 10 คน', '11 - 30 คน'] },
  { label: 'เดือนหนึ่งร้านมีใบเสร็จประมาณกี่ใบ?', options: ['ไม่เกิน 30 ใบ', '31 - 50 ใบ', '51 - 100 ใบ', '101 - 500 ใบ'] },
  { label: 'ตอนนี้ร้านมีกี่สาขา?', options: ['1 สาขา', '2 สาขา', '3 - 5 สาขา', 'มากกว่า 5 สาขา'] },
  { label: 'ตอนนี้ร้านต้องออกเอกสารหัก ณ ที่จ่าย หรือเตรียมแบบภาษีเองไหม?', options: ['ไม่ต้องทำเอง', 'ต้องทำเอง'] },
];
export function recommendedPlan(answers: number[]) { return Math.max(0, ...answers.slice(0, 3), answers[3] === 1 ? 3 : 0); }

export function HomePricing({ children }: { children?: React.ReactNode }) {
  const [annual, setAnnual] = useState(false), [answers, setAnswers] = useState([-1, -1, -1, -1]);
  const recommendedCard = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = recommendedCard.current;
    if (answers.some(answer => answer < 0) || !card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }, [answers]);
  const answered = answers.some(answer => answer >= 0), chosen = answered ? recommendedPlan(answers) : 3;
  const reasons = answers.slice(0, 3).flatMap((answer, i) => answer < 0 ? [] : [CHOOSER_QUESTIONS[i]!.options[answer]]);
  const badge = !answered ? 'ครบที่สุด ทำเอกสารภาษีได้เอง' : answers[3] === 1 ? 'เหมาะกับงานเอกสารภาษี' : reasons.length ? `เหมาะกับ ${reasons.join(' · ')}` : 'ไม่ต้องทำเอกสารภาษีเอง';
  return <section className="sec" id="pricing" aria-labelledby="pricing-title"><div className="w">
    <div className="pr-head"><div><p className="ey">ราคา</p><h2 id="pricing-title">ราคา <span className="hl">เริ่มเดือนละ 249 บาท</span></h2>
      <p className="lead">งานหลักใช้ได้ทุกแพ็กเกจ เลือกตามจำนวนใบเสร็จ คนในทีม สาขา และงานเอกสารภาษีของร้าน</p></div>
      <div className="seg" role="group" aria-label="รอบการจ่าย">
        <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>จ่ายรายเดือน</button>
        <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>จ่ายรายปี<span className="gift">เท่ากับ 10 เดือน</span></button>
      </div></div>
    <div className="plans">{HOME_PLANS.map((plan, i) => <article key={plan.tier} ref={i === chosen ? recommendedCard : undefined} tabIndex={-1} aria-labelledby={`home-plan-${plan.tier}`} className={`card plan${i === chosen ? ' plan-rec' : ''}`}>
      {i === chosen && <span className="pbadge">{badge}</span>}<h3 className="pname" id={`home-plan-${plan.tier}`}>{plan.name}</h3>
      <p className="pwho">{['ร้านเดียว เจ้าของกับผู้ช่วยอีก 1 คน', 'มีพนักงานช่วยส่งใบเสร็จ', 'มีหลายสาขา ทีมใหญ่ขึ้น', 'ร้านที่ทำเอกสารภาษีเอง'][i]}</p>
      <p className="price">{homeNumber(annual ? plan.annualPrice : plan.monthlyPrice)} <span>บาท / {annual ? 'ปี' : 'เดือน'}</span></p>
      <p className="pay">{annual ? 'จ่ายครั้งเดียว ใช้ได้ทั้งปี' : 'จ่ายรายเดือน'}</p>
      <ul className="dot"><li>อ่านใบเสร็จ {homeNumber(annual ? plan.annualReceipts : plan.monthlyReceipts)} ใบ{annual ? ' ใช้ได้ทั้งปี' : 'ต่อเดือน'}</li>
        <li>ใช้ได้ {plan.users} คน (นับเจ้าของด้วย)</li><li>{plan.branches} สาขา</li><li>{plan.systemTax ? 'ออก 50 ทวิ ภ.ง.ด.3 และ 53 ในระบบ' : 'จด 50 ทวิ ที่ทำนอกระบบได้'}</li></ul>
      <a className={`btn ${i === chosen ? 'btn-primary' : 'btn-soft'}`} href={HOME_LINE_URL} target="_blank" rel="noopener noreferrer" aria-label={`เริ่มใช้งานผ่าน LINE แพ็กเกจ${plan.name} (เปิดแท็บใหม่)`}>เริ่มใช้งานผ่าน LINE</a>
    </article>)}</div>
    <details className="card chooser"><summary><span>หาแพ็กเกจที่เหมาะกับร้านคุณ<small>ตอบ 4 ข้อจากงานที่ร้านทำอยู่จริง</small></span></summary><div className="ch-g">
      {CHOOSER_QUESTIONS.map((question, qi) => <div key={question.label} role="group" aria-label={question.label}><p className="ch-q">{question.label}</p><div className="opts">
        {question.options.map((option, oi) => <button className="opt" type="button" key={option} aria-pressed={answers[qi] === oi} onClick={() => { if (answers[qi] !== oi) setAnswers(answers.map((answer, i) => i === qi ? oi : answer)); }}>{option}</button>)}
      </div></div>)}</div><div className="ch-res" aria-live="polite"><p>{answered ? `แพ็กเกจที่เหมาะกับร้านคุณ: ${HOME_PLANS[chosen]!.name}` : 'เลือกคำตอบด้านบน เพื่อหาแพ็กเกจที่เหมาะกับร้านคุณ'}</p>
      <p className="ch-more">มีผู้ใช้เกิน 30 คน ใบเสร็จเกิน 500 ใบต่อเดือน หรือมากกว่า 10 สาขา <a href={HOME_CONTACT_URL}>ให้ทีมงานช่วยเลือกแพ็กเกจใน LINE</a></p></div></details>
    <div className="pr-note"><div><b>ทุกแพ็กเกจได้</b>น้องมั่งมีใน LINE เบิกเงินคืนพนักงาน ใบรับรองแทนใบเสร็จและลายเซ็น ส่งเอกสารให้นักบัญชี กำหนดสิทธิ์ หน้าสรุปยอดและการเตือน</div>
      <div><b>นับใบเสร็จยังไง</b>นับเมื่อน้องมั่งมีอ่านและบันทึกผลสำเร็จ การแก้ข้อมูลเองใช้ผลอ่านเดิม ดูจำนวนคงเหลือได้ที่แพ็กเกจ</div>
      <div><b>เปิดร้านฟรี</b>ไม่ต้องใส่บัตร พร้อมใช้เมื่อเลือกและจ่ายแพ็กเกจ จ่ายด้วยบัตรหรือพร้อมเพย์ แพ็กเกจที่เลือกในหน้านี้ คุณต้องเลือกอีกครั้งหลังเปิดร้าน</div></div>
    <p className="pr-fine">ราคานี้ยังไม่มี VAT ออกใบเสร็จรับเงินให้</p>
    {children}
  </div></section>;
}
