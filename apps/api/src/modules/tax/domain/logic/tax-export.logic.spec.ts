import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxExportArtifact } from './tax-export.logic';
import type { TaxExportFormat } from '@watchdog-bms/contracts';

const rows = [
  { sourceType: 'expense.record', sourceId: 'exp_1', taxableBase: '1000.0000', taxAmount: '30.0000' },
  { sourceType: 'accounting.document', sourceId: 'doc_1', taxableBase: '500.0000', taxAmount: '35.0000' },
];
const payload = {
  period: { formType: 'PND53', periodKey: '2026-06', status: 'OPEN' },
  rows,
  reviewIssues: [],
};

describe('tax export artifact logic', () => {
  for (const format of ['REVIEW_JSON', 'CSV', 'XLSX', 'PDF'] as TaxExportFormat[]) {
    it(`builds ${format} artifact with checksum and content`, () => {
      const artifact = buildTaxExportArtifact(format, 'tax-PND53-2026-06', rows, payload);

      assert.ok(artifact.fileName.length > 0);
      assert.ok(artifact.mimeType.length > 0);
      assert.ok(artifact.byteLength > 0);
      assert.match(artifact.checksum, /^[a-f0-9]{64}$/);
      assert.ok(Buffer.from(artifact.contentBase64, 'base64').byteLength > 0);
    });
  }

  it('creates real file signatures for xlsx and pdf', () => {
    const xlsx = Buffer.from(buildTaxExportArtifact('XLSX', 'tax', rows, payload).contentBase64, 'base64');
    const pdf = Buffer.from(buildTaxExportArtifact('PDF', 'tax', rows, payload).contentBase64, 'base64');

    assert.equal(xlsx.subarray(0, 2).toString('utf8'), 'PK');
    assert.equal(pdf.subarray(0, 5).toString('utf8'), '%PDF-');
  });

  it('neutralizes adversarial CSV cells as text', () => {
    const content = Buffer.from(buildTaxExportArtifact('CSV', 'tax', [
      { sourceType: '@SUM(A1:A2)', sourceId: '\t=cmd', taxableBase: '-1', taxAmount: '+1' },
    ], payload).contentBase64, 'base64').toString('utf8');
    assert.equal(content, "sourceType,sourceId,taxableBase,taxAmount\n'@SUM(A1:A2),\"'\t=cmd\",'-1,'+1");
  });
});
