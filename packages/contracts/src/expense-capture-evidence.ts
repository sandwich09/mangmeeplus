import { extractValueCandidates, mapThaiDigits } from './line-ai-value-normalizer.js';
import type { ExpenseCaptureExtractWindow, ExpenseCaptureObservations } from './expense-capture.js';

type Row = Record<string, any>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const canonicalNumber = (value: string): string | undefined => {
  const text = mapThaiDigits(value).normalize('NFKC').replace(/−/g, '-');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return undefined;
  const [whole, fraction = ''] = text.replace(/,/g, '').replace(/^[+-]/, '').split('.');
  const integer = whole!.replace(/^0+(?=\d)/, ''), decimal = fraction.replace(/0+$/, '');
  return `${text.startsWith('-') && (integer !== '0' || decimal) ? '-' : ''}${integer}${decimal ? `.${decimal}` : ''}`;
};
export const expenseCaptureFieldRole = (row: Row, field: string): string => `${row['role'] ?? row['kind'] ?? row['event'] ?? row['state'] ?? row['status'] ?? 'document'}:${field}`;

/** Model row numbers restart in split windows; original page offsets remain stable. */
export const expenseCaptureObservationId = (kind: 'item' | 'component', row: Row): string | undefined => {
  const evidence = row.fieldEvidence?.[kind === 'item' ? 'description' : 'label'];
  return evidence ? `${kind}:p${evidence.pageIndex}:s${evidence.localSpan.start}:e${evidence.localSpan.end}` : undefined;
};

/** API ingress checks the Gateway's v2 locators against the actual source window before saving. */
export function verifyExpenseCaptureFieldEvidenceV2(value: unknown, window: ExpenseCaptureExtractWindow, today: string): value is ExpenseCaptureObservations {
  const source = window.evidenceSource;
  if (!source || source.version !== 2 || !source.attachmentId || !/^[0-9a-f]{64}$/.test(source.checksumSha256) || !object(value) || value['fieldEvidenceVersion'] !== 2) return false;
  const pages = new Map(window.pages.map(page => [page.pageIndex, page]));
  const ownPages = new Map<string, number[]>();
  const fields = {
    documents: { text: ['issuer.name', 'issuer.taxId', 'issuer.branchCode', 'issuer.storefront', 'issuer.platform', 'buyer.name', 'buyer.taxId', 'documentNumber'], number: ['printedPage.number', 'printedPage.of'], date: ['documentDate'], currency: ['currency'] },
    items: { text: ['description', 'unit', 'taxMarker'], number: ['quantity', 'packSize', 'unitPrice', 'amount', 'listPrice'], date: [], currency: [] },
    components: { text: ['label'], number: ['amount'], date: [], currency: ['currency'] },
    totals: { text: [], number: ['amount'], date: [], currency: [] },
    payments: { text: ['method', 'reference'], number: ['amount'], date: ['occurredAt'], currency: [] },
    refunds: { text: ['destination'], number: ['amount'], date: [], currency: [] },
  };
  for (const [collection, groups] of Object.entries(fields)) {
    const rows = value[collection]; if (!Array.isArray(rows)) return false;
    for (const row of rows) {
      if (!object(row)) return false;
      if (collection === 'documents') {
        if (typeof row.ref !== 'string' || ownPages.has(row.ref) || !Array.isArray(row.pageIndexes) || !row.pageIndexes.length
          || row.pageIndexes.some((page: unknown) => !Number.isSafeInteger(page) || !pages.has(Number(page)))) return false;
        ownPages.set(row.ref, row.pageIndexes);
      }
      const selected = ownPages.get(collection === 'documents' ? row.ref : row.documentRef);
      if (!selected) return false;
      if ((collection === 'items' || collection === 'components')
        && row.id !== expenseCaptureObservationId(collection === 'items' ? 'item' : 'component', row)) return false;
      if (collection !== 'documents' && (typeof row.evidenceSpan !== 'string' || !row.evidenceSpan
        || !selected.some(page => pages.get(page)!.text.includes(row.evidenceSpan)))) return false;
      const grouped = { ...groups, number: [...groups.number, ...(collection === 'documents' && Array.isArray(row.printedPages) ? row.printedPages.map((_: unknown, index: number) => `printedPages.${index}`) : [])] };
      for (const [kind, names] of Object.entries(grouped)) for (const field of names) {
        const observed = field.split('.').reduce((part: any, key: string) => part?.[key], row);
        if (observed === undefined) continue;
        const evidence = row.fieldEvidence?.[field];
        if (!object(evidence) || evidence.attachmentId !== source.attachmentId || evidence.checksumSha256 !== source.checksumSha256
          || !selected.includes(evidence.pageIndex) || evidence.role !== expenseCaptureFieldRole(row, field) || !object(evidence.localSpan)
          || !Number.isSafeInteger(evidence.localSpan.start) || !Number.isSafeInteger(evidence.localSpan.end) || typeof evidence.rawValue !== 'string') return false;
        const page = pages.get(evidence.pageIndex)!, start = evidence.localSpan.start - (page.sourceOffset ?? 0), end = evidence.localSpan.end - (page.sourceOffset ?? 0);
        if (start < 0 || end <= start || end > page.text.length || page.text.slice(start, end) !== evidence.rawValue) return false;
        if (collection !== 'documents') {
          let inside = false;
          for (let at = page.text.indexOf(row.evidenceSpan); at >= 0; at = page.text.indexOf(row.evidenceSpan, at + 1)) {
            if (start >= at && end <= at + row.evidenceSpan.length) { inside = true; break; }
          }
          if (!inside) return false;
        }
        const printed = evidence.rawValue, result = String(observed);
        if (kind === 'number') { if (!field.startsWith('printedPage') && typeof observed !== 'string'
          || canonicalNumber(result) === undefined || canonicalNumber(result) !== canonicalNumber(printed)) return false; }
        else if (kind === 'date') { if (!extractValueCandidates(printed, today, { documentContext: 'receipt' }).dates.some(date => date.isoDate === result)) return false; }
        else if (kind === 'currency') { if (printed.toUpperCase() !== result && !(result === 'THB' && /^(?:บาท|฿)$/.test(printed))) return false; }
        else if (mapThaiDigits(printed).normalize('NFKC') !== mapThaiDigits(result).normalize('NFKC')) return false;
      }
    }
  }
  for (const row of [...value.items, ...value.components]) {
    const linked = row.linkedItemId ?? row.parentId;
    if (linked !== undefined && !value.items.some((item: Row) => item.documentRef === row.documentRef && item.id === linked && item !== row)) return false;
  }
  return ownPages.size > 0;
}
