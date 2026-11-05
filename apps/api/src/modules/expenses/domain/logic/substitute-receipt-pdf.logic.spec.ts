import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS } from '@watchdog-bms/contracts';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { DISBURSEMENT_VOUCHER_PRINT_SPACING, renderDisbursementVoucherSvg } from './disbursement-voucher-pdf.logic';
import {
  planSubstituteReceiptRasterSlices,
  renderSubstituteReceiptPaperArtifactPdf,
  renderSubstituteReceiptPdf,
  renderSubstitutePaperPreviewPages,
  substituteWetSignedScanRejection,
  SUBSTITUTE_RECEIPT_PDF_LIMITS,
} from './substitute-receipt-pdf.logic';
import {
  buildSubstituteCertificationText,
  fitToWidth,
  renderSubstituteReceiptSvg,
  type SubstituteReceiptSnapshot,
} from './substitute-receipt.logic';

const thaiSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="850" height="180" viewBox="0 0 850 180">
    <rect width="850" height="180" fill="#fff"/>
    <g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">
      <text x="425" y="70" text-anchor="middle" font-size="25" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text>
      <text x="425" y="120" text-anchor="middle" font-size="18">เลขที่ SRC-EXP-0142-V1 · version 1</text>
    </g>
  </svg>
`);
const requireFromWorkspace = createRequire(join(process.cwd(), 'package.json'));

describe('disbursement voucher printed document', () => {
  const snapshot = (patch: any = {}) => ({ company: { name: 'บริษัททดสอบ', taxId: '0123456789012' }, branch: { name: 'สำนักงานใหญ่', taxBranchCode: '00000' },
    documentNumber: 'PV-202610-00001', revision: 1, payee: { name: 'ร้านป้าแดง', basis: 'SAME_NAME' },
    lines: [{ expenseNumber: 'EXP-1', expenseDate: '2026-10-01', vendorName: 'ร้านป้าแดง', grandTotal: '107', wht: '3', netPayable: '104', amount: '50', paidThisTime: '50', outstandingAfter: '54' }],
    total: '50', totals: { grandTotal: '107', wht: '3', paidThisTime: '50' }, paidDate: '2026-10-11', paymentMethod: 'BANK_TRANSFER', paidFromRef: 'บัญชีกิจการ',
    payeeAccount: { bankName: 'ธนาคาร', accountName: 'ร้านป้าแดง', last4: '7890' }, actors: { preparer: { name: 'สมใจ', at: '2026-10-01T03:00:00Z' }, approver: { name: 'สมชาย', at: '2026-10-02T03:00:00Z', selfApproved: false }, payer: { name: 'สมศรี', at: '2026-10-11T03:00:00Z' } }, ...patch });
  it('anchors short signatures low, reserves at least 48 points, and keeps all columns on the final page', async () => {
    assert.ok(DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureGap * (595.28 - 72) / 850 >= 48);
    assert.ok(DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureArea * (595.28 - 72) / 850 >= 40);
    for (const count of [1, 25]) {
      const print = snapshot({ lines: Array.from({ length: count }, (_, i) => ({ ...snapshot().lines[0], expenseNumber: `EXP-${i + 1}`, description: 'ค่าเช่าแผง ต.ค.' })) });
      const svg = renderDisbursementVoucherSvg(print, true).toString();
      const block = svg.match(/data-signature-block="true" data-content-bottom="([\d.]+)" data-top="([\d.]+)" data-page="(\d+)" data-height="([\d.]+)"/)!;
      const [, content, top, page, height] = block.map(Number);
      assert.ok(top! >= DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureAnchor);
      assert.ok(top! + height! <= 1190);
      assert.equal((svg.match(/data-signature-block=/g) || []).length, 1);
      const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(Buffer.from(svg), print.documentNumber, { omitPageFooter: true }));
      assert.equal(pdf.getPageCount(), count === 1 ? 1 : 2);
      assert.equal(page, pdf.getPageCount());
      const precedingText = [...svg.slice(0, svg.indexOf('<g data-signature-block')).matchAll(/<text[^>]*y="([\d.]+)"/g)].map(m => Number(m[1]));
      assert.ok((page! - 1) * 1250 + top! - Math.max(...precedingText) >= DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureGap);
      if (count === 1) { assert.ok(top! - content! >= DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureGap); assert.doesNotMatch(svg, /หน้า \d|รหัสตรวจสอบเอกสาร/); }
      else { assert.match(svg, />หน้า 1\/2</); assert.match(svg, />หน้า 2\/2</); assert.doesNotMatch(svg, /รหัสตรวจสอบเอกสาร|เลขที่ PV-.*หน้า/); }
      const columns = [...svg.matchAll(/<g data-signature-column="\d">([\s\S]*?)<\/g>/g)];
      assert.equal(columns.length, 3);
      columns.forEach(column => [...column[1]!.matchAll(/ y="([\d.]+)"/g)].forEach(m => assert.equal(Math.floor(Number(m[1]) / 1250) + 1, page)));
    }
  });
  it('follows lower-page content by the reserved gap or moves the entire signature block to the next page', () => {
    for (const count of [12, 17]) {
      const print = snapshot({ lines: Array.from({ length: count }, (_, i) => ({ ...snapshot().lines[0], expenseNumber: `EXP-${i + 1}` })) });
      const svg = renderDisbursementVoucherSvg(print, true).toString();
      const block = svg.match(/data-signature-block="true" data-content-bottom="([\d.]+)" data-top="([\d.]+)" data-page="(\d+)" data-height="([\d.]+)"/)!;
      const [, content, top, page, height] = block.map(Number);
      assert.ok(content! >= 1250 * 2 / 3);
      assert.ok(top! + height! <= 1190);
      assert.equal(page, count === 12 ? 1 : 2);
      if (count === 12) assert.equal(top! - content!, DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureGap);
      else assert.ok(content! + DISBURSEMENT_VOUCHER_PRINT_SPACING.signatureGap + height! > 1190);
      assert.equal((svg.match(/data-signature-block=/g) || []).length, 1);
    }
  });
  it('uses grey party and table bands, a right-aligned header and totals, omitting zero tax in the summary', () => {
    const svg = renderDisbursementVoucherSvg(snapshot({ lines: [{ ...snapshot().lines[0], wht: '0' }], totals: { grandTotal: '107', wht: '0', paidThisTime: '50' } }), true).toString();
    assert.match(svg, /x="815"[^>]*text-anchor="end"[^>]*>ใบสำคัญจ่าย</);
    assert.match(svg, /rx="8" fill="#f5f5f5"/); assert.match(svg, /fill="#eee"/);
    assert.equal((svg.match(/>ภาษีที่หักไว้</g) || []).length, 1, 'table column remains; zero-tax summary is omitted');
    assert.doesNotMatch(svg, /ผู้จัดทำ สมใจ|ผู้อนุมัติ สมชาย/);
    assert.match(svg, /x="503"[^>]*font-weight="700"[^>]*>ยอดที่จ่าย</);
  });
  it('uses three signature columns for transfer and cheque, four deliberate blanks otherwise, and draws only snapshotted signatures', () => {
    for (const paid of [true, false]) for (const method of ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER', undefined]) {
      const svg = renderDisbursementVoucherSvg(snapshot({ paymentMethod: method, plannedMethod: method }), paid).toString();
      assert.equal((svg.match(/data-signature-column=/g) || []).length, ['BANK_TRANSFER', 'CHEQUE'].includes(method!) ? 3 : 4);
      assert.doesNotMatch(svg, /…|\.{3}/);
      assert.doesNotMatch(svg, /<image/);
    }
    const svg = renderDisbursementVoucherSvg(snapshot({ actors: { preparer: { name: 'สมใจ', signature: { attachmentId: 'sig', checksumSha256: 'hash', userId: 'actor' }, signatureDataUrl: 'data:image/png;base64,AA==' } } }), true).toString();
    assert.equal((svg.match(/<image/g) || []).length, 1);
    assert.match(svg, /หลักฐานการรับเงิน: สลิปการโอน/);
  });
  it('keeps rules clear of Thai stacked marks and ten typical rows on one page in every variant', async () => {
    const spacing = DISBURSEMENT_VOUCHER_PRINT_SPACING;
    // Noto Sans Thai: ascent 1061, descent 450, units/em 1000. Include half the 1-unit rule stroke.
    assert.ok(spacing.ruleToBaseline - 12 * 1.061 - 0.5 >= 12 * 0.35);
    assert.ok(spacing.rowHeight - spacing.ruleToBaseline - 12 * 0.450 - 0.5 >= 12 * 0.35);
    assert.ok(spacing.lineHeight >= 12 * 1.6);
    assert.ok(spacing.signatureRuleToBaseline - 13 * 1.061 - 0.5 >= 13 * 0.35);
    for (const paid of [false, true]) for (const cancelled of [false, true]) {
      const base = snapshot();
      const print = snapshot({
        lines: Array.from({ length: 10 }, (_, i) => ({ ...base.lines[0], expenseNumber: `EXP-${i + 1}`,
          description: i % 2 ? 'ค่าเช่าแผง ต.ค.' : 'ค่าน้ำมันเชื้อเพลิง ค่าซ่อมปั๊มน้ำ', amount: '104', paidThisTime: '104', outstandingAfter: '0' })),
        total: '1040', totals: { grandTotal: '1070', wht: '30', paidThisTime: '1040' },
        ...(cancelled ? { cancellation: { at: '2026-10-12', reason: 'โอนผิดบัญชี', expenseIds: ['expense-0'], expenseNumbers: ['EXP-1'] } } : {}),
      });
      const svg = renderDisbursementVoucherSvg(print, paid);
      const source = svg.toString();
      const rules = [...source.matchAll(/<path d="M35 ([\d.]+) H815"/g)].map(m => Number(m[1]));
      const texts = [...source.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)];
      for (let i = 0; i < 10; i++) {
        const baseline = Number(texts.find(m => m[3] === `EXP-${i + 1}`)![2]);
        assert.equal(baseline - rules[i]!, spacing.ruleToBaseline);
        const lastTextAbove = Math.max(...texts.filter(m => Number(m[2]) < rules[i]!).map(m => Number(m[2])));
        assert.ok(rules[i]! - lastTextAbove - 12 * 0.450 - 0.5 >= 12 * 0.35);
      }
      const signatureRule = Number(source.match(/<path d="M35 ([\d.]+) h(?:180|245)"/)![1]);
      assert.equal(Number(texts.find(m => m[3] === '(สมใจ)')![2]) - signatureRule, spacing.signatureRuleToBaseline);
      assert.match(source, /data-pdf-breaks=""/);
      const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(svg, base.documentNumber, { omitPageFooter: true }));
      assert.equal(pdf.getPageCount(), 1);
    }
  });
  it('prints accounting identity, invoice references, header facts and complete signature blanks in every variant', async () => {
    for (const paid of [false, true]) for (const cancelled of [false, true]) {
      const base = snapshot();
      const print = snapshot({ company: { name: 'ชื่อร้าน', registeredName: 'บริษัท ทดสอบ จำกัด', taxId: '0123456789012', phone: '02-123-4567',
        addressJson: { line1: '9 หมู่ 2', subdistrict: 'สุเทพ', district: 'เมืองเชียงใหม่', province: 'เชียงใหม่', postalCode: '50200' } },
        documentDate: '2026-10-01', plannedPayDate: '2026-10-12',
        lines: Array.from({ length: 10 }, (_, i) => ({ ...base.lines[0], expenseId: `expense-${i}`, expenseNumber: `EXP-${i + 1}`, vendorDocumentNumber: `INV-${i + 1}`,
          vendorTaxId: '0999999999999', vendorBranchCode: '00001', vendorAddress: '88 ถนนผู้ขาย แขวงสีลม เขตบางรัก กรุงเทพมหานคร',
          description: 'ค่าน้ำมันเชื้อเพลิง', amount: '104', paidThisTime: '104', outstandingAfter: '0' })),
        total: '1040', totals: { grandTotal: '1070', wht: '30', paidThisTime: '1040' },
        ...(cancelled ? { cancellation: { at: '2026-10-12', reason: 'โอนผิดบัญชี', expenseIds: ['expense-0'], expenseNumbers: ['EXP-1'] } } : {}),
      });
      const svg = renderDisbursementVoucherSvg(print, paid).toString();
      for (const value of ['บริษัท ทดสอบ จำกัด', 'สำนักงานใหญ่', '9 หมู่ 2 ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200', '02-123-4567',
        'ผู้รับเงิน ร้านป้าแดง', 'สาขาที่ 00001', '0999999999999', '88 ถนนผู้ขาย', 'EXP-1 / INV-1',
        'วันที่เอกสาร 1 ต.ค. 2569', 'กำหนดจ่าย 12 ต.ค. 2569', paid && cancelled ? '(เก้าร้อยสามสิบหกบาทถ้วน)' : '(หนึ่งพันสี่สิบบาทถ้วน)', '(สมใจ)']) assert.ok(svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').includes(value), value);
      assert.doesNotMatch(svg, /ผู้จัดทำ สมใจ/);
      assert.doesNotMatch(svg, /ผู้อนุมัติ สมชาย/);
      assert.doesNotMatch(svg, /รวมจากชื่อร้าน|รวมด้วยการยืนยัน|ชื่อร้าน ·|>ชื่อร้าน</);
      const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(Buffer.from(svg), print.documentNumber, { omitPageFooter: true }));
      assert.equal(pdf.getPageCount(), 1);
    }
  });
  it('uses source payee facts only when every line agrees and otherwise keeps header identity', () => {
    const a = { ...snapshot().lines[0], vendorName: 'ผู้ขายบนบิล', vendorTaxId: '1111111111111', vendorBranchCode: '00000', vendorAddress: 'ที่อยู่บนบิล' };
    const payee = { name: 'ชื่อบนใบ', taxId: '2222222222222', branchCode: '00002' };
    const same = renderDisbursementVoucherSvg(snapshot({ payee, lines: [a, { ...a }] }), false).toString();
    assert.match(same, /ผู้รับเงิน/); assert.match(same, />ผู้ขายบนบิล</); assert.match(same, /ที่อยู่บนบิล/); assert.match(same, /1111111111111/);
    for (const patch of [{ vendorAddress: 'อีกที่อยู่' }, { vendorTaxId: null }, { vendorBranchCode: '00003' }, { vendorName: 'อีกร้าน' }]) {
      const mixed = renderDisbursementVoucherSvg(snapshot({ payee, lines: [a, { ...a, ...patch }] }), false).toString();
      assert.match(mixed, /ผู้รับเงิน/); assert.match(mixed, />ชื่อบนใบ</); assert.match(mixed, /2222222222222/); assert.match(mixed, /สาขาที่ 00002/);
      assert.doesNotMatch(mixed, /ที่อยู่บนบิล|อีกที่อยู่|1111111111111/);
    }
  });
  it('prints the amount in Thai words and supports full account numbers only in supplied download facts', () => {
    for (const [amount, words] of [['0','ศูนย์บาทถ้วน'], ['1','หนึ่งบาทถ้วน'], ['11','สิบเอ็ดบาทถ้วน'], ['21','ยี่สิบเอ็ดบาทถ้วน'],
      ['101','หนึ่งร้อยเอ็ดบาทถ้วน'], ['1000000','หนึ่งล้านบาทถ้วน'], ['15301.00','หนึ่งหมื่นห้าพันสามร้อยเอ็ดบาทถ้วน'], ['1040.50','หนึ่งพันสี่สิบบาทห้าสิบสตางค์']]) {
      assert.ok(renderDisbursementVoucherSvg(snapshot({ total: amount }), false).toString().includes(`(${words})`));
    }
    assert.match(renderDisbursementVoucherSvg(snapshot(), false).toString(), /xxx-7890/);
    const full = renderDisbursementVoucherSvg(snapshot({ payeeAccount: { ...snapshot().payeeAccount, accountNumber: '1234567890' } }), false).toString();
    assert.match(full, /1234567890/); assert.doesNotMatch(full, /xxx-7890/);
  });
  it('prints frozen descriptions instead of repeated payee names and leaves legacy descriptions empty', () => {
    for (const paid of [false, true]) {
      const legacy = renderDisbursementVoucherSvg(snapshot(), paid).toString();
      assert.match(legacy, />รายละเอียด<\/text>/); assert.doesNotMatch(legacy, />ชื่อผู้ขาย<\/text>/);
      assert.equal((legacy.match(/ร้านป้าแดง/g) || []).length, 2, 'payee header and masked account, never the row');
      const svg = renderDisbursementVoucherSvg(snapshot({ lines: [{ ...snapshot().lines[0], description: 'ค่าพิมพ์นามบัตร' }] }), paid).toString();
      assert.match(svg, /ค่าพิมพ์นามบัตร/);
    }
  });
  it('prints a differing frozen vendor name below its description and keeps expense numbers and dates whole', () => {
    const svg = renderDisbursementVoucherSvg(snapshot({ lines: [{ ...snapshot().lines[0], description: 'ค่าพิมพ์นามบัตร', vendorName: 'ร้านอื่น', expenseNumber: 'EXP-202610-00059', expenseDate: '2026-10-12' }] }), true).toString();
    assert.match(svg, />EXP-202610-00059<\/text>/); assert.match(svg, />12 ต.ค. 2569<\/text>/);
    assert.ok(svg.indexOf('ค่าพิมพ์นามบัตร') < svg.indexOf('ร้านอื่น'));
    const details = svg.match(/<text x="(\d+)" y="(\d+)"[^>]*>ค่าพิมพ์นามบัตร<\/text>/)!;
    const vendor = svg.match(/<text x="(\d+)" y="(\d+)"[^>]*>ร้านอื่น<\/text>/)!;
    assert.equal(details[1], vendor[1]); assert.ok(Number(vendor[2]) > Number(details[2]));
    assert.equal((svg.match(/>ภาษีที่หักไว้<\/text>/g) || []).length, 2);
  });
  it('merges equal net and document amounts but retains both for partial and cancelled payments', () => {
    for (const paid of [false, true]) {
      const full = snapshot({ total: '104', totals: { grandTotal: '107', wht: '3', paidThisTime: '104' }, lines: [{ ...snapshot().lines[0], amount: '104', paidThisTime: '104', outstandingAfter: '0' }] });
      assert.doesNotMatch(renderDisbursementVoucherSvg(full, paid).toString(), /ยอดสุทธิที่/);
      assert.match(renderDisbursementVoucherSvg(snapshot(), paid).toString(), /ยอดสุทธิที่/);
    }
    const cancelled = snapshot({ lines: [{ ...snapshot().lines[0], expenseId: 'a', paidThisTime: '104', outstandingAfter: '0' }], totals: { grandTotal: '107', wht: '3', paidThisTime: '104' }, cancellation: { at: '2026-10-12', reason: null, expenseIds: ['a'] } });
    const svg = renderDisbursementVoucherSvg(cancelled, true).toString();
    assert.match(svg, /ยอดสุทธิที่/); assert.match(svg, /ยกเลิกการจ่ายแล้ว/); assert.match(svg, />0.00<\/text>/);
  });
  for (const scenario of [
    { name: 'explains a totals difference caused only by cancelled payments', cancelled: true, partial: false },
    { name: 'explains a totals difference caused only by partial or earlier payments', cancelled: false, partial: true },
    { name: 'prints cancellation before partial-payment notes when both cause the difference', cancelled: true, partial: true },
    { name: 'omits totals notes when there is no difference', cancelled: false, partial: false },
  ]) it(scenario.name, () => {
    const secondAmount = scenario.partial ? '50' : '104';
    const originalAmount = scenario.partial ? '154' : '208';
    const print = snapshot({ lines: [
      { ...snapshot().lines[0], expenseId: 'first', expenseNumber: 'EXP-1', amount: '104', paidThisTime: '104', outstandingAfter: '0' },
      { ...snapshot().lines[0], expenseId: 'second', expenseNumber: 'EXP-2', amount: secondAmount, paidThisTime: secondAmount, outstandingAfter: scenario.partial ? '54' : '0' },
    ], total: originalAmount, totals: { grandTotal: '214', wht: '6', paidThisTime: originalAmount },
      cancellation: scenario.cancelled ? { at: '2026-10-12', reason: 'โอนผิดบัญชี', expenseIds: ['first'], expenseNumbers: ['EXP-1'] } : undefined });
    for (const paid of scenario.cancelled ? [true] : [false, true]) {
      const svg = renderDisbursementVoucherSvg(print, paid).toString();
      const cancelledNote = 'ยอดนี้ไม่รวมรายการที่การจ่ายถูกยกเลิก';
      const partialNote = 'ยอดนี้ไม่เท่ากับยอดรวมหักภาษี เพราะมีรายการที่จ่ายบางส่วน หรือเคยจ่ายไปแล้วบางส่วน';
      assert.equal(svg.includes(cancelledNote), scenario.cancelled);
      assert.equal(svg.includes(partialNote), scenario.partial);
      if (scenario.cancelled && scenario.partial) assert.ok(svg.indexOf(cancelledNote) < svg.indexOf(partialNote));
    }
  });
  it('a cancelled payment has no remaining amount and is excluded from the paid lines and summary', () => {
    const frozen = snapshot({ lines: [
      { ...snapshot().lines[0], expenseId: 'cancelled', expenseNumber: 'EXP-CANCELLED', paidThisTime: '104', outstandingAfter: '0' },
      { ...snapshot().lines[0], expenseId: 'live', expenseNumber: 'EXP-LIVE', paidThisTime: '50', outstandingAfter: '54' },
    ], totals: { grandTotal: '214', wht: '6', paidThisTime: '154' } });
    const before = JSON.stringify(frozen);
    const svg = renderDisbursementVoucherSvg({ ...frozen, cancellation: { at: '2026-10-12', reason: 'โอนผิดบัญชี', expenseIds: ['cancelled'], expenseNumbers: ['EXP-CANCELLED'] } } as any, true).toString();
    assert.match(svg, /<text x="815"[^>]*text-anchor="end"[^>]*>ยกเลิกการจ่ายแล้ว<\/text>/);
    assert.equal((svg.match(/>50.00<\/text>/g) || []).length, 2, 'live line and paid summary');
    assert.doesNotMatch(svg, />154.00<\/text>|x="730"[^>]*>104.00<\/text>|x="815"[^>]*>0.00<\/text>/);
    assert.match(svg, /x="815"[^>]*>54.00<\/text>/);
    assert.equal(JSON.stringify(frozen), before);
    const live = renderDisbursementVoucherSvg(frozen, true).toString();
    assert.doesNotMatch(live, /ยกเลิกการจ่ายแล้ว/); assert.match(live, />154.00<\/text>/);
  });
  it('right-aligns the planned payment column heading above its amounts', () => {
    const svg = renderDisbursementVoucherSvg(snapshot(), false).toString();
    const summaryY = Number([...svg.matchAll(/<text[^>]*y="(\d+)"[^>]*>ยอดที่จะจ่าย<\/text>/g)].at(-1)![1]);
    const heading = [...svg.matchAll(/<text([^>]*)>ยอดที่จะจ่าย<\/text>/g)].find(m => Number(m[1].match(/y="(\d+)"/)![1]) < summaryY)!;
    assert.match(heading[1], /x="815"/); assert.match(heading[1], /text-anchor="end"/);
  });
  it('prints the company head office or branch independently of the optional tax id', () => {
    const svg = renderDisbursementVoucherSvg(snapshot({ company: { name: 'ร้านทดสอบ', taxId: null } }), false).toString();
    assert.match(svg, />ร้านทดสอบ</); assert.match(svg, /สำนักงานใหญ่/); assert.doesNotMatch(svg, /สาขา 00000/);
    assert.match(renderDisbursementVoucherSvg(snapshot(), false).toString(), /เลขผู้เสียภาษี 0123456789012 · สำนักงานใหญ่/);
    assert.match(renderDisbursementVoucherSvg(snapshot({ branch: { name: 'สยาม', taxBranchCode: '00001' } }), false).toString(), /เลขผู้เสียภาษี 0123456789012 · สาขาที่ 00001/);
  });
  it('prints the shop address in address order with its words, whatever order the stored JSON keys have', () => {
    const addressJson = { line1: '88 ถนนพระราม 4', line2: null, district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110', subdistrict: 'คลองเตยเหนือ' };
    const svg = renderDisbursementVoucherSvg(snapshot({ company: { name: 'บริษัททดสอบ', taxId: '0123456789012', addressJson } }), false).toString();
    assert.match(svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), /88 ถนนพระราม 4 แขวงคลองเตยเหนือ เขตคลองเตย กรุงเทพมหานคร 10110/);
    const upcountry = renderDisbursementVoucherSvg(snapshot({ company: { name: 'บริษัททดสอบ', taxId: '0123456789012', addressJson: { province: 'เชียงใหม่', postalCode: '50200', district: 'เมืองเชียงใหม่', subdistrict: 'สุเทพ', line1: '9 หมู่ 2' } } }), false).toString();
    assert.match(upcountry.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), /9 หมู่ 2 ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200/);
  });
  it('aligns the last unpaid money column with the paid table and summary right margin', () => {
    const unpaid = renderDisbursementVoucherSvg(snapshot(), false).toString();
    const amounts = [...unpaid.matchAll(/<text x="(\d+)"[^>]*text-anchor="end"[^>]*>50.00<\/text>/g)];
    assert.equal(amounts.length, 2); assert.ok(amounts.every(match => match[1] === '815'));
    assert.match(renderDisbursementVoucherSvg(snapshot(), true).toString(), /<text x="815"[^>]*text-anchor="end"[^>]*>54.00<\/text>/);
  });
  it('prints a paid cancellation once with the typed reason, omitting an absent reason', () => {
    const cancellation = { at: '2026-10-12', reason: 'โอนผิดบัญชี', expenseNumbers: ['EXP-1', 'EXP-2'], reissuedDocumentNumber: 'PV-NEW' };
    const svg = renderDisbursementVoucherSvg(snapshot({ cancellation }), true).toString();
    assert.match(svg, /การจ่ายของรายการ EXP-1, EXP-2 ถูกยกเลิก/); assert.match(svg, /เหตุผล: โอนผิดบัญชี/);
    assert.doesNotMatch(svg, /การจ่ายในใบนี้ถูกยกเลิก/);
    const absent = renderDisbursementVoucherSvg(snapshot({ cancellation: { ...cancellation, reason: null } }), true).toString();
    assert.doesNotMatch(absent, /เหตุผล:/); assert.match(absent, /ออกใบใหม่แทนแล้ว เลขที่ PV-NEW/);
  });
  it('prints Buddhist Thai dates and Bangkok event times like the screens', () => {
    const svg = renderDisbursementVoucherSvg(snapshot({ paidDate: '2026-10-12', actors: { payer: { name: 'สมใจ', at: '2026-10-11T22:14:00Z' } },
      cancellation: { at: '2026-10-11T22:14:00Z', reason: null, expenseNumbers: ['EXP-1'] } }), true).toString();
    assert.match(svg, /วันที่จ่าย 12 ต.ค. 2569/); assert.match(svg, /12 ต.ค. 2569 05:14 น./);
    assert.doesNotMatch(svg, /12\/10\/69|05:14</);
  });
  it('omits absent facts and their labels and leaves empty signature boxes without dashes', () => {
    for (const paid of [false, true]) {
      const svg = renderDisbursementVoucherSvg(snapshot({ company: undefined, branch: undefined, payee: { name: 'ร้านป้าแดง' },
        payeeAccount: undefined, plannedPayDate: null, plannedMethod: null, paymentMethod: null, paidFromRef: null, actors: {}, preparerName: null,
        lines: [{ ...snapshot().lines[0], expenseNumber: null, vendorName: null }] }), paid).toString();
      assert.doesNotMatch(svg, /จ่ายจาก|กำหนดจ่าย|วิธีจ่าย|บัญชีผู้รับเงิน|เลขผู้เสียภาษี/);
      assert.doesNotMatch(svg, /<text[^>]*>-<\/text>/); assert.match(svg, /ผู้รับเงิน/);
    }
  });
  it('marks cancellation on every page with its full facts below totals without changing the frozen snapshot', () => {
    const original = snapshot({ snapshotHash: 'abcdef0123456789', lines: Array.from({ length: 20 }, () => snapshot().lines[0]) });
    const svg = renderDisbursementVoucherSvg({ ...original, cancellation: { at: '2026-10-11', reason: 'ยอดผิด', expenseNumbers: ['EXP-1'], reissuedDocumentNumber: 'PV-NEW' } } as any, true).toString();
    const pages = Number(svg.match(/height="(\d+)"/)![1]) / 1250;
    assert.equal((svg.match(/>ยกเลิกแล้ว</g) || []).length, pages);
    assert.equal((svg.match(/เหตุผล: ยอดผิด/g) || []).length, 1);
    assert.equal((svg.match(/การจ่ายของรายการ EXP-1 ถูกยกเลิก/g) || []).length, 1);
    assert.equal((svg.match(/ออกใบใหม่แทนแล้ว เลขที่ PV-NEW/g) || []).length, 1);
    assert.doesNotMatch(renderDisbursementVoucherSvg(original, true).toString(), /ยกเลิกแล้ว/);
    assert.match(renderDisbursementVoucherSvg({ ...original, cancellation: { at: '2026-10-11', reason: 'ยอดผิด' } } as any, false).toString(), /ยกเลิกแล้ว/);
  });
  it('prints aligned money, partial-payment explanation and frozen evidence without a one-page footer', () => {
    const svg = renderDisbursementVoucherSvg(snapshot({ snapshotHash: 'abcdef0123456789', paymentEvidence: { attachedByName: 'สมใจ', attachedAt: '2026-10-11T03:00:00Z' },
      lines: [{ ...snapshot().lines[0], grandTotal: '13350', wht: '350', netPayable: '13000' }] }), true).toString();
    assert.match(svg, /text-anchor="end"[^>]*>13,350.00</);
    assert.doesNotMatch(svg, /หน้า 1\/1/);
    assert.doesNotMatch(svg, /รหัสตรวจสอบเอกสาร|abcdef012345/);
    assert.match(svg, /ยอดนี้ไม่เท่ากับยอดรวมหักภาษี เพราะมีรายการที่จ่ายบางส่วน หรือเคยจ่ายไปแล้วบางส่วน/);
    assert.match(svg, /หลักฐานการจ่าย: แนบ 1 ไฟล์ โดย สมใจ เมื่อ/);
    const unpaid = renderDisbursementVoucherSvg(snapshot({ plannedPayDate: '2026-10-12' }), false).toString();
    assert.match(unpaid, /กำหนดจ่าย/); assert.doesNotMatch(unpaid, /วันที่วางแผนจ่าย/);
    assert.doesNotMatch(unpaid, /x="734"[^>]*>-</);
    assert.match(renderDisbursementVoucherSvg(snapshot(), true).toString(), /หลักฐานการจ่าย: ไม่ได้แนบ/);
    const full = snapshot({ total: '104', totals: { grandTotal: '107', wht: '3', paidThisTime: '104' } });
    assert.doesNotMatch(renderDisbursementVoucherSvg(full, true).toString(), /ยอดนี้ไม่เท่ากับ/);
  });
  it('prints the two headings with the same number, source WHT, masked account and merge notes', () => {
    const unpaid = renderDisbursementVoucherSvg(snapshot(), false).toString();
    const paid = renderDisbursementVoucherSvg(snapshot(), true).toString();
    assert.match(unpaid, /ใบเตรียมจ่าย/); assert.match(unpaid, /ยังไม่ได้จ่ายเงิน/); assert.match(unpaid, /ครั้งที่ 1/); assert.match(unpaid, /ยอดที่จะจ่าย/);
    assert.match(paid, /ใบสำคัญจ่าย/); assert.match(paid, /ยอดที่จ่าย/); assert.match(paid, /PV-202610-00001/); assert.match(paid, /xxx-7890/);
    assert.doesNotMatch(paid, /รวมจากชื่อร้านที่ตรงกัน/); assert.match(paid, /ภาษีที่หักไว้/);
    assert.doesNotMatch(renderDisbursementVoucherSvg(snapshot({ payee: { name: 'ผู้รับเงิน', basis: 'PREPARER_CONFIRMED', confirmerName: 'สมใจ' } }), true).toString(), /รวมด้วยการยืนยัน/);
  });
  it('prints direct payments without an approver and re-issued documents with their original number', () => {
    const direct = renderDisbursementVoucherSvg(snapshot({ directPayment: true }), true).toString();
    assert.doesNotMatch(direct, /บันทึกจ่ายโดยตรง/); assert.ok(!direct.includes('สมชาย'));
    assert.match(renderDisbursementVoucherSvg(snapshot({ origin: 'REISSUED', replacesDocumentNumber: 'PV-OLD' }), true).toString(), /ออกแทนใบเลขที่ PV-OLD/);
  });
  it('wraps a 120-character Thai name and paginates thirty complete lines without splitting rows', async () => {
    const base = snapshot(), longName = 'ก'.repeat(120);
    const svg = renderDisbursementVoucherSvg(snapshot({ payee: { name: longName, basis: 'SINGLE' }, lines: Array.from({ length: 30 }, (_, i) => ({ ...base.lines[0], expenseNumber: `EXP-${i + 1}`, vendorName: longName })) }), true);
    const source = svg.toString();
    assert.match(source, /data-pdf-breaks="[\d,]+"/); assert.ok(!source.includes(`>${longName}<`));
    for (let i = 1; i <= 30; i++) assert.ok(source.includes(`>EXP-${i}</text>`));
    assert.match(source, /ใบสำคัญจ่าย \(ต่อ\)/);
    assert.ok((source.match(/>เลขรายจ่าย</g) || []).length >= 2);
    assert.equal((source.match(/>รวมเป็นเงิน</g) || []).length, 1);
    assert.equal((source.match(/data-signature-block=/g) || []).length, 1);
    const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(svg, base.documentNumber));
    assert.ok(pdf.getPageCount() >= 2);
  });
});
const standardFontDataUrl = `${dirname(requireFromWorkspace.resolve('pdfjs-dist/package.json'))}/standard_fonts/`;

async function extractPageTexts(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const document = await task.promise;
  try {
    const texts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      texts.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

async function assertCancelledWatermarkOnEveryPage(bytes: Buffer) {
  for (const page of await renderSubstitutePaperPreviewPages(bytes)) {
    const { data, info } = await sharp(Buffer.from(page.split(',')[1]!, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let y = Math.floor(info.height * 0.25); y < info.height * 0.75; y++) {
      for (let x = Math.floor(info.width * 0.2); x < info.width * 0.8; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i]! > data[i + 1]! + 12 && data[i]! > data[i + 2]! + 12) redPixels++;
      }
    }
    assert.ok(redPixels > 300, `central cancellation watermark must survive PDF rendering (${redPixels} red pixels)`);
  }
}

describe('substitute receipt PDF', () => {
  it('converts only the current RGB chunk, preserving pixels and bounded work in every PDF.js entry point', () => {
    const packageRoot = dirname(requireFromWorkspace.resolve('pdfjs-dist/package.json'));
    for (const entry of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'image_decoders/pdf.image_decoders.mjs',
      'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'legacy/image_decoders/pdf.image_decoders.mjs']) {
      const source = readFileSync(join(packageRoot, entry), 'utf8');
      const start = source.indexOf('function convertRGBToRGBA({');
      const end = source.indexOf('function grayToRGBA(', start);
      assert.ok(start >= 0 && end > start, `${entry}: installed converter exists`);
      for (const isLittleEndian of [true, false]) {
        // Execute the installed dependency, not a duplicate of the patched algorithm.
        const words = isLittleEndian ? Uint32Array : function (buffer: ArrayBuffer, offset: number, length: number) {
          const view = new DataView(buffer);
          return Array.from({ length }, (_, index) => view.getUint32(offset + index * 4, false));
        };
        const endian = { isLittleEndian };
        const convert = new Function('FeatureTest', 'image_utils_FeatureTest', 'Uint32Array',
          `${source.slice(start, end)}; return convertRGBToRGBA;`)(endian, endian, words);
        for (const srcPos of [12, 120_000]) {
          const pixels = Uint8Array.from([1, 2, 3, 21, 22, 23, 41, 42, 43, 61, 62, 63, 81, 82, 83]);
          const bytes = new Uint8Array(srcPos + pixels.length);
          bytes.set(pixels, srcPos);
          let tailReads = 0;
          const src = new Proxy(bytes, { get(target, key) {
            if (typeof key === 'string' && /^\d+$/.test(key)) tailReads++;
            return Reflect.get(target, key, target);
          } });
          const sentinel = 0x12345678;
          const dest = new Uint32Array(9).fill(sentinel);
          assert.deepEqual(convert({ src, srcPos, dest, destPos: 2, width: 5, height: 1 }),
            { srcPos: srcPos + pixels.length, destPos: 7 }, `${entry}: chunk offsets`);
          assert.equal(tailReads, 3, `${entry}: only the remaining pixel is read, regardless of previous chunks`);
          const expected = Array.from({ length: 5 }, (_, index) => {
            const [r, g, b] = pixels.subarray(index * 3, index * 3 + 3);
            return (isLittleEndian ? r! | g! << 8 | b! << 16 | 0xff000000 : r! << 24 | g! << 16 | b! << 8 | 0xff) >>> 0;
          });
          assert.deepEqual(Array.from(dest), [sentinel, sentinel, ...expected, sentinel, sentinel], `${entry}: RGBA pixels and adjacent chunks`);
        }
      }
    }
  });

  it('renders every uploaded scan and attestation page for browsers without a PDF viewer', async () => {
    const scan = await PDFDocument.create();
    scan.addPage([400, 600]).drawText('LOCAL TEST SCAN ONE', { x: 40, y: 400 });
    scan.addPage([400, 600]).drawText('LOCAL TEST SCAN TWO', { x: 40, y: 400 });
    const artifact = await renderSubstituteReceiptPaperArtifactPdf({ bytes: Buffer.from(await scan.save()), mimeType: 'application/pdf' }, thaiSvg);
    const pages = await renderSubstitutePaperPreviewPages(artifact);
    assert.equal(pages.length, 3);
    assert.notEqual(pages[0], pages[1]);
    for (const page of pages) {
      assert.match(page, /^data:image\/jpeg;base64,/);
      const image = sharp(Buffer.from(page.split(',')[1]!, 'base64'));
      const metadata = await image.metadata();
      assert.ok(metadata.width! <= 1600 && metadata.height! <= 2400);
      const stats = await image.stats();
      assert.ok(stats.channels.some((channel) => channel.min < 200), 'page has visible ink');
    }
  });
  it('keeps long signer labels inside their columns in the PDF rasterizer', async () => {
    for (const [center, label] of [
      [240, 'QACOMPLETE UI Regression · QA LOCAL TEST ONLY — simulated payer'],
      [615, 'Local Owner · QA LOCAL TEST ONLY — simulated approver'],
    ] as const) {
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="80">
        <rect width="850" height="80" fill="white"/>
        <text x="${center}" y="40" text-anchor="middle" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15"${fitToWidth(label, 270)}>${label}</text>
      </svg>`);
      const { data, info } = await sharp(svg).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
      const inkColumns = new Set<number>();
      data.forEach((pixel, index) => { if (pixel < 200) inkColumns.add(index % info.width); });
      assert.ok(inkColumns.size > 0);
      assert.ok(Math.min(...inkColumns) >= center - 135, `${label}: overflows the left column edge`);
      assert.ok(Math.max(...inkColumns) <= center + 135, `${label}: overflows the right column edge`);
    }
  });

  it('renders Thai ink into a one-page A4 PDF', async () => {
    const { data, info } = await sharp(thaiSvg, { density: 200 }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    const inkRatio = data.reduce((count, pixel) => count + (pixel < 200 ? 1 : 0), 0) / (info.width * info.height);
    assert.ok(inkRatio >= 0.002, `Thai font ink ratio ${inkRatio} is below 0.2%`);

    const bytes = await renderSubstituteReceiptPdf(thaiSvg, 'SRC-EXP-0142-V1');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getTitle(), 'SRC-EXP-0142-V1');
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.ok(bytes.byteLength < 2_000_000, `Rendered PDF is ${bytes.byteLength} bytes`);
    console.log(`Rendered PDF: ${bytes.byteLength} bytes; Thai ink ratio: ${(inkRatio * 100).toFixed(3)}%`);
  });

  it('marks every derived page when the immutable certificate has been voided', async () => {
    const bytes = await renderSubstituteReceiptPdf(thaiSvg, 'SRC-EXP-0142-V1', { stateStamp: 'VOID' });
    const pdf = await PDFDocument.load(bytes);
    assert.match(pdf.getSubject() ?? '', /State: VOID/);
    await assertCancelledWatermarkOnEveryPage(bytes);
  });

  it('rejects an implausibly blank certificate', async () => {
    const blank = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="850" height="180"><rect width="850" height="180" fill="white"/></svg>');
    await assert.rejects(
      renderSubstituteReceiptPdf(blank),
      /Thai font missing from the runtime image; the rendered certificate is blank\./,
    );
  });

  it('paginates a tall certificate instead of shrinking it onto one unreadable page', async () => {
    const rows = Array.from({ length: 32 }, (_, index) => `
      <text x="70" y="${150 + (index * 70)}" font-size="18">${index + 1}. รายละเอียดค่าใช้จ่ายสำหรับกิจการและหลักฐานประกอบ</text>
      <line x1="50" y1="${170 + (index * 70)}" x2="800" y2="${170 + (index * 70)}" stroke="#bbb"/>
    `).join('');
    const tall = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="850" height="2450" viewBox="0 0 850 2450">
        <rect width="850" height="2450" fill="#fff"/>
        <g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">
          <text x="425" y="70" text-anchor="middle" font-size="25" font-weight="700">ใบรับรองแทนใบเสร็จรับเงิน</text>
          ${rows}
        </g>
      </svg>
    `);
    const bytes = await renderSubstituteReceiptPdf(tall, 'SRC-MULTI-PAGE-V1');
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 2, `Expected multiple pages, got ${pdf.getPageCount()}`);
    assert.equal(pdf.getTitle(), 'SRC-MULTI-PAGE-V1');
    for (const page of pdf.getPages()) assert.deepEqual(page.getSize(), { width: 595.28, height: 841.89 });
    const pageTexts = await extractPageTexts(bytes);
    pageTexts.forEach((text, index) => {
      assert.match(text, /ID: SRC-MULTI-PAGE-V1 \| SHA256: [0-9a-f]{16}/);
      assert.match(text, new RegExp(`Page ${index + 1}/${pageTexts.length}`));
    });
  });

  it('uses semantic renderer hints and preserves contiguous coverage', () => {
    const width = 100;
    const height = 400;
    const channels = 3;
    const white = Buffer.alloc(width * height * channels, 255);
    const slices = planSubstituteReceiptRasterSlices(white, width, height, channels, [140, 280]);
    assert.deepEqual(slices, [
      { top: 0, height: 140 },
      { top: 140, height: 140 },
      { top: 280, height: 120 },
    ]);
    assert.equal(slices.reduce((covered, slice) => covered + slice.height, 0), height);
    slices.slice(1).forEach((slice, index) => {
      assert.equal(slice.top, slices[index]!.top + slices[index]!.height);
    });

    const tooTallHeight = 150 * (SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages + 1);
    const tooTall = Buffer.alloc(width * tooTallHeight * channels, 255);
    assert.throws(
      () => planSubstituteReceiptRasterSlices(tooTall, width, tooTallHeight, channels),
      new RegExp(`${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages}-page safety limit`),
    );
  });

  it('paginates an actual receipt at renderer-provided block boundaries', async () => {
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-INTEGRATION-V1',
      version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: 'สำนักงานใหญ่', taxId: '0100000000000' },
      expense: {
        id: 'expense-integration',
        expenseNumber: 'EXP-1001',
        expenseDate: '2026-08-08T00:00:00.000Z',
        paymentDate: '2026-08-08T00:00:00.000Z',
        currency: 'THB',
        grandTotalAmount: '1800.00',
        paymentMethod: 'CASH',
        paymentReference: null,
        category: 'ทั่วไป',
        businessPurpose: 'จัดซื้อวัสดุสำหรับกิจการ',
        lines: Array.from({ length: 18 }, (_, index) => ({
          description: `รายการที่ ${index + 1} ${'รายละเอียดค่าใช้จ่าย'.repeat(12)}`,
          quantity: '1',
          amount: '100.00',
        })),
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
      reasonCode: 'PAYEE_CANNOT_ISSUE',
      missingReceiptReason: 'ผู้ขายรายย่อยไม่สามารถออกใบเสร็จรับเงินได้',
      payee: { name: 'ร้านค้าทดสอบ', address: '1 ถนนทดสอบ กรุงเทพมหานคร', taxId: '1234567890123' },
      payer: { userId: 'payer-1', name: 'ผู้จ่ายเงินจริง', position: 'staff', certifiedAt: '2026-08-08T10:00:00.000Z' },
      certificationText: buildSubstituteCertificationText('ผู้จ่ายเงินจริง', 'staff'),
      evidence: [
        {
          id: 'evidence-1',
          purpose: 'expense.payment.evidence',
          originalFileName: `${'หลักฐานการชำระเงิน'.repeat(12)}.png`,
          mimeType: 'image/png',
          checksumSha256: null,
        },
        {
          id: 'evidence-2',
          purpose: 'expense.receipt.supporting',
          originalFileName: `${'ภาพประกอบรายการ'.repeat(10)}.jpg`,
          mimeType: 'image/jpeg',
          checksumSha256: null,
        },
      ],
      note: null,
    };
    const svg = renderSubstituteReceiptSvg(snapshot);
    const breakAttribute = /data-pdf-breaks="([\d,]+)"/.exec(svg.toString('utf8'))?.[1];
    assert.ok(breakAttribute);
    const source = svg.toString('utf8');
    assert.match(source, /data-pdf-page-height="1250"/);
    assert.equal(new Set([...source.matchAll(/data-substitute-row="(\d+)"/g)].map(match => match[1])).size, snapshot.expense.lines.length);
    assert.equal(breakAttribute.split(',').length, (source.match(/data-substitute-page=/g) || []).length - 1);
    assert.ok(breakAttribute.split(',').every((value, index) => Number(value) === (index + 1) * 1250));
    const bytes = await renderSubstituteReceiptPdf(svg, snapshot.documentNumber);
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 2);
    assert.ok(pdf.getPageCount() <= SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages);
    const pageTexts = await extractPageTexts(bytes);
    pageTexts.forEach((text, index) => {
      assert.match(text, /SRC-INTEGRATION-V1/);
      assert.match(text, new RegExp(`Page ${index + 1}/${pageTexts.length}`));
    });
  });

  it('renders the shared worst-case prepare boundary within the PDF safety ceiling', async () => {
    const thai = (length: number) => 'ฒ'.repeat(length);
    const limits = SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS;
    const snapshot: SubstituteReceiptSnapshot = {
      documentNumber: 'SRC-BOUNDARY-V1',
      version: 1,
      company: { name: thai(255), branchName: thai(200), taxId: '0100000000000' },
      expense: {
        id: 'expense-boundary',
        expenseNumber: 'EXP-BOUNDARY',
        expenseDate: '2026-08-08T00:00:00.000Z',
        paymentDate: '2026-08-08T00:00:00.000Z',
        currency: 'THB',
        grandTotalAmount: '999999999999.99',
        paymentMethod: 'CASH',
        paymentReference: null,
        category: 'ทั่วไป',
        businessPurpose: thai(500),
        lines: Array.from({ length: limits.maxExpenseLines }, () => ({
          description: thai(limits.maxLineDescriptionLength),
          quantity: '99999999999999.9999',
          amount: '999999999999.99',
        })),
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT',
      reasonCode: 'OTHER',
      missingReceiptReason: thai(500),
      payee: { name: thai(200), address: thai(300), taxId: '1234567890123' },
      payer: { userId: 'payer-1', name: thai(160), position: thai(120), certifiedAt: '2026-08-08T10:00:00.000Z' },
      certificationText: buildSubstituteCertificationText(thai(160), thai(120)),
      evidence: Array.from({ length: limits.maxEvidenceAttachments }, (_, index) => ({
        id: `evidence-${index}`,
        purpose: index % 2 === 0 ? 'expense.payment.evidence' : 'expense.receipt.supporting',
        originalFileName: `${thai(limits.maxEvidenceFileNameLength - 4)}.pdf`,
        mimeType: 'application/pdf',
        checksumSha256: null,
      })),
      note: thai(500),
    };

    const svg = renderSubstituteReceiptSvg(snapshot);
    const bytes = await renderSubstituteReceiptPdf(svg, snapshot.documentNumber);
    const pdf = await PDFDocument.load(bytes);
    // The promise is that anything inside the renderability limits renders; the ceiling keeps a
    // page of slack above it, so this asserts the band rather than pinning the exact page count.
    assert.ok(pdf.getPageCount() > 1, 'the worst-case boundary should paginate');
    assert.ok(
      pdf.getPageCount() <= SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages,
      `worst-case boundary used ${pdf.getPageCount()} pages, ceiling is ${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxPages}`,
    );
  });

  it('rejects an oversized vector before allocating its production raster', async () => {
    const oversized = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="850" height="20000" viewBox="0 0 850 20000">
        <rect width="850" height="20000" fill="white"/>
        <text x="50" y="100" font-size="20">oversized certificate</text>
      </svg>
    `);
    const startedAt = Date.now();
    await assert.rejects(
      renderSubstituteReceiptPdf(oversized, 'SRC-OVERSIZED-V1'),
      /safe raster size limit/,
    );
    assert.ok(Date.now() - startedAt < 5_000, 'Oversized SVG should fail during metadata probing, before rasterization.');
  });
});

