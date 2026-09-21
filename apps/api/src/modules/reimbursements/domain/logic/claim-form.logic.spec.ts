import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cancelledDocumentReasonBox } from '../../../../common/documents/cancelled-document';
import {
  claimFormLayout,
  documentSignedVia,
  renderReimbursementClaimFormSvg,
  renderReimbursementClaimFormPages,
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
