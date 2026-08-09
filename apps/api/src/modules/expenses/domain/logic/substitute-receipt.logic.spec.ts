import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSubstituteCertificationText, canonicalSnapshotHash, renderSubstituteReceiptSvg, thaiBahtText } from './substitute-receipt.logic';

describe('substitute receipt evidence', () => {
  it('renders Thai baht text without losing satang', () => {
    assert.equal(thaiBahtText('0'), 'ศูนย์บาทถ้วน');
    assert.equal(thaiBahtText('21.25'), 'ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์');
    assert.equal(thaiBahtText('1000001'), 'หนึ่งล้านหนึ่งบาทถ้วน');
    assert.equal(thaiBahtText('999999999999.999'), 'หนึ่งล้านล้านบาทถ้วน');
  });

  it('renders a UTF-8 immutable certificate and escapes reviewed values', () => {
    const certificationText = buildSubstituteCertificationText('สมชาย <script>', 'admin');
    const snapshot = {
      documentNumber: 'SRC-EXP-1-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: 'สำนักงานใหญ่', taxId: '0100000000000' },
      expense: {
        id: 'exp-secret-id', expenseNumber: null, expenseDate: '2026-07-13T00:00:00.000Z', paymentDate: null,
        currency: 'THB', grandTotalAmount: '65.00', paymentMethod: 'CASH', paymentReference: null,
        category: 'อาหาร', businessPurpose: 'ซื้อวัตถุดิบ', lines: [{ description: 'ผักสด', quantity: '1', amount: '65.00' }],
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ผู้ขายในตลาดไม่ออกใบเสร็จ',
      payer: { userId: 'user-1', name: 'สมชาย <script>', position: 'admin', certifiedAt: '2026-07-13T10:00:00.000Z' },
      certificationText,
      evidence: [{ id: 'att-secret-id', purpose: 'expense.receipt.supporting', originalFileName: 'หลักฐาน.png', mimeType: 'image/png', checksumSha256: null }],
      note: null,
    };
    const artifact = renderSubstituteReceiptSvg(
      snapshot,
      'data:image/png;base64,aGVsbG8=',
      { userId: 'user-2', name: 'ผู้อนุมัติ', position: 'owner', approvedAt: '2026-07-13T11:00:00.000Z' },
      'data:image/jpeg;base64,d29ybGQ=',
    ).toString('utf8');

    assert.match(artifact, /ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(artifact, /เลขอ้างอิงรายการ: SRC-EXP-1-V1/);
    assert.match(artifact, /หกสิบห้าบาทถ้วน/);
    assert.match(artifact, /13 ก\.\u0e04\. 2569/);
    assert.match(artifact, /บันทึกค่าใช้จ่าย \(ข้อความ\)/);
    assert.match(artifact, /วิธีชำระเงิน: เงินสด/);
    assert.match(artifact, /ผู้ดูแลระบบ/);
    assert.match(artifact, /เจ้าของกิจการ/);
    assert.match(artifact, /หลักฐาน\.png — หลักฐานประกอบ/);
    assert.match(artifact, /<line x1="45" y1="357" x2="805" y2="357"\/>/);
    assert.match(artifact, /<line x1="45" y1="393" x2="805" y2="393"\/>/);
    assert.match(artifact, /<line x1="150" y1="283" x2="150" y2="357"\/>/);
    assert.match(artifact, /<text x="620" y="381" text-anchor="end" font-weight="700">รวมทั้งสิ้น<\/text>/);
    assert.doesNotMatch(artifact, /EXPENSE_NOTE_TEXT|CASH|expense\.receipt\.supporting|att-secret-id|exp-secret-id/);
    assert.doesNotMatch(artifact, /สมชาย <script>/);
    assert.match(artifact, /สมชาย &lt;script&gt;/);
    assert.match(artifact, /มิใช่ใบกำกับภาษี/);
    assert.doesNotMatch(artifact, /ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ/);
    assert.doesNotMatch(artifact, /<script|foreignObject|onload=/);
    const selfSignedArtifact = renderSubstituteReceiptSvg(
      snapshot,
      'data:image/png;base64,aGVsbG8=',
      { userId: 'user-1', name: 'สมชาย', position: 'owner', approvedAt: '2026-07-13T11:00:00.000Z' },
      'data:image/jpeg;base64,d29ybGQ=',
    ).toString('utf8');
    assert.match(selfSignedArtifact, /ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ/);
    assert.equal(canonicalSnapshotHash(snapshot), canonicalSnapshotHash(structuredClone(snapshot)));
    const reverseJsonKeys = (value: unknown): unknown => Array.isArray(value)
      ? value.map(reverseJsonKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseJsonKeys(item)]))
        : value;
    assert.equal(
      canonicalSnapshotHash(snapshot),
      canonicalSnapshotHash(reverseJsonKeys(snapshot) as typeof snapshot),
      'PostgreSQL jsonb key reordering must not invalidate the certified snapshot',
    );
  });

  it('rejects active-content signatures', () => {
    assert.throws(() => renderSubstituteReceiptSvg({} as never, 'data:image/svg+xml;base64,PHN2Zz4='), /PNG or JPEG/);
  });

  it('omits the payee block for a legacy snapshot and grows it for captured payee lines', () => {
    const legacySnapshot = {
      documentNumber: 'SRC-LEGACY-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: null },
      expense: {
        id: 'exp-legacy', expenseNumber: null, expenseDate: '2026-07-13T00:00:00.000Z', paymentDate: null,
        currency: 'THB', grandTotalAmount: '65.00', paymentMethod: 'CASH', paymentReference: null,
        category: 'อาหาร', businessPurpose: 'ซื้อวัตถุดิบ', lines: [{ description: 'ผักสด', quantity: '1', amount: '65.00' }],
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ไม่ได้รับใบเสร็จ',
      payer: { userId: 'user-1', name: 'สมชาย', position: 'staff', certifiedAt: '2026-07-13T10:00:00.000Z' },
      certificationText: buildSubstituteCertificationText('สมชาย', 'staff'), evidence: [], note: null,
    };
    const legacy = renderSubstituteReceiptSvg(legacySnapshot).toString('utf8');
    assert.doesNotMatch(legacy, /ผู้รับเงิน:|ที่อยู่:|เลขประจำตัวประชาชน/);

    const captured = renderSubstituteReceiptSvg({
      ...legacySnapshot,
      payee: { name: 'สมหญิง', address: '1 ถนนทดสอบ', taxId: '1234567890123' },
    }).toString('utf8');
    assert.match(captured, /ผู้รับเงิน: สมหญิง/);
    assert.match(captured, /ที่อยู่: 1 ถนนทดสอบ/);
    assert.match(captured, /เลขประจำตัวประชาชน\/เลขประจำตัวผู้เสียภาษี: 1-2345-67890-12-3/);
    const height = (svg: string) => Number(/<svg[^>]+height="(\d+)"/.exec(svg)?.[1]);
    assert.equal(height(captured) - height(legacy), 66);
  });

  it('wraps long required fields without dropping their trailing content', () => {
    const snapshot = {
      documentNumber: 'SRC-LONG-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: null },
      expense: {
        id: 'exp-long', expenseNumber: null, expenseDate: '2026-07-13T00:00:00.000Z', paymentDate: '2026-07-13T00:00:00.000Z',
        currency: 'THB', grandTotalAmount: '100.00', paymentMethod: 'CASH', paymentReference: null,
        category: 'ทั่วไป', businessPurpose: `${'วัตถุประสงค์'.repeat(50)} END-OF-PURPOSE`,
        lines: [{ description: `${'รายละเอียด'.repeat(40)} END-OF-LINE`, quantity: '1', amount: '100.00' }],
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'OTHER',
      missingReceiptReason: `${'เหตุผล'.repeat(70)} END-OF-REASON`,
      payer: { userId: 'payer-1', name: 'ผู้จ่าย', position: 'พนักงาน', certifiedAt: '0000-01-01T00:00:00.000Z' },
      certificationText: `${'ข้อความรับรอง'.repeat(45)} END-OF-CERTIFICATION`,
      evidence: [{ id: 'att-long', purpose: 'expense.receipt.supporting', originalFileName: `${'หลักฐาน'.repeat(30)} END-OF-FILE.pdf`, mimeType: 'application/pdf', checksumSha256: null }],
      note: null,
    };
    const artifact = renderSubstituteReceiptSvg(snapshot).toString('utf8');
    // Wrapping may break a suffix across two tspans, so read the text, not the markup.
    const text = artifact.replace(/<[^>]+>/g, '');
    for (const suffix of ['END-OF-PURPOSE', 'END-OF-LINE', 'END-OF-REASON', 'END-OF-CERTIFICATION', 'END-OF-FILE.pdf']) {
      assert.match(text, new RegExp(suffix));
    }
    assert.ok((artifact.match(/<tspan/g) ?? []).length > 10);
  });

  it('breaks a single word wider than its column instead of letting it run into the next one', () => {
    // Same defect as the reimbursement claim form: `wrapText` accepted any word verbatim while
    // the line was still empty, so a word wider than the column was never split at all.
    const word = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const artifact = renderSubstituteReceiptSvg({
      documentNumber: 'SRC-WORD-V1', version: 1,
      company: { name: 'บริษัท ทดสอบ จำกัด', branchName: null, taxId: null },
      expense: {
        id: 'exp-word', expenseNumber: null, expenseDate: '2026-07-13T00:00:00.000Z', paymentDate: null,
        currency: 'THB', grandTotalAmount: '100.00', paymentMethod: 'CASH', paymentReference: null,
        category: 'ทั่วไป', businessPurpose: 'ทดสอบ',
        lines: [{ description: word, quantity: '1', amount: '100.00' }],
      },
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'OTHER',
      missingReceiptReason: 'ทดสอบ',
      payer: { userId: 'payer-1', name: 'ผู้จ่าย', position: 'พนักงาน', certifiedAt: '0000-01-01T00:00:00.000Z' },
      certificationText: 'ทดสอบ', evidence: [], note: null,
    }).toString('utf8');

    const pieces = [...artifact.matchAll(/<tspan x="165"[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]!);
    assert.ok(pieces.length > 1, `expected the word to be split, got ${JSON.stringify(pieces)}`);
    assert.equal(pieces.join(''), word, 'no character is dropped by the split');
  });
});