describe('renderSubstituteReceiptPaperArtifactPdf (R11)', () => {
  const photo = (format: 'jpeg' | 'png') => sharp({
    create: { width: 600, height: 900, channels: 3, background: '#ffffff' },
  })[format]().toBuffer();
  const scanPdf = async (pages: number) => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < pages; index += 1) pdf.addPage([200, 300]);
    return Buffer.from(await pdf.save());
  };

  it('puts a photographed form ahead of the attestation page, for JPEG and PNG alike', async () => {
    for (const format of ['jpeg', 'png'] as const) {
      const data = await renderSubstituteReceiptPaperArtifactPdf(
        { bytes: await photo(format), mimeType: `image/${format}` },
        thaiSvg,
        'SUB-202608-00007',
      );
      const pdf = await PDFDocument.load(data);
      assert.equal(pdf.getPageCount(), 2, `${format}: the photo page plus the attestation page`);
      assert.equal(pdf.getTitle(), 'SUB-202608-00007');
      assert.match(pdf.getSubject() ?? '', /Wet-signed scan \+ system attestation/);
    }
  });

  it('marks every scan and attestation page and appends the reason without covering the scan', async () => {
    const plain = await renderSubstituteReceiptPaperArtifactPdf(
      { bytes: await photo('png'), mimeType: 'image/png' }, thaiSvg, 'SUB-202608-00007',
    );
    const superseded = await renderSubstituteReceiptPaperArtifactPdf(
      { bytes: await photo('png'), mimeType: 'image/png' }, thaiSvg, 'SUB-202608-00007', { stateStamp: 'SUPERSEDED', cancellationReason: 'รายการซ้ำกับเอกสารฉบับก่อน' },
    );
    const texts = await extractPageTexts(superseded);
    assert.equal(texts.length, 3, 'scan, attestation, then reason');
    await assertCancelledWatermarkOnEveryPage(superseded);
    assert.doesNotMatch((await extractPageTexts(plain))[0] ?? '', /SUPERSEDED/);
    assert.match((await PDFDocument.load(superseded)).getSubject() ?? '', /State: SUPERSEDED/);

  });

  it('numbers every page of the composed artifact and names the document on it', async () => {
    const data = await renderSubstituteReceiptPaperArtifactPdf(
      { bytes: await scanPdf(2), mimeType: 'application/pdf' }, thaiSvg, 'SUB-202608-00007',
    );
    const texts = await extractPageTexts(data);
    assert.equal(texts.length, 3);
    texts.forEach((text, index) => {
      assert.match(text, /ID: SUB-202608-00007/, `page ${index + 1} names the document`);
      assert.match(text, new RegExp(`Page ${index + 1}/3`), `page ${index + 1} says where it sits`);
    });
    // The attestation's own "Page 1/1" is corrected to its real position in the composed file.
    assert.doesNotMatch(texts[2] ?? '', /Page 1\/1/);
  });

  it('omits generated paper footers while retaining original scan content and state stamps', async () => {
    const scan = await PDFDocument.create();
    scan.addPage([400, 600]).drawText('ORIGINAL SCAN FOOTER', { x: 20, y: 20, size: 10 });
    const bytes = Buffer.from(await scan.save());
    for (const stateStamp of [undefined, 'VOID', 'SUPERSEDED'] as const) {
      const data = await renderSubstituteReceiptPaperArtifactPdf(
        { bytes, mimeType: 'application/pdf' }, thaiSvg, 'SUB-202608-00007',
        { omitPageFooter: true, stateStamp },
      );
      const texts = await extractPageTexts(data);
      assert.equal(texts.length, stateStamp ? 3 : 2);
      assert.match(texts[0]!, /ORIGINAL SCAN FOOTER/);
      for (const text of texts) {
        assert.doesNotMatch(text, /ID:|Page \d+\/\d+|SHA256:/);
      }
      if (stateStamp) await assertCancelledWatermarkOnEveryPage(data);
    }
  });

  it('refuses media it cannot reproduce, and keeps the page ceiling for a multi-page scan', async () => {
    await assert.rejects(
      renderSubstituteReceiptPaperArtifactPdf({ bytes: Buffer.from('x'), mimeType: 'image/heic' }, thaiSvg),
      /must be a JPEG, PNG, or PDF/,
    );
    // The budget counts the attestation page too: 6 scan pages + 1 is over the ceiling.
    await assert.rejects(
      renderSubstituteReceiptPaperArtifactPdf(
        { bytes: await scanPdf(SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 1), mimeType: 'application/pdf' }, thaiSvg,
      ),
      new RegExp(`${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 1}-page safety limit`),
    );
    assert.equal(await substituteWetSignedScanRejection({ bytes: await scanPdf(SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages), mimeType: 'application/pdf' }), undefined);
    assert.match(
      (await substituteWetSignedScanRejection({ bytes: await scanPdf(SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 1), mimeType: 'application/pdf' }))!,
      new RegExp(`${SUBSTITUTE_RECEIPT_PDF_LIMITS.maxScanPages + 1}-page safety limit`),
    );
    assert.match((await substituteWetSignedScanRejection({ bytes: Buffer.from('nope'), mimeType: 'application/pdf' }))!,
      /cannot be read as a printable document/);
    assert.match((await substituteWetSignedScanRejection({ bytes: Buffer.from('x'), mimeType: 'image/heic' }))!,
      /must be a JPEG, PNG, or PDF/);
    assert.equal(await substituteWetSignedScanRejection({ bytes: await photo('jpeg'), mimeType: 'image/jpeg' }), undefined);
  });
});

