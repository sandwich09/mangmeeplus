import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  renderReimbursementClaimFormSvg,
  thaiBahtText,
  type ReimbursementClaimFormSnapshot,
} from './claim-form.logic';

// Lane D: the printed ใบเบิกค่าใช้จ่าย. The renderer is the last stop before a
// document a human signs, so Thai text, escaping and the signature/checklist
// semantics are asserted on the bytes themselves.

function snapshot(overrides: Partial<ReimbursementClaimFormSnapshot> = {}): ReimbursementClaimFormSnapshot {
  return {
    requestNo: 'RB-202607-000012',
    submittedAt: '2026-07-20T03:00:00.000Z',
    currency: 'THB',
    totalAmount: '1250.5000',
    reason: 'ค่าเดินทางและค่าอาหารระหว่างไปพบลูกค้าที่ต่างจังหวัด',
    requesterName: 'สมชาย ใจดี',
    company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: '0100000000000' },
    lines: [
      { lineNo: 1, incurredDate: '2026-07-15T00:00:00.000Z', description: 'ค่าแท็กซี่ไปหาลูกค้า', purpose: 'พบลูกค้า', amount: '300.0000' },
      { lineNo: 2, incurredDate: '2026-07-16T00:00:00.000Z', description: 'ค่าอาหารกลางวันทีมงาน', purpose: null, amount: '450.5000' },
      { lineNo: 3, incurredDate: '2026-07-17T00:00:00.000Z', description: 'ค่าที่พัก <script>alert(1)</script>', purpose: 'ค้างคืน', amount: '500.0000' },
    ],
    hasReceiptEvidence: true,
    missingReceiptReason: null,
    signers: {
      requester: { name: 'สมชาย ใจดี', at: '2026-07-20T03:00:00.000Z' },
      approver: { name: 'มานี ผู้จัดการ', at: '2026-07-21T03:00:00.000Z' },
      accounting: { name: 'ปรีชา บัญชี', at: '2026-07-22T03:00:00.000Z' },
      finance: { name: 'สุดา การเงิน', at: '2026-07-23T03:00:00.000Z' },
    },
    ...overrides,
  };
}

