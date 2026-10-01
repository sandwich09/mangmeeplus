import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { cancelledDocumentReasonBox } from '../../../../common/documents/cancelled-document';
import {
  claimFormLayout,
  documentSignedVia,
  renderReimbursementClaimFormSvg,
  renderReimbursementClaimFormPages,
  thaiBahtText,
  type ClaimFormPayout,
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
    layout: 'TWO_SIGNERS',
    repayment: { paidAt: '2026-07-23T03:00:00.000Z', method: 'BANK_TRANSFER', reference: 'TXN-1', recordedByName: 'สุดา การเงิน' },
    ...overrides,
  };
}

/** Both renderings of one snapshot: the legacy tall SVG and the A4 pages joined. */
function bothRenderings(input: ReimbursementClaimFormSnapshot): string[] {
  return [renderReimbursementClaimFormSvg(input).toString('utf8'), renderReimbursementClaimFormPages(input).map(String).join('')];
}

const SIGNING_LINE = /<line x1="\d+" y1="(\d+)" x2="\d+" y2="\d+" stroke="#222"/g;

describe('reimbursement claim form', () => {
  it('paginates long claims with exact row/amount coverage and one final cancellation box', () => {
    const input = snapshot({
      lines: Array.from({ length: 65 }, (_, i) => ({ lineNo: i + 1, incurredDate: '2026-09-10', description: `ROW-${i + 1}-END รายการค่าใช้จ่าย`, purpose: 'กิจการ', amount: '10.00' })),
      totalAmount: '650.00', cancellation: { reason: 'ยกเลิกเพราะรายการซ้ำ' },
    });
    const pages = renderReimbursementClaimFormPages(input).map((p) => p.toString());
    assert.ok(pages.length >= 3);
    const all = pages.join('');
    for (const [i, page] of pages.entries()) {
      assert.match(page, /width="850" height="1202"/);
      assert.match(page, /RB-202607-000012/);
      assert.match(page, new RegExp(`หน้า ${i + 1} / ${pages.length}`));
      assert.equal((page.match(/data-cancelled-watermark/g) ?? []).length, 1);
      if (page.includes('data-claim-row')) assert.match(page, /วัตถุประสงค์<\/text>/);
    }
    for (const row of input.lines) {
      assert.equal((all.match(new RegExp(`ROW-${row.lineNo}-END`, 'g')) ?? []).length, 1);
      assert.equal((all.match(new RegExp(`data-claim-amount="${row.lineNo}"`, 'g')) ?? []).length, 1);
    }
    assert.equal((all.match(/data-claim-total/g) ?? []).length, 1);
    assert.equal((all.match(/การจ่ายเงินคืน:/g) ?? []).length, 1);
    assert.equal((all.match(/data-claim-signatures/g) ?? []).length, 1);
    assert.equal((all.match(/data-cancellation-reason/g) ?? []).length, 1);
    assert.match(pages.at(-1)!, /data-cancellation-reason/);
    assert.ok(pages.slice(0, -1).every((p) => !p.includes('data-cancellation-reason')));
    assert.ok(renderReimbursementClaimFormPages({ ...input, cancellation: undefined }).every((p) => !p.includes('CANCELLED')));
  });

  it('moves the whole cancellation box to a new final page when content leaves insufficient space', () => {
    let found = false;
    for (let count = 10; count < 30; count++) {
      const pages = renderReimbursementClaimFormPages(snapshot({
        lines: Array.from({ length: count }, (_, i) => ({ ...snapshot().lines[0]!, lineNo: i + 1 })),
        cancellation: { reason: 'บันทึกซ้ำ' },
      })).map((p) => p.toString());
      if (pages.at(-1)!.includes('data-cancellation-reason') && !pages.at(-1)!.includes('data-claim-signatures')) {
        found = true;
        assert.match(pages.at(-2)!, /data-claim-signatures/);
        assert.match(pages.at(-1)!, /CANCELLED/);
        break;
      }
    }
    assert.ok(found, 'boundary fixture must exercise the reason-only final page');
  });

  it('continues an oversized row without losing text or duplicating its amount', () => {
    const purpose = 'W'.repeat(500);
    const input = snapshot({ lines: [{ ...snapshot().lines[0]!, description: 'LONG-ROW', purpose }] });
    const pages = renderReimbursementClaimFormPages(input).map((p) => p.toString());
    const all = pages.join('');
    assert.match(all, /data-row-continuation="true"/);
    assert.equal((all.match(/data-claim-amount="1"/g) ?? []).length, 1);
    assert.equal([...all.matchAll(/<tspan x="488"[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]).join(''), purpose);
    for (const page of pages) assert.doesNotMatch(page, /NaN|Infinity/);
  });

  it('continues an exceptionally tall cancellation reason without losing recorded text', () => {
    const reason = Array.from({ length: 80 }, (_, i) => `เหตุผลบรรทัดที่ ${i + 1}`).join('\n');
    const pages = renderReimbursementClaimFormPages(snapshot({ cancellation: { reason } })).map((p) => p.toString());
    const reasonPages = pages.filter((p) => p.includes('data-cancellation-reason'));
    assert.equal(reasonPages.length, 3);
    assert.match(reasonPages.at(-1)!, /เหตุผลการยกเลิกเอกสาร \(ต่อ\)/);
    const printedLines = [...reasonPages.join('').matchAll(/<text x="24" y="\d+">([^<]*)<\/text>/g)].map((m) => m[1]);
    assert.equal(printedLines.join('\n'), reason);
    assert.ok(pages.every((p) => p.includes('data-cancelled-watermark')));
  });

  it('wraps the shared cancellation reason at Thai word boundaries without losing a leading vowel', () => {
    const reason = 'บันทึกรายการซ้ำกับเอกสารที่จัดทำไว้ก่อนหน้า จึงยกเลิกฉบับนี้เพื่อป้องกันการเบิกจ่ายซ้ำ';
    for (const number of [undefined, 'SRC-202609-00001']) {
      const { svg } = cancelledDocumentReasonBox(reason, number);
      const lines = [...svg.matchAll(/<text x="24" y="\d+">([^<]*)<\/text>/g)].map((m) => m[1]!);
      assert.equal(lines.join(''), reason, 'the full persisted reason survives wrapping');
      assert.equal(lines.length, 1, 'this reason fits the available box width without an early line break');
      assert.ok(lines.some((line) => line.includes('เบิก')), 'เบิก remains a whole word');
      assert.ok(lines.every((line) => !/[เแโใไ]$/.test(line)), 'a leading vowel cannot be stranded on the preceding line');
    }
    const long = cancelledDocumentReasonBox(reason.repeat(4)).svg;
    const wrapped = [...long.matchAll(/<text x="24" y="\d+">([^<]*)<\/text>/g)].map((m) => m[1]!);
    assert.ok(wrapped.length > 1);
    assert.equal(wrapped.join(''), reason.repeat(4));
    assert.ok(wrapped.every((line) => !/[เแโใไ]$/.test(line)));
  });

  it('marks a cancelled claim and reserves a wrapped reason box below all signature blocks', () => {
    const reason = `${'แก้ไขข้อมูลรายการและจัดทำใบเบิกใหม่ '.repeat(30)}<script>END-REASON</script>`;
    const artifact = renderReimbursementClaimFormSvg(snapshot({ cancellation: { reason } })).toString();
    assert.match(artifact, /data-cancelled-watermark="true"/);
    assert.match(artifact, /rotate\(-30\).*opacity="0.18".*#991B1B/);
    assert.match(artifact, /ยกเลิก<\/text>/);
    assert.match(artifact, /CANCELLED/);
    assert.match(artifact, /เหตุผลการยกเลิกเอกสาร/);
    assert.match(artifact.replace(/<[^>]+>/g, ''), /&lt;script&gt;END-REASON&lt;\/script&gt;/);
    assert.doesNotMatch(artifact, /<script>/);
    for (const [layout, blocks] of [['TWO_SIGNERS', 2], ['LEGACY_FOUR_SIGNERS', 4]] as const) {
      const svg = renderReimbursementClaimFormSvg(snapshot({ layout, selfApproved: true, cancellation: { reason } })).toString();
      const boxTop = Number(/<svg x="45" y="(\d+)"/.exec(svg)![1]);
      const signatureYs = [...svg.matchAll(SIGNING_LINE)].map((m) => Number(m[1]));
      assert.equal(signatureYs.length, blocks, layout);
      assert.ok(signatureYs.every((y) => y + 48 < boxTop), 'name/date lines remain above the cancellation box');
      const noteY = /y="(\d+)"[^>]*>ผู้เบิกและผู้อนุมัติ/.exec(svg)?.[1];
      if (layout === 'TWO_SIGNERS') assert.ok(Number(noteY) < boxTop, 'the same-person line stays above the box');
    }
    assert.doesNotMatch(renderReimbursementClaimFormSvg(snapshot()).toString(), /CANCELLED|เหตุผลการยกเลิกเอกสาร/);
    assert.match(renderReimbursementClaimFormSvg(snapshot({ cancellation: { reason: null } })).toString(), /ไม่ได้ระบุเหตุผลการยกเลิก/);
  });

  it('states when policy skipped human approval instead of implying a missing signer', () => {
    const skipped = { approvalDecisionNote: 'ไม่ต้องอนุมัติตามนโยบาย', signers: { ...snapshot().signers, approver: null } };
    // Two-signer form: the note fills the approver block, which offers no blank line to sign.
    for (const artifact of bothRenderings(snapshot(skipped))) {
      assert.match(artifact, /ผู้อนุมัติ<\/text>\s*<text x="615" y="\d+" text-anchor="middle" font-size="13">ไม่ต้องอนุมัติตามนโยบาย<\/text>/);
      assert.equal((artifact.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 0);
      assert.equal([...artifact.matchAll(SIGNING_LINE)].length, 1, 'only ผู้เบิก keeps a ลงชื่อ line');
    }
    // Legacy form: the heading note, exactly as before.
    for (const artifact of bothRenderings(snapshot({ ...skipped, layout: 'LEGACY_FOUR_SIGNERS' }))) {
      assert.match(artifact, /การอนุมัติ — ไม่ต้องอนุมัติตามนโยบาย/);
    }
  });

  it('prints two half-page signer blocks and the repayment facts as text (D3)', () => {
    const base = snapshot();
    const input = snapshot({ signers: { ...base.signers, requester: { ...base.signers.requester!, signatureDataUrl: 'data:image/png;base64,AAAB' } } });
    for (const artifact of bothRenderings(input)) {
      // Blocks at x=45 and x=425, 380px each, so centred at 235 and 615.
      assert.match(artifact, /<text x="235" y="\d+" text-anchor="middle" font-weight="600">ผู้เบิก<\/text>/);
      assert.match(artifact, /<text x="615" y="\d+" text-anchor="middle" font-weight="600">ผู้อนุมัติ<\/text>/);
      assert.equal([...artifact.matchAll(SIGNING_LINE)].length, 2);
      assert.doesNotMatch(artifact, /ฝ่ายบัญชี|ฝ่ายการเงิน|ปรีชา บัญชี/, 'no accounting or payer block');
      assert.match(artifact, /<image href="data:image\/png;base64,AAAB" x="195"/);
      assert.match(artifact, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี โอนเงิน เลขอ้างอิง TXN-1 บันทึกโดย สุดา การเงิน/);
      const at = (text: string) => artifact.indexOf(text);
      assert.ok(at('จำนวนเงินรวม (ตัวอักษร)') < at('การจ่ายเงินคืน') && at('การจ่ายเงินคืน') < at('เอกสารแนบ'), 'under the table, above the checklist');
      assert.doesNotMatch(artifact, /บุคคลเดียวกัน/, 'two different people');
    }
  });

  it('says ยังไม่จ่าย until a payment is recorded', () => {
    for (const artifact of bothRenderings(snapshot({ repayment: null }))) {
      assert.match(artifact, /การจ่ายเงินคืน: ยังไม่จ่าย/);
      assert.doesNotMatch(artifact, /จ่ายเมื่อ/);
    }
  });

  it('states once, under both blocks, that the requester approved their own claim', () => {
    const owner = { name: 'เจ้าของร้าน', at: '2026-07-20T03:00:00.000Z', signatureDataUrl: 'data:image/png;base64,AAAB' };
    const input = snapshot({ selfApproved: true, signers: { requester: owner, approver: owner, accounting: null, finance: null } });
    for (const artifact of bothRenderings(input)) {
      assert.equal((artifact.match(/ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน อนุมัติรายการของตนเองตามนโยบายบริษัท/g) ?? []).length, 1);
      assert.equal((artifact.match(/<image href=/g) ?? []).length, 2, 'one signature fills both blocks');
      const noteY = Number(/y="(\d+)"[^>]*>ผู้เบิกและผู้อนุมัติ/.exec(artifact)![1]);
      const dateYs = [...artifact.matchAll(/y="(\d+)"[^>]*>วันที่ 20/g)].map((m) => Number(m[1]));
      assert.equal(dateYs.length, 2);
      assert.ok(dateYs.every((y) => y < noteY), 'printed under the blocks');
    }
  });

  // B19 (impact audit 2026-10-01): the form printed the UTC calendar day of every instant, so a
  // claim submitted, approved or paid between midnight and 07:00 Thai time was dated the day before
  // what its own page showed.
  it('dates the form by the Thai day an instant fell on: 18:30Z prints the next day', () => {
    // 18:30Z on the 20th is 01:30 on the 21st in Thailand.
    const early = snapshot({
      layout: 'LEGACY_FOUR_SIGNERS',
      submittedAt: '2026-07-20T18:30:00.000Z',
      signers: {
        requester: { name: 'สมชาย ใจดี', at: '2026-07-20T18:30:00.000Z' },
        // Midnight exactly, Thai time, is already the new day.
        approver: { name: 'มานี ผู้จัดการ', at: '2026-07-21T17:00:00.000Z' },
        // One second before it is still the old one.
        accounting: { name: 'ปรีชา บัญชี', at: '2026-07-22T16:59:59.000Z' },
        // Across a year end: 31 Dec 2026 23:30Z is 1 Jan 2570 (B.E.) in Thailand.
        finance: { name: 'สุดา การเงิน', at: '2026-12-31T23:30:00.000Z' },
      },
    });
    for (const artifact of bothRenderings(early)) {
      assert.match(artifact, /วันที่: 21 ก\.ค\. 2569/, 'the submit date in the heading');
      assert.doesNotMatch(artifact, /วันที่: 20 ก\.ค\. 2569/);
      for (const [name, date] of [
        ['สมชาย ใจดี', '21 ก.ค. 2569'],
        ['มานี ผู้จัดการ', '22 ก.ค. 2569'],
        ['ปรีชา บัญชี', '22 ก.ค. 2569'],
        ['สุดา การเงิน', '1 ม.ค. 2570'],
      ]) {
        const block = artifact.slice(artifact.indexOf(`( ${name} )`));
        assert.match(block.slice(0, 400), new RegExp(`วันที่ ${date!.replace(/\./g, '\\.')}`), name);
      }
      // A line's date is a calendar day, stored at UTC midnight: it prints as entered.
      for (const day of ['15', '16', '17']) assert.match(artifact, new RegExp(`${day} ก\\.ค\\. 2569`));
    }

    // The two-signer form states the payment in words: its date follows the same rule, and a
    // payment date picked on the web (UTC midnight of the chosen day) prints as the day picked.
    const paidLate = renderReimbursementClaimFormPages(snapshot({ repayment: { paidAt: '2026-07-23T18:30:00.000Z', method: 'BANK_TRANSFER', reference: 'TXN-1', recordedByName: 'สุดา การเงิน' } })).map(String).join('');
    assert.match(paidLate, /จ่ายเมื่อ 24 ก\.ค\. 2569/);
    const paidOnPickedDay = renderReimbursementClaimFormPages(snapshot({ repayment: { paidAt: '2026-07-23T00:00:00.000Z', method: 'CASH', reference: null, recordedByName: 'สุดา การเงิน' } })).map(String).join('');
    assert.match(paidOnPickedDay, /จ่ายเมื่อ 23 ก\.ค\. 2569/);
    // A date-only line value, as older callers pass it, is unchanged too.
    const dateOnly = renderReimbursementClaimFormSvg(snapshot({ lines: [{ lineNo: 1, incurredDate: '2026-09-10', description: 'ค่าแท็กซี่', purpose: null, amount: '10.0000' }], totalAmount: '10.0000' })).toString('utf8');
    assert.match(dateOnly, /10 ก\.ย\. 2569/);
  });

  it('renders Thai baht text without losing satang', () => {
    assert.equal(thaiBahtText('0'), 'ศูนย์บาทถ้วน');
    assert.equal(thaiBahtText('1250.5000'), 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์');
    assert.equal(thaiBahtText('21.25'), 'ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
  });

  it('renders a fully signed legacy claim: title block, 3-line table, total in words, ticked receipt, four signers', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({ layout: 'LEGACY_FOUR_SIGNERS', selfApproved: true })).toString('utf8');

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
    // The legacy form is reprinted as it was signed: no repayment or same-person line.
    assert.doesNotMatch(artifact, /การจ่ายเงินคืน|บุคคลเดียวกัน/);
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
      repayment: { paidAt: '2026-07-23T03:00:00.000Z', method: 'OTHER', reference: '<script>ref</script>', recordedByName: 'ผู้จ่าย <img src=x>' },
    })).toString('utf8');

    // Every angle bracket is escaped, so no tag (and therefore no handler) can form.
    assert.doesNotMatch(artifact, /<script|<img|<b>|foreignObject/);
    assert.match(artifact, /&lt;script&gt;/);
    assert.match(artifact, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(artifact, /&amp;/);
    assert.match(artifact, /สาขา: สาขา &amp; ศูนย์/);
    assert.match(artifact, /เลขอ้างอิง &lt;script&gt;ref&lt;\/script&gt; บันทึกโดย ผู้จ่าย &lt;img src=x&gt;/);
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
    // Requester signed; the approver block prints blank ruled name and date lines.
    assert.match(artifact, /\( สมชาย ใจดี \)/);
    assert.equal((artifact.match(/\(\s+\.{20}\s+\)/g) ?? []).length, 1);
    assert.equal((artifact.match(/วันที่ \.{18}/g) ?? []).length, 1);
    assert.equal((artifact.match(/ผู้อนุมัติ|ฝ่ายบัญชี|ฝ่ายการเงิน/g) ?? []).length, 1, 'the approver role still prints for wet-ink signing');
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

  // One payment record, one truth: the box follows the slip the claim page shows on that payment.
  it('ticks หลักฐานการชำระเงิน when the printed payment has a slip, on the two-signer form only', () => {
    const ticked = (input: ReimbursementClaimFormSnapshot) => bothRenderings(input).map((artifact) => (artifact.match(/<path d="M/g) ?? []).length);
    assert.deepEqual(ticked(snapshot()), [1, 1], 'no slip: only ใบเสร็จรับเงิน');
    assert.deepEqual(ticked(snapshot({ hasPaymentEvidence: false })), [1, 1]);
    assert.deepEqual(ticked(snapshot({ hasPaymentEvidence: true })), [2, 2], 'receipt and payment evidence');
    assert.deepEqual(ticked(snapshot({ hasPaymentEvidence: true, hasReceiptEvidence: false })), [1, 1]);
    for (const artifact of bothRenderings(snapshot({ hasPaymentEvidence: true }))) {
      // The tick sits in the หลักฐานการชำระเงิน box (x=392), not in ใบกำกับภาษี or อื่น ๆ.
      assert.match(artifact, /<path d="M395 \d+ l3 4 l6 -8"[^>]*\/><text x="414" y="\d+">หลักฐานการชำระเงิน<\/text>/);
    }
    // The legacy four-block form reprints byte for byte, slip or no slip.
    const legacy = snapshot({ layout: 'LEGACY_FOUR_SIGNERS' });
    assert.deepEqual(bothRenderings({ ...legacy, hasPaymentEvidence: true }), bothRenderings(legacy));
  });

  it('draws a stored signature above the ลงชื่อ line and leaves unsigned roles ruled (lane F)', () => {
    const artifact = renderReimbursementClaimFormSvg(snapshot({
      layout: 'LEGACY_FOUR_SIGNERS',
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

// Payout spec §17.1: the four-block form, and the form of a claim sent before claims carried a
// receiving account, print as they always did, letter for letter. These digests are of the bytes the
// renderer produced BEFORE the payout line was added (they were committed on their own, against the
// untouched renderer), so they pin the old print and not the new code's opinion of it. Every text
// here fits its line, so no digest depends on where a Thai dictionary breaks a word.
describe('prints that predate the payout line are unchanged, byte for byte', () => {
  const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const base = snapshot();
  const unapproved = { ...base.signers, approver: null, accounting: null, finance: null };
  const signed = { ...base.signers, requester: { ...base.signers.requester!, signatureDataUrl: 'data:image/png;base64,AAAB' } };
  const prints: Array<[string, Partial<ReimbursementClaimFormSnapshot>, string, string]> = [
    ['four blocks, fully signed', { layout: 'LEGACY_FOUR_SIGNERS' }, '99698fee62531f3fa0376094307c8f801991ec98f75bfd1a22bbeeed3556ffcc', '6c55175fdbf1ae5e59258b64887a60162450a72fb7e681ce2510cd0b220a2dfe'],
    ['four blocks, waiting for approval, receipt waived', { layout: 'LEGACY_FOUR_SIGNERS', signers: unapproved, hasReceiptEvidence: false, missingReceiptReason: 'ร้านค้าไม่ออกใบเสร็จ' }, '83d79a0f65a13ccd7b2341b215ddd7d2229cc06b8cf5278737f7c0ebe0b8c1bb', '03ee4956983f743857f3a2843c9425cdd772fab868b8cbe1c3e1b90a939a6bd4'],
    ['four blocks, approval skipped by policy', { layout: 'LEGACY_FOUR_SIGNERS', signers: unapproved, approvalDecisionNote: 'ไม่ต้องอนุมัติตามนโยบาย' }, '02ec24c13ac2f69e06f72acdf0e5ad972034c427a5a2078c23a25062dae0ecaf', 'e2b4b95a50bb82063e2613407938d1b25b99240b0f9166ae7ad562202a41f048'],
    ['four blocks, signed on screen, cancelled', { layout: 'LEGACY_FOUR_SIGNERS', signers: signed, cancellation: { reason: 'บันทึกซ้ำ' } }, '0cbd38c68e9b46be506b249c3879efa4b4c3a654f4dfd474c138661eb0a7acd9', '7bab863947db7f39e866841ca200257c5d6af3c88ab6a712d687666eef62c75e'],
    ['two blocks, paid by transfer', {}, '7f05fa5de4f86022c64de84b041464fb98d82148d9e6f8d6e3feba5f1ac9902a', '64e7374821c409165f36676a72b5bc7c19172e2418bd378bb09e4ae9078e3d70'],
    ['two blocks, waiting for approval, not paid', { signers: unapproved, repayment: null }, 'e5fb330697f129289f54e7c318ce1b0145aa517ccf685be5849dbcca721892d8', '697ebf449fed9e25f2890dc4ef77fce5dd7b8cdbd78ae5031d3dd5347d1be792'],
    ['two blocks, own approval, paid in cash with a slip', { selfApproved: true, hasPaymentEvidence: true, repayment: { ...base.repayment!, method: 'CASH', reference: null } }, 'efed6dd67933e9477fc022f45a3238363613f6c404a4e25fdd6262330ff9c55c', '405df586737ba0cd2e017654084c824c1543c2dc2042b8a98d75145f5a3fefdf'],
    ['two blocks, approval skipped by policy, cancelled', { signers: unapproved, approvalDecisionNote: 'ไม่ต้องอนุมัติตามนโยบาย', cancellation: { reason: 'บันทึกซ้ำ' } }, '52aaa250838ecf81aae9876ce02b916f78a6b326b29b2429c9c65855692ce95e', '0affadcd29c054c613dc459d1d991124af637f12c6ca154066bcab9100cf9986'],
    ['two blocks, 65 lines over several pages', {
      lines: Array.from({ length: 65 }, (_, i) => ({ lineNo: i + 1, incurredDate: '2026-09-10', description: `ROW-${i + 1}-END รายการค่าใช้จ่าย`, purpose: 'กิจการ', amount: '10.00' })),
      totalAmount: '650.00',
    }, '10c2e04202293608b64b22df98a5d3318664c913ab596113041a87fe65a5d7a6', 'f9791cbb6e221c98d04cc9cabcca905307194fc26d87c2d77541b5235e00d96a'],
  ];

  for (const [name, overrides, single, pages] of prints) {
    it(name, () => {
      const input = snapshot(overrides);
      assert.deepEqual(
        [sha256(renderReimbursementClaimFormSvg(input)), sha256(Buffer.concat(renderReimbursementClaimFormPages(input)))],
        [single, pages],
      );
    });
  }
});

// Payout spec §17.1, AC36: the two-signer form of a claim that carries its own receiving account says
// how the requester is paid back, under their name. The renderer does not know who asked for the
// print: it prints the full number when it is handed one, and the last 4 digits otherwise.
describe('claim form payout line', () => {
  const NUMBER = '0045671234';
  const bank: ClaimFormPayout = { method: 'BANK_TRANSFER', kind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '1234', verifier: null };
  const promptPay: ClaimFormPayout = { method: 'BANK_TRANSFER', kind: 'PROMPTPAY_PHONE', bankName: null, accountName: 'นาย สมชาย ใจดี', accountLast4: '5678', verifier: null };
  const verifier = { name: 'มานี ผู้จัดการ', at: '2026-07-21T03:00:00.000Z' };
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  /** The lines under the requester's name, as printed: one entry per page that carries them. */
  function payoutBlocks(artifact: string): Array<{ lines: string[]; condensed: boolean }> {
    return [...artifact.matchAll(/<text x="45" y="224">(.*?)<\/text>/g)].map((block) => {
      const spans = [...block[1]!.matchAll(/<tspan x="45" dy="(\d+)"([^>]*)>([^<]*)<\/tspan>/g)];
      assert.deepEqual(spans.map((span) => span[1]), spans.map((_, index) => (index === 0 ? '0' : '22')), 'one line every 22px');
      return { lines: spans.map((span) => span[3]!), condensed: spans.some((span) => span[2]!.includes('textLength')) };
    });
  }
  /** Where the table starts: the first ruled box at the left margin. */
  const tableTop = (artifact: string) => Number(/<rect x="45" y="(\d+)" width="760"/.exec(artifact)![1]);
  const signatureTop = (artifact: string) => Number(/<text x="235" y="(\d+)" text-anchor="middle" font-weight="600">ผู้เบิก</.exec(artifact)![1]);

  it('prints a transfer with the last 4 digits by default, and with the full number only when handed one', () => {
    for (const masked of [bank, { ...bank, accountNumber: undefined }, { ...bank, accountNumber: '' }]) {
      for (const artifact of bothRenderings(snapshot({ payout: masked }))) {
        assert.deepEqual(payoutBlocks(artifact)[0]!.lines, ['รับเงินคืนทาง: โอนเข้าบัญชี ธนาคารกสิกรไทย ชื่อบัญชี นาย สมชาย ใจดี เลขบัญชีลงท้าย 1234']);
      }
    }
    for (const artifact of bothRenderings(snapshot({ payout: { ...bank, accountNumber: NUMBER } }))) {
      assert.deepEqual(payoutBlocks(artifact)[0]!.lines, ['รับเงินคืนทาง: โอนเข้าบัญชี ธนาคารกสิกรไทย ชื่อบัญชี นาย สมชาย ใจดี เลขบัญชี 0045671234']);
      assert.doesNotMatch(artifact, /รับเงินคืนทาง[^<]*ลงท้าย/);
    }
  });

  it('prints a PromptPay number by the same rule, with no bank', () => {
    for (const artifact of bothRenderings(snapshot({ payout: promptPay }))) {
      assert.deepEqual(payoutBlocks(artifact)[0]!.lines, ['รับเงินคืนทาง: พร้อมเพย์เบอร์ลงท้าย 5678 ชื่อบัญชี นาย สมชาย ใจดี']);
    }
    for (const artifact of bothRenderings(snapshot({ payout: { ...promptPay, accountNumber: '0810005678' } }))) {
      assert.deepEqual(payoutBlocks(artifact)[0]!.lines, ['รับเงินคืนทาง: พร้อมเพย์เบอร์ 0810005678 ชื่อบัญชี นาย สมชาย ใจดี']);
      assert.doesNotMatch(artifact, /ธนาคาร|โอนเข้าบัญชี|รับเงินคืนทาง[^<]*ลงท้าย/);
    }
  });

  it('says รับเป็นเงินสด for a cash claim, with no account and nobody to have checked one', () => {
    const cash = snapshot({ payout: { method: 'CASH' }, repayment: { paidAt: '2026-07-23T03:00:00.000Z', method: 'CASH', reference: null, recordedByName: 'สุดา การเงิน' } });
    for (const artifact of bothRenderings(cash)) {
      assert.deepEqual(payoutBlocks(artifact)[0]!.lines, ['รับเงินคืนทาง: รับเป็นเงินสด']);
      assert.doesNotMatch(artifact, /ผู้ตรวจบัญชี|ชื่อบัญชี|เลขบัญชี|พร้อมเพย์|ลงท้าย/);
      assert.match(artifact, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี เงินสด เลขอ้างอิง - บันทึกโดย สุดา การเงิน/);
    }
  });

  it('names whoever attested the account, with the Thai day they did, on a line of its own', () => {
    for (const payout of [bank, promptPay]) {
      const [account] = payoutBlocks(renderReimbursementClaimFormSvg(snapshot({ payout })).toString())[0]!.lines;
      for (const artifact of bothRenderings(snapshot({ payout: { ...payout, verifier } }))) {
        assert.deepEqual(payoutBlocks(artifact)[0]!.lines, [account, 'ผู้ตรวจบัญชี มานี ผู้จัดการ วันที่ 21 ก.ค. 2569']);
      }
    }
    // 18:30Z on the 21st is the 22nd in Thailand, as every other date on the form.
    const late = renderReimbursementClaimFormSvg(snapshot({ payout: { ...bank, verifier: { ...verifier, at: '2026-07-21T18:30:00.000Z' } } })).toString();
    assert.equal(payoutBlocks(late)[0]!.lines[1], 'ผู้ตรวจบัญชี มานี ผู้จัดการ วันที่ 22 ก.ค. 2569');
    // Nobody has: the line is not printed, and nothing stands in for it.
    assert.doesNotMatch(renderReimbursementClaimFormSvg(snapshot({ payout: bank })).toString(), /ผู้ตรวจบัญชี/);
  });

  it('sits under the requester name and pushes the table down by its own height, leaving the foot of the sheet alone', () => {
    const [plainSingle, plainPages] = bothRenderings(snapshot()) as [string, string];
    for (const [payout, lines] of [[{ method: 'CASH' }, 1], [bank, 1], [{ ...bank, verifier }, 2]] as Array<[ClaimFormPayout, number]>) {
      const [single, pages] = bothRenderings(snapshot({ payout })) as [string, string];
      for (const [artifact, plain] of [[single, plainSingle], [pages, plainPages]] as const) {
        assert.equal(payoutBlocks(artifact)[0]!.lines.length, lines);
        const at = (text: string) => artifact.indexOf(text);
        assert.ok(at('ผู้ขอเบิก:') < at('รับเงินคืนทาง:') && at('รับเงินคืนทาง:') < at('ลำดับ'), 'between the requester and the table');
        assert.deepEqual([tableTop(plain), tableTop(artifact)], [218, 218 + 22 * lines]);
        assert.equal(signatureTop(artifact), signatureTop(plain), 'the signature row stays at the foot of the sheet');
        assert.match(artifact, /width="850" height="1202"/, 'a short claim is still one A4 sheet');
      }
    }
  });

  it('prints the number exactly as stored: leading zeros kept, no grouping, whole on one line', () => {
    for (const accountNumber of ['000123', NUMBER, '00123456789012345678']) {
      for (const artifact of bothRenderings(snapshot({ payout: { ...bank, accountNumber } }))) {
        assert.equal(count(artifact, `เลขบัญชี ${accountNumber}</tspan>`), 1);
        assert.equal(count(artifact, accountNumber), 1, 'once, on the รับเงินคืนทาง line');
      }
    }
  });

  it('states the account a transfer went into on the payment line with the last 4 digits, whoever reads it', () => {
    const paid = (paidInto: NonNullable<ReimbursementClaimFormSnapshot['repayment']>['paidInto']) => ({ ...snapshot().repayment!, paidInto });
    // The full number is on the รับเงินคืนทาง line and nowhere else, also when the form is handed it.
    for (const payout of [bank, { ...bank, accountNumber: NUMBER }]) {
      for (const artifact of bothRenderings(snapshot({ payout, repayment: paid({ kind: 'BANK_ACCOUNT', accountLast4: '1234' }) }))) {
        assert.match(artifact, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี โอนเงิน เข้าบัญชีลงท้าย 1234 เลขอ้างอิง TXN-1 บันทึกโดย สุดา การเงิน/);
        assert.equal(count(artifact, NUMBER), payout.accountNumber ? 1 : 0);
      }
    }
    for (const artifact of bothRenderings(snapshot({ payout: promptPay, repayment: paid({ kind: 'PROMPTPAY_PHONE', accountLast4: '5678' }) }))) {
      assert.match(artifact, /วิธี โอนเงิน เข้าพร้อมเพย์เบอร์ลงท้าย 5678 เลขอ้างอิง TXN-1/);
    }
    // No account was confirmed (cash, a cheque, or a transfer elsewhere): the line is the one it always was.
    for (const artifact of bothRenderings(snapshot({ payout: bank }))) {
      assert.match(artifact, /การจ่ายเงินคืน: จ่ายเมื่อ 23 ก\.ค\. 2569 วิธี โอนเงิน เลขอ้างอิง TXN-1 บันทึกโดย สุดา การเงิน/);
    }
  });

  it('ticks หลักฐานการชำระเงิน from the slip alone, whatever the claim asks to be paid by', () => {
    const ticks = (input: ReimbursementClaimFormSnapshot) => bothRenderings(input).map((artifact) => count(artifact, '<path d="M'));
    for (const payout of [bank, promptPay, { method: 'CASH' } as ClaimFormPayout]) {
      assert.deepEqual(ticks(snapshot({ payout })), [1, 1], 'the receipt box only');
      assert.deepEqual(ticks(snapshot({ payout, hasPaymentEvidence: true })), [2, 2]);
    }
  });

  it('leaves the four-block form, and a claim with no receiving account, exactly as they print without it', () => {
    const fourBlocks = snapshot({ layout: 'LEGACY_FOUR_SIGNERS' });
    const handedEverything = {
      payout: { ...bank, accountNumber: NUMBER, verifier },
      repayment: { ...fourBlocks.repayment!, paidInto: { kind: 'BANK_ACCOUNT' as const, accountLast4: '1234' } },
    };
    assert.deepEqual(bothRenderings({ ...fourBlocks, ...handedEverything }), bothRenderings(fourBlocks));
    assert.deepEqual(bothRenderings(snapshot({ payout: null })), bothRenderings(snapshot()));
    assert.deepEqual(bothRenderings(snapshot({ payout: undefined })), bothRenderings(snapshot()));
    for (const artifact of bothRenderings(snapshot())) assert.doesNotMatch(artifact, /รับเงินคืนทาง|ผู้ตรวจบัญชี|ลงท้าย/);
  });

  it('escapes what people typed as the bank and the account name', () => {
    const hostile = { ...bank, bankName: 'ธนาคาร <b>ปลอม</b>', accountName: 'สมชาย <script>alert(1)</script> & co', accountNumber: NUMBER };
    for (const artifact of bothRenderings(snapshot({ payout: hostile }))) {
      assert.doesNotMatch(artifact, /<script|<b>/);
      // Wherever the line wraps, the markup characters are entities in every piece of it.
      assert.equal(
        payoutBlocks(artifact)[0]!.lines.join('').replace(/\s+/g, ''),
        'รับเงินคืนทาง: โอนเข้าบัญชี ธนาคาร &lt;b&gt;ปลอม&lt;/b&gt; ชื่อบัญชี สมชาย &lt;script&gt;alert(1)&lt;/script&gt; &amp; co เลขบัญชี 0045671234'.replace(/\s+/g, ''),
      );
    }
  });

  // The longest account the product accepts: an 80-character bank name, a 140-character account name
  // and a 20-digit number, with a long name for whoever checked it.
  describe('the longest account stays on the sheet', () => {
    const longNumber = '00123456789012345678';
    const bankName = 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร '.repeat(3).slice(0, 80);
    const checker = { name: 'มานี ผู้จัดการฝ่ายบัญชีและการเงินประจำสำนักงานใหญ่และสาขาทั่วประเทศ', at: '2026-07-21T03:00:00.000Z' };
    const names: Array<[string, string]> = [
      ['Thai words with spaces', 'ห้างหุ้นส่วนจำกัด สมชายและเพื่อนการค้าวัสดุก่อสร้าง '.repeat(3).slice(0, 140)],
      ['Thai with no space at all', 'นายสมชายใจดีมากจริง'.repeat(8).slice(0, 140)],
      ['one unbroken Latin word', 'SOMCHAI'.repeat(20)],
    ];
    const squeeze = (text: string) => text.replace(/\s+/g, '');

    for (const [kind, accountName] of names) {
      const payout: ClaimFormPayout = { ...bank, bankName, accountName, accountLast4: '5678', accountNumber: longNumber, verifier: checker };
      const sentence = `รับเงินคืนทาง: โอนเข้าบัญชี ${bankName} ชื่อบัญชี ${accountName} เลขบัญชี ${longNumber}ผู้ตรวจบัญชี ${checker.name} วันที่ 21 ก.ค. 2569`;

      it(`${kind}: wraps inside the margins, loses nothing and keeps the number whole, on one sheet and across pages`, () => {
        assert.deepEqual([bankName.length, accountName.length, longNumber.length], [80, 140, 20]);
        const short = snapshot({ payout });
        const long = snapshot({
          payout, totalAmount: '650.00',
          lines: Array.from({ length: 65 }, (_, i) => ({ lineNo: i + 1, incurredDate: '2026-09-10', description: `ROW-${i + 1}-END รายการค่าใช้จ่าย`, purpose: 'กิจการ', amount: '10.00' })),
        });
        for (const input of [short, long]) {
          const single = renderReimbursementClaimFormSvg(input).toString();
          const pages = renderReimbursementClaimFormPages(input).map(String);
          const [block] = payoutBlocks(single);
          assert.ok(block!.lines.length >= 4, `wrapped into ${block!.lines.length} lines`);
          assert.equal(squeeze(block!.lines.join('')), squeeze(sentence), 'every character is printed, in order');
          assert.equal(block!.condensed, false, 'each line fits the sheet by the measure the body text is wrapped with');
          assert.equal(block!.lines.filter((line) => line.includes(longNumber)).length, 1, 'the number is on one line, unbroken');
          assert.equal(tableTop(single), 218 + 22 * block!.lines.length);

          // The tall image grows with its content and keeps the signature row at its foot.
          const height = Number(/height="(\d+)"/.exec(single)![1]);
          assert.ok(height >= 1202);
          assert.equal(signatureTop(single), height - 150);

          // Every A4 page repeats the same lines in its header and starts its table under them.
          assert.equal(pages.length > 1, input === long);
          for (const [index, page] of pages.entries()) {
            assert.match(page, /width="850" height="1202" viewBox="0 0 850 1202"/);
            assert.match(page, new RegExp(`หน้า ${index + 1} / ${pages.length}`));
            assert.deepEqual(payoutBlocks(page), [block]);
            if (page.includes('data-claim-row')) assert.equal(tableTop(page), tableTop(single));
            const lowest = Math.max(...[...page.matchAll(/ y[12]?="(\d+(?:\.\d+)?)"/g)].map((match) => Number(match[1])));
            assert.ok(lowest <= 1202 - 24, `nothing is drawn below the bottom margin (lowest y ${lowest})`);
          }
          const all = pages.join('');
          for (const row of input.lines) {
            assert.equal(count(all, `data-claim-row="${row.lineNo}" data-row-continuation="false"`), 1);
            assert.equal(count(all, `data-claim-amount="${row.lineNo}"`), 1);
          }
          assert.deepEqual([count(all, 'data-claim-total'), count(all, 'data-claim-signatures'), count(all, 'การจ่ายเงินคืน:')], [1, 1, 1]);
          assert.equal(signatureTop(pages.at(-1)!), 1202 - 24 - 150);
          for (const artifact of [single, ...pages]) assert.doesNotMatch(artifact, /NaN|Infinity|undefined/);
        }
      });
    }
  });
});

describe('claim form layout and documentSignedVia', () => {
  const rows = (...roles: string[]) => roles.map((role) => ({ role: role as any }));
  const claim = (roles: string[], extra: Record<string, unknown> = {}) => ({ claimSignatures: rows(...roles), financeReviewStatus: 'NOT_REQUIRED', ...extra });
  const autoApproved = {
    schemaVersion: 1, policyId: 'p-1', policyVersion: 'v1', approvalRequiredFromAmount: '1000.00', requiresApproval: false,
    route: null, allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'WARN', financeReviewRequired: false,
  };

  it('keeps the four-block form only for a claim already signed in the accounting or payer block', () => {
    assert.equal(claimFormLayout(), 'TWO_SIGNERS');
    // Requester/approver signatures made before the change stay valid: the ack hash never folds the layout.
    assert.equal(claimFormLayout(rows('REQUESTER', 'APPROVER')), 'TWO_SIGNERS');
    assert.equal(claimFormLayout(rows('REQUESTER', 'FINANCE_REVIEW')), 'LEGACY_FOUR_SIGNERS');
    assert.equal(claimFormLayout(rows('PAYER')), 'LEGACY_FOUR_SIGNERS');
  });

  it('derives DIGITAL, PAPER, BOTH and null from signature rows and an acknowledged scan (A4)', () => {
    assert.equal(documentSignedVia(claim([]), false), null);
    assert.equal(documentSignedVia(claim(['REQUESTER']), false), null, 'the approver block is still unsigned');
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER']), false), 'DIGITAL');
    assert.equal(documentSignedVia(claim([]), true), 'PAPER');
    assert.equal(documentSignedVia(claim(['REQUESTER']), true), 'BOTH');
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER']), true), 'BOTH');
    // Policy skipped approval: ผู้เบิก alone completes the two-signer form.
    assert.equal(documentSignedVia(claim(['REQUESTER'], { approvalPolicySnapshotJson: autoApproved }), false), 'DIGITAL');
    // Legacy form: the payer block too, and the accounting block once finance reviewed.
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER', 'PAYER']), false), 'DIGITAL');
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER', 'PAYER'], { financeReviewStatus: 'APPROVED_FOR_PAYMENT' }), false), null);
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER'], { financeReviewStatus: 'APPROVED_FOR_PAYMENT' }), false), 'DIGITAL');
    assert.equal(documentSignedVia(claim(['REQUESTER', 'APPROVER', 'FINANCE_REVIEW'], { financeReviewStatus: 'APPROVED_FOR_PAYMENT' }), false), null, 'unpaid legacy claim: payer block empty');
  });
});
