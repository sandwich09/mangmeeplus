'use client';
import { BILLING_PAID_TIERS, billingOffer, type BillingPolicy } from '@watchdog-bms/contracts';

export default function BillingOfferTermsEditor({policy,onChange}:{policy:BillingPolicy;onChange:(policy:BillingPolicy)=>void}) {
  return <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">ราคาและสิทธิ์ของแพ็กเกจ</summary>
    <p className="my-3">ใช้กับรายการซื้อที่ยืนยันตามค่าชุดใหม่ รายปีได้ใบเสร็จ 12 เท่าทันที จำนวนเดิมที่ลูกค้าซื้อไว้ไม่ลดลง</p>
    <div className="grid gap-4 sm:grid-cols-3">{BILLING_PAID_TIERS.map(tier=>{
      const monthly=billingOffer(tier,'month',policy),yearly=billingOffer(tier,'year',policy);
      const terms={monthlyPriceSatang:monthly.priceSatang,annualPriceSatang:yearly.priceSatang,monthlyReceiptAllowance:monthly.monthlySlipLimit,
        branchLimit:monthly.branchLimit,employeeLimit:monthly.employeeLimit};
      return <fieldset key={tier} className="space-y-3 rounded-lg bg-gray-50 p-3"><legend className="font-bold">{monthly.label}</legend>
        {([['monthlyPriceSatang','ราคารายเดือน (บาท)'],['annualPriceSatang','ราคารายปี (บาท)'],['monthlyReceiptAllowance','ใบเสร็จที่ได้เมื่อซื้อรายเดือน'],['branchLimit','จำนวนสาขาสูงสุด'],['employeeLimit','จำนวนผู้ใช้สูงสุด รวมเจ้าของ']] as const).map(([key,label])=>{
          const count=key!=='monthlyPriceSatang'&&key!=='annualPriceSatang',receipt=key==='monthlyReceiptAllowance';
          return <label key={key} className="block">{label}<input aria-label={`${monthly.label} · ${label}`} className="mt-1 block min-h-11 w-full rounded-lg border bg-white p-2" inputMode={count?'numeric':'decimal'} required
            defaultValue={count?String(terms[key]):(terms[key]/100).toFixed(2)} onChange={e=>{
              const value=e.target.value.trim(),parts=value.split('.');
              const amount=count?(/^\d+$/.test(value)?Number(value):NaN):(/^\d{1,6}(?:\.\d{1,2})?$/.test(value)?Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0')):NaN);
              const valid=Number.isSafeInteger(amount)&&amount>=(count?1:1000)&&amount<=(count?(receipt?Math.floor(2147483647/12):1000):99999999);
              e.target.setCustomValidity(valid?'':count?(receipt?'กรอกจำนวนเต็มตั้งแต่ 1 ถึง 178,956,970 ใบ':'กรอกจำนวนเต็มตั้งแต่ 1 ถึง 1,000'):'กรอกราคาตั้งแต่ 10 ถึง 999,999.99 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง');
              if(valid)onChange({...policy,offerTerms:{...policy.offerTerms,[tier]:{...terms,[key]:amount}}});
            }}/></label>;})}
        <p>ซื้อรายปีได้ {yearly.receiptAllowance.toLocaleString('th-TH')} ใบทันที</p>
        <p>{monthly.branchLimit} สาขา · {monthly.employeeLimit} บัญชีรวมเจ้าของ</p>
      </fieldset>;
    })}</div>
    <p className="mt-3">ราคา Stripe ต้องตรงกับราคาที่กรอกก่อนขออนุมัติ ตรวจยอดรวมภาษีและสิทธิ์ก่อน–หลังในหน้าผลกระทบ</p>
    <p className="mt-3">ลูกค้าเดิมไม่ถูกลดเพดานอัตโนมัติ เมื่อซื้อซ้ำหรืออัปเกรดจะคงเพดานเดิมที่สูงกว่าไว้ การลดแพ็กเกจใช้ขั้นตอนเลือกสาขาและผู้ใช้เมื่อสิ้นรอบ</p>
  </details>;
}
