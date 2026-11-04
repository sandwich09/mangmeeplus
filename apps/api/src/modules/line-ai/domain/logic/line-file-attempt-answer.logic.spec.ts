import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileAttemptAnswer,
  fileAttemptChoiceList,
  FILE_ATTEMPT_DELIVERY_FAILED_REPLY,
  FILE_ATTEMPT_LOOKUP_FAILED_REPLY,
  FILE_ATTEMPT_NONE_REPLY,
  mediaWordTh,
  type LineFileAttemptFacts,
} from './line-file-attempt-answer.logic';
import { receiptStatusQuestion } from './line-receipt-status.logic';

const MAX = 10 * 1024 * 1024;

function attempt(overrides: Partial<LineFileAttemptFacts> = {}): LineFileAttemptFacts {
  return {
    ref: 'attempt-1', messageType: 'file', fileNameSanitized: 'invoice.pdf', stage: 'DOWNLOAD',
    reasonCode: 'download_failed', outcome: 'REJECTED', declaredFileSize: null, measuredByteSize: null,
    capability: { maxBytes: MAX, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'], pdfAutomaticRead: true },
    createdAt: new Date('2026-09-18T10:00:00Z'),
    ...overrides,
  };
}

describe('§17.5 question detection', () => {
  // Table-driven: each row is a way a real customer asks one of §17.5's six questions.
  for (const text of [
    'ไฟล์เมื่อกี้ทำไมส่งไม่ได้',
    'รูปเมื่อสักครู่ส่งไม่ได้เหรอ',
    'เอกสารล่าสุดรับไม่ได้หรอ',
    'ใหญ่ไปหรือเปล่า',
    'ขนาดไฟล์เกินไหม',
    'รองรับ PDF ไหม',
    'ส่ง PDF ได้ไหมคะ',
    'ต้องส่งไฟล์ใหม่ไหม',
    'บันทึกไปหรือยัง',
    'เก็บไว้หรือยังคะ',
    'ทำไมถึงอ่านไม่ได้',
    'why did my file upload fail',
    'is the pdf too big',
    'do you support pdf',
    'should i send it again',
    'was the file saved',
  ]) {
    it(`"${text}" is a file-attempt question, not a receipt-list one`, () => {
      assert.equal(receiptStatusQuestion(text), 'file_attempt');
    });
  }

  it('a progress question about a bill is still the receipt list, and an edit is still neither', () => {
    assert.equal(receiptStatusQuestion('ใบเสร็จเสร็จหรือยัง'), 'receipt');
    assert.equal(receiptStatusQuestion('เสร็จยัง'), 'contextual');
    // §17.5 is read-only: an edit/cancel intent must never be answered as a status.
    assert.equal(receiptStatusQuestion('ยกเลิกไฟล์เมื่อกี้'), null);
    assert.equal(receiptStatusQuestion('ขอบคุณค่ะ'), null);
  });

  // C1 (T-107-b): "ขนาดนี้/ขนาดนั้น" is an intensifier ("พุ่งขนาดนี้" = spiked THIS much), not a file
  // reference — it must not steal an expense-spike question into the file-attempt answer.
  it('a bare "ขนาดนี้" intensifier is not a file question, but naming the file still is', () => {
    assert.equal(receiptStatusQuestion('ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ'), null);
    assert.equal(receiptStatusQuestion('ค่าใช้จ่ายเยอะขนาดนั้นเลยเหรอ'), null);
    assert.equal(receiptStatusQuestion('ไฟล์ใหญ่ไปไหม'), 'file_attempt');
    assert.equal(receiptStatusQuestion('ขนาดไฟล์เท่าไร'), 'file_attempt');
  });
});

describe('§17.5 answer table', () => {
  it('oversize quotes the real size and the real limit, and never widens into another cause', () => {
    const text = fileAttemptAnswer(attempt({ reasonCode: 'oversize_declared', declaredFileSize: 12 * 1024 * 1024 }));
    assert.equal(text, 'ไฟล์ invoice.pdf ขนาด 12.0 เมกะไบต์ เกินขนาดที่ระบบรับได้ 10.0 เมกะไบต์ จึงยังไม่ได้เก็บไฟล์นี้ — เลือกไฟล์ที่เล็กกว่าแล้วส่งอีกครั้งได้เลยค่ะ');
  });

  it('an unsupported type names the kinds the capability really listed', () => {
    const text = fileAttemptAnswer(attempt({ stage: 'SECURITY', reasonCode: 'METADATA_REJECTED' }));
    assert.match(text, /กรุณาเลือก PDF, พีเอ็นจี, เจเพ็ก/);
  });

  it('a download failure with no known cause says exactly that — never "too large" or "expired"', () => {
    const text = fileAttemptAnswer(attempt({ reasonCode: 'download_failed' }));
    assert.match(text, /ยังระบุสาเหตุแน่ชัดไม่ได้/);
    assert.ok(!/ใหญ่|หมดอายุ/.test(text), 'no invented cause');
  });

  it('security and persist failures each keep their own sentence', () => {
    assert.match(fileAttemptAnswer(attempt({ stage: 'SECURITY', reasonCode: 'MALWARE_DETECTED' })), /ไม่ผ่านการตรวจความปลอดภัย/);
    assert.match(fileAttemptAnswer(attempt({ stage: 'PERSIST', reasonCode: 'persist_failed' })), /ระบบเก็บไฟล์ invoice\.pdf ไม่สำเร็จ/);
  });

  for (const [outcome, pattern] of [
    ['STORED_READING', /กำลังอ่านเอกสารอยู่/],
    ['STORED_READ_FAILED', /แต่อ่านข้อมูลไม่สำเร็จ ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้/],
    ['STORED_READ_PARTIAL', /ยังอ่านข้อมูลไม่ครบ ผู้มีสิทธิ์แก้ไขสามารถกรอกข้อมูลต่อบนเว็บได้/],
    ['STORED_READ_DONE', /อ่านไฟล์ invoice\.pdf เสร็จแล้วค่ะ/],
    ['STORED', /ยังไม่ได้อ่านข้อมูลอัตโนมัติ/],
  ] as const) {
    it(`a ${outcome} file reports its own state with the link`, () => {
      const text = fileAttemptAnswer(attempt({
        stage: 'PERSIST', reasonCode: 'stored', outcome,
        recoveryAction: { kind: 'open_web', url: 'https://app.example.com/companies/c1/expenses/capture/g1' },
      }));
      assert.match(text, pattern);
      assert.match(text, /expenses\/capture\/g1/);
    });
  }

  it('an UNKNOWN outcome is never reported as saved', () => {
    assert.equal(fileAttemptAnswer(attempt({ outcome: 'UNKNOWN', stage: 'PERSIST' })), FILE_ATTEMPT_LOOKUP_FAILED_REPLY);
  });

  it('a problem since fixed answers with both states, so nobody sends or pays twice', () => {
    const now = attempt({ ref: 'attempt-2', outcome: 'STORED_READING', stage: 'PERSIST', reasonCode: 'stored' });
    const before = attempt({ reasonCode: 'oversize_declared', declaredFileSize: 12 * 1024 * 1024 });
    const text = fileAttemptAnswer(now, before);
    assert.match(text, /^ตอนแรก ไฟล์ใหญ่เกินขนาดที่ระบบรับได้ ตอนนี้ กำลังอ่านเอกสาร แล้วค่ะ/);
  });

  it('several candidates are listed, numbered, with name, time and state', () => {
    const list = fileAttemptChoiceList([
      attempt({ ref: 'a', fileNameSanitized: 'jul.pdf' }),
      attempt({ ref: 'b', fileNameSanitized: 'aug.pdf', outcome: 'STORED_READING' }),
    ]);
    assert.match(list, /^หมายถึงไฟล์ไหนคะ\n• ไฟล์ jul\.pdf · .+ · ยังไม่ได้เก็บไฟล์\n• ไฟล์ aug\.pdf · .+ · กำลังอ่านเอกสาร$/);
  });

  it('not-found, lookup-failure and delivery-failure are three different answers', () => {
    assert.match(FILE_ATTEMPT_NONE_REPLY, /ยังไม่พบไฟล์ที่จะอ่าน/);
    assert.match(FILE_ATTEMPT_LOOKUP_FAILED_REPLY, /ยังตรวจสอบสถานะไม่ได้/);
    assert.notEqual(FILE_ATTEMPT_NONE_REPLY, FILE_ATTEMPT_LOOKUP_FAILED_REPLY);
    // UXE-25: the read finished, the push did not. Both facts, neither exaggerated.
    const undelivered = FILE_ATTEMPT_DELIVERY_FAILED_REPLY('https://app.example.com/x');
    assert.match(undelivered, /อ่านเอกสารเสร็จแล้วค่ะ แต่ส่งผลให้ทางแชตนี้ไม่สำเร็จ/);
  });

  it('§17.1: the noun matches what was sent', () => {
    assert.equal(mediaWordTh('file'), 'ไฟล์');
    assert.equal(mediaWordTh('image'), 'รูป');
    assert.match(fileAttemptAnswer(attempt({ messageType: 'image', fileNameSanitized: null, stage: 'PERSIST', reasonCode: 'persist_failed' })), /ระบบเก็บรูปนี้ไม่สำเร็จ/);
  });
});

it('unknown allowed file types never expose MIME tokens', () => {
  const text = fileAttemptAnswer(attempt({ stage: 'SECURITY', reasonCode: 'METADATA_REJECTED',
    capability: { allowedMimeTypes: ['application/x-new-format'] } }));
  assert.doesNotMatch(text, /x-new-format|X-NEW-FORMAT|application/);
  assert.match(text, /ไฟล์ชนิดที่ระบบรองรับ/);
});


it('R4 file refusal explains a usable next action', () => {
  assert.equal(fileAttemptAnswer(attempt({ reasonCode: 'CONTENT_UNINSPECTABLE' })), 'ระบบตรวจไฟล์นี้ไม่ได้ ส่งไฟล์อื่นได้ค่ะ');
  assert.equal(fileAttemptAnswer(attempt({ reasonCode: 'EMBEDDED_FILE_REJECTED' })), 'ไฟล์แนบใน PDF นี้ยังไม่รองรับ ส่งไฟล์อื่นได้ค่ะ');
  assert.equal(fileAttemptAnswer(attempt({ reasonCode: 'MALWARE_SCAN_FAILED' })), 'ระบบตรวจไฟล์นี้ไม่ได้ ส่งไฟล์อื่นได้ค่ะ');
});