const oneLineSubstitute: SubstituteReceiptSnapshot = {"documentNumber": "SRC-ONE", "version": 1, "company": {"name": "ร้านทดสอบ", "branchName": null, "taxId": null}, "expense": {"id": "one", "expenseNumber": "EXP-ONE", "expenseDate": "2026-11-05", "paymentDate": "2026-11-05", "currency": "THB", "grandTotalAmount": "100", "paymentMethod": "CASH", "paymentReference": null, "category": null, "businessPurpose": "ใช้ในร้าน", "lines": [{"description": "ค่าเดินทาง", "quantity": "1", "amount": "100"}]}, "originalSourceDocumentType": "EXPENSE_NOTE_TEXT", "reasonCode": "OTHER", "missingReceiptReason": "ไม่มีใบเสร็จ", "payer": {"userId": "payer", "name": "สมใจ", "position": "", "certifiedAt": "2026-11-05"}, "certificationText": "รับรองว่าจ่ายแล้ว", "evidence": [], "note": null};
const oneLineVoucher = {"payee": {"name": "ร้านทดสอบ"}, "documentNumber": "DV-ONE", "lines": [{"expenseNumber": "EXP-ONE", "expenseDate": "2026-11-05", "vendorName": "ร้านทดสอบ", "description": "ค่าเดินทาง", "grandTotal": "100", "wht": "0", "netPayable": "100", "amount": "100", "paidThisTime": "100", "outstandingAfter": "0"}], "total": "100", "totals": {"grandTotal": "100", "wht": "0", "paidThisTime": "100"}};