describe('reimbursement claim form', () => {
  it('states when policy skipped human approval instead of implying a missing signer', () => {
    const base = snapshot();
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      approvalDecisionNote: 'ไม่ต้องอนุมัติตามนโยบาย',
      signers: { ...base.signers, approver: null },
    })).toString('utf8');
    assert.match(artifact, /การอนุมัติ — ไม่ต้องอนุมัติตามนโยบาย/);
  });

  it('renders Thai baht text without losing satang', () => {
    assert.equal(thaiBahtText('0'), 'ศูนย์บาทถ้วน');
    assert.equal(thaiBahtText('1250.5000'), 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์');
    assert.equal(thaiBahtText('21.25'), 'ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
  });

  it('renders a fully signed claim: title block, 3-line table, total in words, ticked receipt, four signers', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot()).toString('utf8');

    assert.match(artifact, /REIMBURSEMENT CLAIM FORM/);
    assert.match(artifact, /ใบเบิกค่าใช้จ่าย/);
    assert.match(artifact, /บริษัท ทดสอบ จำกัด/);
    // Default branch label and tax id follow the substitute-receipt precedence.
    assert.match(artifact, /สาขา: สำนักงานใหญ่ · เลขประจำตัวผู้เสียภาษี: 0100000000000/);
    assert.match(artifact, /เลขที่เอกสาร: RB-202607-000012/);
    assert.match(artifact, /วันที่: 20 ก\.ค\. 2569/);

    // Five columns, three rows in lineNo order, Thai dates, money formatted.
    for (const header of ['ลำดับ', 'วันที่', 'รายการ', 'วัตถุประสงค์', 'จำนวนเงิน \\(฿\\)']) {
      assert.match(artifact, new RegExp(header));
    }
    assert.match(artifact, /ค่าแท็กซี่ไปหาลูกค้า/);
    assert.match(artifact, /ค่าอาหารกลางวันทีมงาน/);
    assert.match(artifact, /15 ก\.ค\. 2569/);
    assert.match(artifact, /300\.00/);
    assert.match(artifact, /450\.50/);
    const rowOrder = ['ค่าแท็กซี่ไปหาลูกค้า', 'ค่าอาหารกลางวันทีมงาน', 'ค่าที่พัก'].map((text) => artifact.indexOf(text));
    assert.deepEqual(rowOrder, [...rowOrder].sort((a, b) => a - b), 'lines must print in lineNo order');

    assert.match(artifact, /รวมเป็นเงิน/);
    assert.match(artifact, /1,250\.50/);
    assert.match(artifact, /จำนวนเงินรวม \(ตัวอักษร\): หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์/);

    // Checklist: only ใบเสร็จรับเงิน is ticked; the other three stay empty for wet ink.
    for (const label of ['ใบเสร็จรับเงิน', 'ใบกำกับภาษี', 'หลักฐานการชำระเงิน', 'อื่น ๆ']) {
      assert.match(artifact, new RegExp(label));
    }
    assert.equal((artifact.match(/<rect x="\d+" y="\d+" width="14" height="14"/g) ?? []).length, 4);
    assert.equal((artifact.match(/<path d="M/g) ?? []).length, 1, 'exactly one checklist tick');

    assert.match(artifact, /เหตุผลในการเบิก/);
    assert.match(artifact, /ค่าเดินทางและค่าอาหาร/);

    // Four signature blocks, each filled with a real actor and their date.
    for (const [role, name, date] of [
      ['ผู้เบิก', 'สมชาย ใจดี', '20 ก.ค. 2569'],
      ['ผู้อนุมัติ', 'มานี ผู้จัดการ', '21 ก.ค. 2569'],
      ['ฝ่ายบัญชี', 'ปรีชา บัญชี', '22 ก.ค. 2569'],
      ['ฝ่ายการเงิน', 'สุดา การเงิน', '23 ก.ค. 2569'],
    ]) {
      assert.match(artifact, new RegExp(role!));
      assert.match(artifact, new RegExp(`\\( ${name!} \\)`));
      assert.match(artifact, new RegExp(`วันที่ ${date!.replace(/\./g, '\\.')}`));
    }
    assert.doesNotMatch(artifact, /\.{10}/, 'a fully signed form has no blank ruled name lines');
  });

  it('escapes hostile line text instead of emitting active content', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      reason: 'เหตุผล "<img src=x onerror=alert(1)>" & อื่น ๆ',
      requesterName: "สมชาย <script>alert('x')</script>",
      company: { name: 'บริษัท <b>ทดสอบ</b>', branchName: 'สาขา & ศูนย์', taxId: '<taxid>' },
      signers: {
        requester: { name: 'สมชาย <script>', at: '2026-07-20T03:00:00.000Z' },
        approver: null, accounting: null, finance: null,
      },
    })).toString('utf8');

    // Every angle bracket is escaped, so no tag (and therefore no handler) can form.
    assert.doesNotMatch(artifact, /<script|<img|<b>|foreignObject/);
    assert.match(artifact, /&lt;script&gt;/);
    assert.match(artifact, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(artifact, /&amp;/);
    assert.match(artifact, /สาขา: สาขา &amp; ศูนย์/);
  });

  it('leaves un-taken steps blank and unticks the receipt box when no line carries evidence', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      hasReceiptEvidence: false,
      signers: {
        requester: { name: 'สมชาย ใจดี', at: '2026-07-20T03:00:00.000Z' },
        approver: null,
        accounting: null,
        finance: null,
      },
    })).toString('utf8');

    assert.equal((artifact.match(/<path d="M/g) ?? []).length, 0, 'nothing is ticked without evidence');
    // Requester signed; the other three blocks print blank ruled name and date lines.
    assert.match(artifact, /\( สมชาย ใจดี \)/);
    assert.equal((artifact.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 3);
    assert.equal((artifact.match(/วันที่ \.{18}/g) ?? []).length, 3);
    assert.equal((artifact.match(/ผู้อนุมัติ|ฝ่ายบัญชี|ฝ่ายการเงิน/g) ?? []).length, 3, 'roles still print for wet-ink signing');
  });

  it('prints the waiver reason when nothing is evidenced, and hides it once a line carries a receipt', () => {
    const waived = renderReimbursementClaimFormSvg(snapshot({
      hasReceiptEvidence: false,
      missingReceiptReason: 'ร้านค้าในตลาดไม่ออกใบเสร็จรับเงินให้',
    })).toString('utf8');
    assert.match(waived, /เหตุผลที่ไม่มีใบเสร็จ: ร้านค้าในตลาดไม่ออกใบเสร็จรับเงินให้/);
    assert.equal((waived.match(/<path d="M/g) ?? []).length, 0, 'a waived claim ticks nothing');

    // Evidence present: the checklist explains itself, so no waiver line is printed.
    const evidenced = renderReimbursementClaimFormSvg(snapshot({
      hasReceiptEvidence: true,
      missingReceiptReason: 'ร้านค้าในตลาดไม่ออกใบเสร็จรับเงินให้',
    })).toString('utf8');
    assert.doesNotMatch(evidenced, /เหตุผลที่ไม่มีใบเสร็จ/);

    // Blank/whitespace reasons never print an empty label.
    const blank = renderReimbursementClaimFormSvg(snapshot({ hasReceiptEvidence: false, missingReceiptReason: '   ' })).toString('utf8');
    assert.doesNotMatch(blank, /เหตุผลที่ไม่มีใบเสร็จ/);
  });

  it('wraps long Thai text inside its column without dropping trailing content', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      reason: `${'เหตุผลการเบิก'.repeat(60)} END-OF-REASON`,
      lines: [{
        lineNo: 1,
        incurredDate: '2026-07-15T00:00:00.000Z',
        description: `${'รายละเอียดค่าใช้จ่าย'.repeat(25)} END-OF-LINE`,
        purpose: `${'วัตถุประสงค์'.repeat(20)} END-OF-PURPOSE`,
        amount: '1250.5000',
      }],
    })).toString('utf8');

    // Wrapping may break a suffix across two tspans, so read the text, not the markup.
    const text = artifact.replace(/<[^>]+>/g, '');
    for (const suffix of ['END-OF-REASON', 'END-OF-LINE', 'END-OF-PURPOSE']) {
      assert.match(text, new RegExp(suffix));
    }
    assert.ok((artifact.match(/<tspan/g) ?? []).length > 20, 'long text is wrapped into many tspans');
  });

  it('breaks a single word wider than its column instead of letting it run into the next one', () => {
    // The เปลี่ยนคาปาซิเตอร์ report: a รายการ line printed past the x=480 rule and over
    // วัตถุประสงค์. `wrapText` accepted any word verbatim while the line was still empty,
    // so a word wider than the column was never split at all.
    const word = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF';
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      lines: [{ lineNo: 1, incurredDate: '2026-07-15T00:00:00.000Z', description: word, purpose: null, amount: '10.0000' }],
    })).toString('utf8');

    const pieces = [...artifact.matchAll(/<tspan x="208"[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]!);
    assert.ok(pieces.length > 1, `expected the word to be split, got ${JSON.stringify(pieces)}`);
    assert.equal(pieces.join(''), word, 'no character is dropped by the split');
  });

  it('draws a stored signature above the ลงชื่อ line and leaves unsigned roles ruled (lane F)', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      signers: {
        requester: { name: 'สมชาย ใจดี', at: '2026-07-20T03:00:00.000Z', signatureDataUrl: 'data:image/png;base64,AAAB' },
        approver: { name: 'มานี ผู้จัดการ', at: '2026-07-21T03:00:00.000Z' },
        accounting: null,
        finance: null,
      },
    })).toString('utf8');

    const images = artifact.match(/<image href="[^"]+"/g) ?? [];
    assert.equal(images.length, 1, 'only the digitally signed role gets an image');
    assert.match(artifact, /<image href="data:image\/png;base64,AAAB" x="100" y="\d+" width="130" height="54"/);
    // The name and the ruled line are still printed under the image.
    assert.match(artifact, /\( สมชาย ใจดี \)/);
    assert.match(artifact, /\( มานี ผู้จัดการ \)/);
    // Unsigned roles keep the blank wet-ink line.
    assert.equal((artifact.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 2);
  });

  it('keeps a short claim on one A4-proportioned sheet and grows the sheet for a long one', () => {
    const short = renderReimbursementClaimFormSvg(snapshot({ lines: [snapshot().lines[0]!] })).toString('utf8');
    assert.match(short, /width="850" height="1202"/);

    const many = renderReimbursementClaimFormSvg(snapshot({
      lines: Array.from({ length: 30 }, (_value, index) => ({
        lineNo: index + 1, incurredDate: '2026-07-15T00:00:00.000Z',
        description: `ค่าใช้จ่ายรายการที่ ${index + 1}`, purpose: null, amount: '10.0000',
      })),
    })).toString('utf8');
    const height = Number(/height="(\d+)"/.exec(many)![1]);
    assert.ok(height > 1202, `expected a grown sheet, got ${height}`);
    // Signatures stay at the foot of the sheet whatever the body length.
    assert.ok(many.includes(`y="${height - 150}"`), 'signature row anchors to the page foot');
  });
});
