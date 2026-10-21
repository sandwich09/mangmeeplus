import * as React from 'react';
import { HOME_PLANS, homeNumber } from './home-content';

export function HomePriceComparison() {
  const rows = [
    ['จ่ายรายเดือน', HOME_PLANS.map(p => `${homeNumber(p.monthlyPrice)} บาท`)],
    ['จ่ายรายปี (เท่ากับ 10 เดือน)', HOME_PLANS.map(p => `${homeNumber(p.annualPrice)} บาท`)],
    ['อ่านใบเสร็จต่อเดือน (จ่ายรายเดือน)', HOME_PLANS.map(p => `${homeNumber(p.monthlyReceipts)} ใบ`)],
    ['อ่านใบเสร็จต่อปี (จ่ายรายปี)', HOME_PLANS.map(p => `${homeNumber(p.annualReceipts)} ใบ`)],
    ['คนใช้ (นับเจ้าของด้วย)', HOME_PLANS.map(p => `${p.users} คน`)],
    ['สาขา', HOME_PLANS.map(p => String(p.branches))],
    ['คุยกับน้องมั่งมี', HOME_PLANS.map(() => 'ตามเครดิตของร้าน')],
    ...['ส่งรูปใบเสร็จให้ AI อ่าน ทาง LINE และเว็บ', 'พิมพ์บอกรายจ่ายในแชต ให้น้องกรอกให้',
      'เบิกเงินคืนพนักงาน (ส่ง อนุมัติ จ่ายคืน เซ็นรับ)', 'ใบรับรองแทนใบเสร็จ และลายเซ็น',
      'ส่งเอกสารเป็นชุดให้นักบัญชี', 'กำหนดสิทธิ์ หน้าสรุปยอด และการเตือน'].map(label => [label, HOME_PLANS.map(() => 'มี')] as const),
    ['หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', HOME_PLANS.map(p => p.systemTax ? 'ออกในระบบ' : 'จดเลขที่ใบที่ทำนอกระบบ แนบรูปหรือ PDF ได้')],
    ['แบบ ภ.ง.ด.3 และ ภ.ง.ด.53', HOME_PLANS.map(p => p.systemTax ? 'เตรียมแบบพร้อมใบแนบ' : 'ไม่มี')],
  ] as const;
  return <><div className="cmp-box"><h3>เทียบทุกแพ็กเกจ</h3><div className="tbl" role="region" aria-label="ตารางเทียบแพ็กเกจ เลื่อนซ้ายขวาได้" tabIndex={0}>
    <table className="cmp"><caption>ราคาปกติ ถ้าจ่ายรายปี ได้ใบเสร็จเป็นก้อนเดียว ใช้ได้ทั้งปี</caption>
      <thead><tr><th scope="col">สิ่งที่ได้</th>{HOME_PLANS.map(p => <th key={p.tier} scope="col">{p.name}</th>)}</tr></thead>
      <tbody>{rows.map(([label, values]) => <tr key={label}><th scope="row">{label}</th>{values.map((value, i) => <td key={i}>{value === 'มี' ? <><span className="sr">มี</span><svg className="ic" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></> : value}</td>)}</tr>)}</tbody>
    </table></div></div>
    <div className="next"><div><h3>กดปุ่มแล้วเป็นยังไงต่อ</h3><p className="lead">4 ขั้น ตั้งแต่กดปุ่มจนส่งใบเสร็จใบแรก ตอนสมัครไม่ต้องใส่บัตร</p></div>
      <ol className="steps4">{[
        ['เพิ่มเพื่อน LINE มั่งมีพลัส', 'เลือกทางสมัครที่เปิดอยู่'],
        ['ใส่ชื่อร้านกับเบอร์มือถือ', 'บางร้านทีมงานมั่งมีขอตรวจก่อนเปิดให้'],
        ['เปิดร้านแล้วเลือกแพ็กเกจ', 'เลือกจ่ายรายเดือนหรือรายปี'],
        ['จ่ายด้วยบัตรหรือพร้อมเพย์', 'แล้วส่งใบเสร็จใบแรกให้น้องมั่งมี'],
      ].map(([title, detail], i) => <li key={title}><span className="sn">{i + 1}</span><span>{title}<small>{detail}</small></span></li>)}</ol>
    </div></>;
}