it('keeps original one-line online, paper, preparation and paid SVG bytes unchanged', () => {
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(renderSubstituteReceiptSvg(oneLineSubstitute)), '32bede84296a4e6c48ad876eb35b9a0c955c3cbd420d5f5303fa1922c824df01');
  assert.equal(digest(renderSubstituteReceiptSvg(oneLineSubstitute, undefined, undefined, undefined, { paperForm: true })), '2a3ddd71c7afc99967ae891dfc69000fc31ef6a67cb0b170a27759f05fa586ec');
  assert.equal(digest(renderDisbursementVoucherSvg(oneLineVoucher, false)), 'e08d872745c38a651be19e0f4dfa038ec8eec07701a2223df021f7ef58b6d9de');
  assert.equal(digest(renderDisbursementVoucherSvg(oneLineVoucher, true)), 'a655a999a801ed67ea80c11427e839d6f0c84d738bdbddedc07c07aa5e1366eb');
});

it('prints all 200 substitute rows on online and paper continuation sheets, with one total and final signatures', async () => {
  for (const paperForm of [false, true]) {
    const snapshot = { ...oneLineSubstitute, expense: { ...oneLineSubstitute.expense, grandTotalAmount: '20000',
      lines: Array.from({ length: 200 }, (_, i) => ({ description: `รายการที่ ${i + 1}`, quantity: '1', amount: '100' })) } };
    const svg = renderSubstituteReceiptSvg(snapshot, undefined, undefined, undefined, { paperForm });
    const source = svg.toString();
    const pages = [...source.matchAll(/data-substitute-page="(\d+)">([\s\S]*?)<text x="805" y="1225"/g)];
    assert.ok(pages.length > 1);
    assert.equal((source.match(/data-substitute-row=/g) || []).length, 200);
    assert.equal((source.match(/data-substitute-amount=/g) || []).length, 200);
    assert.equal((source.match(/data-substitute-total=/g) || []).length, 1);
    assert.equal((source.match(/data-substitute-signatures=/g) || []).length, 1);
    assert.ok(pages.at(-1)![2]!.includes('data-substitute-signatures='));
    for (let i = 1; i <= 200; i++) assert.ok(source.includes(`>รายการที่ ${i}</tspan>`));
    for (const page of pages) {
      if (page[2]!.includes('data-substitute-row=')) assert.ok(page[2]!.includes('รายละเอียดรายจ่าย'));
      if (Number(page[1]) > 1) assert.ok(page[2]!.includes('(ต่อ)'));
    }
    for (const row of source.matchAll(/data-top="(\d+)" data-height="(\d+)"/g)) assert.ok(Number(row[1]) + Number(row[2]) <= 1190);
    const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(svg, snapshot.documentNumber));
    assert.equal(pdf.getPageCount(), pages.length);
  }
});

