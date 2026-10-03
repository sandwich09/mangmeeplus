import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BusinessDocumentClassification } from '@watchdog-bms/contracts';
import {
  CAPTURE_READ_FAILED_REPLY,
  CAPTURE_READ_PARTIAL_REPLY,
  CAPTURE_READ_PAUSED_REPLY,
  capturePausedReasonTh,
  classifyNonReceiptCase,
  formatCaptureReadFinishedReply,
  NON_RECEIPT_PERSISTING_CASES,
  nonReceiptReply,
} from './line-non-receipt-reply.logic';

const LINK = 'https://app.example.com/companies/c1/expenses/capture/g1';

/** The retired AI-money wording, assembled at runtime: spelled out here it would trip the repo-wide
 *  guard that exists to keep it out of source (spec §3, W-01). */
const retiredAiMoneyWords = ['\u0e07\u0e1a', '\u0e42\u0e04\u0e27\u0e15\u0e32'].map((word) => `${word} AI`);
const usesRetiredAiMoneyWording = (text: string): boolean => retiredAiMoneyWords.some((word) => text.includes(word));


function classification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT', documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'DELIVERY_NOTE',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'ORDERED', evidenceRoles: [],
    confidence: 0.9, evidenceSignals: [], amountSignals: [], settlementSignals: [],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
    ...overrides,
  } as BusinessDocumentClassification;
}

describe('§18.4 NR01–NR09 reply table', () => {
  // The whole point of §18.4: a courier document is named for what it IS, and the two shapes that
  // share `DELIVERY_NOTE` are told apart by their signals, not by a per-courier enum.
  for (const [name, kind, signal, expectedCase, expectedText] of [
    ['NR01 parcel label', 'DELIVERY_NOTE', 'PARCEL_LABEL_SIGNAL', 'NR01',
      'ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ'],
    ['NR02 deposit slip', 'DELIVERY_NOTE', 'DEPOSIT_SLIP_SIGNAL', 'NR02',
      'ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ'],
    ['NR03 delivery note without a signal', 'DELIVERY_NOTE', null, 'NR03',
      'ใบนี้เป็นใบส่งของค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR03 quotation', 'QUOTATION', null, 'NR03',
      'ใบนี้เป็นใบเสนอราคาค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR03 purchase order', 'PURCHASE_ORDER', null, 'NR03',
      'ใบนี้เป็นใบสั่งซื้อค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ'],
    ['NR05 transfer slip', 'TRANSFER_SLIP', null, 'NR05_SLIP',
      'พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร'],
    ['NR05 marketplace order', 'MARKETPLACE_ORDER', null, 'NR05_ORDER',
      'พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน'],
    ['NR07 non-business image', 'NON_FINANCIAL_IMAGE', null, 'NR07',
      'ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ'],
    ['NR08 unsure', 'NEEDS_REVIEW', null, 'NR08', 'ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ'],
  ] as const) {
    it(`${name} maps to ${expectedCase} with the §18.4 sentence`, () => {
      const value = classification({
        documentKind: kind as BusinessDocumentClassification['documentKind'],
        ...(signal ? { missingRequiredSignals: [signal as never] } : {}),
      });
      assert.equal(classifyNonReceiptCase(value), expectedCase);
      assert.equal(nonReceiptReply(expectedCase, { classification: value }), expectedText);
    });
  }

  it('NR04 prints the amount only when the reader read one', () => {
    const invoice = classification({ documentKind: 'SUPPLIER_INVOICE_OR_BILL', documentFamily: 'EXPENSE_EVIDENCE' });
    assert.equal(classifyNonReceiptCase(invoice), 'NR04');
    assert.equal(
      nonReceiptReply('NR04', { classification: invoice, amountLabel: '1,250.00' }),
      'ใบนี้เป็นใบแจ้งหนี้ ยอด 1,250.00 บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก',
    );
    assert.equal(
      nonReceiptReply('NR04', { classification: invoice }),
      'ใบนี้เป็นใบแจ้งหนี้ค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก',
    );
  });

  it('NR06 stays with the check-bill continuation, and multi/unreadable keep their own copy', () => {
    assert.equal(classifyNonReceiptCase(classification({ documentKind: 'ORDER_OR_CHECK_BILL' })), 'NR06');
    assert.equal(classifyNonReceiptCase(classification({ contentKind: 'MULTI_DOCUMENT' })), null);
    assert.equal(classifyNonReceiptCase(classification({ contentKind: 'UNREADABLE' })), null);
    assert.equal(classifyNonReceiptCase(null), null);
  });

  it('only NR01–NR03 and NR08 may offer the Web CTA, and only with a real link', () => {
    assert.deepEqual([...NON_RECEIPT_PERSISTING_CASES], ['NR01', 'NR02', 'NR03', 'NR08']);
    for (const nr of NON_RECEIPT_PERSISTING_CASES) {
      const withLink = nonReceiptReply(nr, { classification: classification(), captureLink: LINK });
      assert.match(withLink, /ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้: https:\/\//, `${nr} offers the CTA when the bytes are kept`);
      const without = nonReceiptReply(nr, { classification: classification() });
      assert.ok(!/กรอกข้อมูลต่อ/.test(without), `${nr} says nothing about a link it does not have`);
    }
    // §18.4: a non-business image is never persisted, so it can never carry the CTA.
    assert.ok(!/กรอกข้อมูลต่อ/.test(nonReceiptReply('NR07', { captureLink: LINK })));
  });

  it('NR09 / §17.6: the three read outcomes each name their own state and never each other', () => {
    assert.equal(CAPTURE_READ_FAILED_REPLY(LINK), `อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${LINK}`);
    assert.equal(CAPTURE_READ_PARTIAL_REPLY(LINK), `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้\n${LINK}`);
    // Wave-2 credit wording, unchanged: one sentence for every ceiling that stops a document read.
    assert.match(CAPTURE_READ_PAUSED_REPLY(LINK, 'ai_credit'), /เครดิตสำหรับการอ่านเอกสารไม่พอ/);
    assert.ok(!usesRetiredAiMoneyWording(CAPTURE_READ_PAUSED_REPLY(LINK, 'ai_credit')), 'the retired budget words never appear');
    assert.equal(capturePausedReasonTh('page_limit'), 'เอกสารมีจำนวนหน้ามากกว่าที่ระบบอ่านอัตโนมัติได้');
    assert.equal(capturePausedReasonTh(undefined), 'ยังอ่านไม่ครบทุกหน้า');
  });

  it('the DONE summary names what was found, and says so differently for several documents', () => {
    assert.equal(
      formatCaptureReadFinishedReply({ link: LINK, documentCount: 1, issuerName: 'ร้านกาแฟดี', documentTotal: '250.00' }),
      `📄 อ่านเอกสารแล้วค่ะ พบ ร้านกาแฟดี ยอด 250.00 — ตรวจและสร้างรายการค่าใช้จ่ายในเว็บ: ${LINK}`,
    );
    assert.equal(
      formatCaptureReadFinishedReply({ link: LINK, documentCount: 3 }),
      `📄 อ่านเอกสารแล้วค่ะ พบ 3 ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ: ${LINK}`,
    );
    // No issuer and no total read: the sentence still stands, with nothing invented.
    assert.match(formatCaptureReadFinishedReply({ link: LINK, documentCount: 1 }), /พบเอกสาร 1 ฉบับ/);
  });
});
