import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PayeeSnapshot, PayerSnapshot, TaxExportFormat } from '@watchdog-bms/contracts';
import { buildTaxExportArtifact } from '../../domain/logic/tax-export.logic';
import type { TaxExportArtifact } from '../../domain/logic/tax-export.logic';
import { renderWhtCertificatePdf } from '../../domain/logic/wht-certificate-pdf.logic';
import type { WhtCertificateFields, WhtCertificateSignature } from '../../domain/logic/wht-certificate-pdf.logic';

/**
 * Thin injectable seam over the pure artifact builder.
 *
 * It exists so that "the closed route rendered no PDF" is an ASSERTABLE fact. While the render was
 * a direct module import, a spec could only observe the writes around it — a regression that began
 * rendering a statutory certificate on a closed legal route would have gone unnoticed by every
 * test. The rendering logic itself stays pure and is still unit-tested directly.
 */
@Injectable()
export class TaxArtifactRendererService {
  render(format: TaxExportFormat, fileStem: string, rows: Parameters<typeof buildTaxExportArtifact>[2], payload: Record<string, unknown>): TaxExportArtifact {
    return buildTaxExportArtifact(format, fileStem, rows, payload);
  }

  /**
   * WHT certificate system issuance plan §2.5 with the 2026-09-23 print correction: the published
   * Revenue Department 50 ทวิ master with a Thai fill-in overlay, never `buildMinimalPdf`/`render('PDF', ...)` above (shared with
   * `GenerateTaxFilingPackageUseCase`'s unrelated tax filing-package export). Used by BOTH the
   * Tax-workspace `CreateWhtCertificateUseCase` and the new AP/Expenses
   * `IssueWhtCertificateFromHandoffUseCase` — the same gate covers both entry points, so both must
   * get the same real PDF.
   */
  async renderWhtCertificate(
    fields: WhtCertificateFields,
    payerSnapshot: PayerSnapshot,
    payeeSnapshot: PayeeSnapshot,
    signature?: WhtCertificateSignature,
    // Correction & replacement plan §4.2: passed straight through to both underlying calls. Neither
    // existing caller (CreateWhtCertificateUseCase, IssueWhtCertificateFromHandoffUseCase) passes
    // these, so their behavior is unchanged — only IssueWhtReplacementCopyUseCase uses the first.
    replacementCopy?: { issuedAt: string },
    options?: { stateStamp?: 'SUPERSEDED' },
  ): Promise<TaxExportArtifact> {
    const buffer = await renderWhtCertificatePdf(fields, payerSnapshot, payeeSnapshot, signature, replacementCopy, options);
    return {
      fileName: `wht-certificate-${fields.certificateNumber}.pdf`,
      mimeType: 'application/pdf',
      contentBase64: buffer.toString('base64'),
      checksum: createHash('sha256').update(buffer).digest('hex'),
      byteLength: buffer.byteLength,
    };
  }
}
