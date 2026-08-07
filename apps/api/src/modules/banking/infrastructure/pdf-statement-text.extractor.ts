import { Injectable } from '@nestjs/common';
import { clusterPdfTextRows, type PdfTextItem } from '../domain/logic/banking.logic';

// pdfjs-dist is ESM-only; swc transpiles import() to require in CJS output,
// so load it through an untranspiled native dynamic import.
const loadPdfjs = (): Promise<any> =>
  (Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')() as Promise<any>);

/** Text items fewer than this = no usable text layer (scanned PDF). */
const MIN_TEXT_ITEMS = 10;
const PAGE_Y_OFFSET = 100_000;

export type PdfTextExtraction =
  | { status: 'ok'; rows: Record<string, string>[] }
  | { status: 'no_text_layer' }
  | { status: 'no_table_header' }
  | { status: 'unreadable' };

@Injectable()
export class PdfStatementTextExtractor {
  async extractRows(pdfBytes: Uint8Array): Promise<PdfTextExtraction> {
    let doc: any;
    try {
      const pdfjs = await loadPdfjs();
      doc = await pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true, isEvalSupported: false }).promise;
    } catch {
      return { status: 'unreadable' };
    }

    try {
      const items: PdfTextItem[] = [];
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent();
        const pageTop = page.view[3];
        for (const item of content.items) {
          if (typeof item.str !== 'string' || item.str.trim() === '') continue;
          items.push({
            str: item.str,
            x: item.transform[4],
            // flip PDF-space y (up) into reading order (down), offset per page
            y: (pageNo - 1) * PAGE_Y_OFFSET + (pageTop - item.transform[5]),
            width: item.width,
          });
        }
      }

      if (items.length < MIN_TEXT_ITEMS) return { status: 'no_text_layer' };

      const { headerFound, rows } = clusterPdfTextRows(items);
      if (!headerFound) return { status: 'no_table_header' };
      return { status: 'ok', rows };
    } catch {
      return { status: 'unreadable' };
    } finally {
      void doc?.destroy?.();
    }
  }
}