it('continues oversized voucher descriptions without clipping and prints each amount only once', async () => {
  for (const paid of [false, true]) {
    const snapshot = { ...oneLineVoucher, total: '3000', totals: { grandTotal: '3000', wht: '0', paidThisTime: '3000' }, lines: Array.from({ length: 30 }, (_, i) => ({ ...oneLineVoucher.lines[0]!,
      expenseNumber: `ROW-${i + 1}`, description: i === 0 ? 'รายละเอียด '.repeat(600) + 'ENDOFROW' : `รายการ ${i + 1}` })) };
    const svg = renderDisbursementVoucherSvg(snapshot, paid);
    const source = svg.toString();
    assert.equal((source.match(/>100.00<\/text>/g) || []).length, 60, 'each of the 30 rows prints its gross and payment once');
    assert.match(source.replace(/<[^>]*>/g, ''), /ENDOFROW/); assert.match(source, /ROW-1 \(ต่อ\)/);
    assert.equal((source.match(/>รวมเป็นเงิน</g) || []).length, 1);
    assert.equal((source.match(/data-signature-block=/g) || []).length, 1);
    for (const text of source.matchAll(/<text[^>]+y="([\d.]+)"[^>]*>/g)) assert.ok(Number(text[1]) % 1250 <= 1225);
    const pdf = await PDFDocument.load(await renderSubstituteReceiptPdf(svg));
    assert.ok(pdf.getPageCount() > 2);
  }
});

// The SVG is the renderer's own output and is byte-stable on every machine; the PDF bytes also
// depend on the local libvips/font build (develop and this change match byte for byte on the same
// machine, 2026-11-05), so only the SVG is pinned and the PDF stays a single sheet.
it('keeps the one-row certificate identical to the original renderer', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T00:00:00Z').getTime() });
  const svg = renderSubstituteReceiptSvg(oneLineSubstitute);
  assert.equal(createHash('sha256').update(svg).digest('hex'), '32bede84296a4e6c48ad876eb35b9a0c955c3cbd420d5f5303fa1922c824df01');
  assert.equal((await PDFDocument.load(await renderSubstituteReceiptPdf(svg, 'SRC-ONE'))).getPageCount(), 1);
});
