import { Injectable } from '@nestjs/common';
import type { TaxExportFormat } from '@watchdog-bms/contracts';
import { buildTaxExportArtifact } from '../../domain/logic/tax-export.logic';
import type { TaxExportArtifact } from '../../domain/logic/tax-export.logic';

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
}
