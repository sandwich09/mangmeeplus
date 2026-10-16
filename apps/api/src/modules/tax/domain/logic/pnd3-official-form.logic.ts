import { join } from 'node:path';
import { fitToWidth } from '../../../expenses/domain/logic/substitute-receipt.logic';
import {
  amount, at, digits, numberAndRoad, printablePnd53PayeeAddress, renderOfficialWithholdingForm, thaiDate, tick,
  type Mark, type Pnd53Filing, type Pnd53FilingLine,
} from './pnd53-official-form.logic';

// Original printable forms published by the Revenue Department:
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_WHT3.pdf
// https://www.rd.go.th/fileadmin/tax_pdf/withhold/270360_attach3.pdf
const ASSETS = join(__dirname, '../../assets');
const MAIN = join(ASSETS, 'rd-pnd3-main.pdf');
const ANNEX = join(ASSETS, 'rd-pnd3-attachment.pdf');

/** The same facts as a ภ.ง.ด.53 line. An individual usually has no branch: pass '' and the boxes stay empty. */
export type Pnd3FilingLine = Pnd53FilingLine;
export type Pnd3Filing = Pnd53Filing;

// Every position below is measured from the masters' own rules and boxes (PDF points, y from the
// bottom): digits sit in the middle of their box, text sits on its dotted line.
const MAIN_TAX_ID = [166.6, 183.4, 194.7, 206, 217.4, 234.2, 245.6, 256.9, 268.3, 279.5, 296.7, 308, 324.9];
const MAIN_BRANCH = [281.8, 292.8, 304, 315.1, 326.2];
const MAIN_POSTAL = [96.2, 106.9, 117.5, 128.1, 138.8];
const MONTH_COLUMNS = [343.6, 399.95, 458.25, 512.95];
const MONTH_ROWS = [693.5, 669.75, 645.65];
const ANNEX_PAYER_TAX_ID = [382.9, 400.5, 412.4, 424.3, 436.2, 453.8, 465.8, 477.7, 489.5, 501.5, 519.5, 531.3, 549];
const ANNEX_PAYER_BRANCH = [771.6, 783, 794.4, 806.4, 818.9];
const ANNEX_PAYEE_TAX_ID = [67.8, 85.4, 97.3, 109.2, 121.1, 138.8, 150.7, 162.6, 174.5, 186.3, 204.3, 216.2, 234];
const ANNEX_PAYEE_BRANCH = [291.1, 302.8, 314.6, 327, 339.8];
/** The first dotted line of each of the six payee rows; the next two lines follow 16.85 below. */
const ANNEX_ROWS = [469.7, 414, 358.6, 303.1, 247.5, 192];
const ANNEX_LINE_STEP = 16.85;
// Master field Text1.7 starts at x=276.212; use the same 1.4 pt inset as the first-name slot.
const ANNEX_SURNAME_X = 277.6;

export function splitPnd3PayeeName(name: string): [string, string] {
  const normalized = name.trim().replace(/\s+/gu, ' ');
  const parts = /^((?:(?:นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.) ?)?\S+)(?: (.*))?$/u.exec(normalized);
  return [parts?.[1] ?? '', parts?.[2] ?? ''];
}

export function pnd3MainMarks(filing: Pnd3Filing, payeeCount: number, annexCount: number, totalIncome: number, totalTax: number): Mark[] {
  const marks: Mark[] = [];
  const [year, month] = filing.periodKey.split('-').map(Number);
  digits(marks, MAIN_TAX_ID, 734.6, filing.payerTaxId);
  digits(marks, MAIN_BRANCH, 703.3, filing.payerBranch);
  at(marks, 40.5, 687.6, filing.payerName, 9, 290);
  const [number, road] = numberAndRoad(filing.payerAddress.line1);
  const line2 = filing.payerAddress.line2?.trim();
  if (line2) {
    // The building slot is 61 points wide. A second line that does not fit there goes on the
    // form's unlabelled line beside the postal code, where it stays readable.
    if (!fitToWidth(line2, 61, 7)) at(marks, 90.5, 671.7, line2, 7, 61);
    else at(marks, 152, 607.7, line2, 7, 178);
  }
  at(marks, 60.5, 655.6, number, 8, 75);
  if (road) at(marks, 58, 639.7, road, 7.4, 110);
  at(marks, 215.5, 639.7, filing.payerAddress.subdistrict, 7.4, 116);
  at(marks, 81, 623.6, filing.payerAddress.district, 7.4, 104);
  at(marks, 216.5, 623.6, filing.payerAddress.province, 7.4, 115);
  digits(marks, MAIN_POSTAL, 607.6, filing.payerAddress.postalCode);
  at(marks, 543, 717.1, year + 543, 8, undefined, 'middle');
  tick(marks, MONTH_COLUMNS[Math.floor((month - 1) / 3)]!, MONTH_ROWS[(month - 1) % 3]!);
  // Master Radio Button0 second widget centre; Text1.17 centre and baseline inset.
  if (filing.sequence) { tick(marks, 183.97, 568.51); at(marks, 288.43, 567.9, filing.sequence, 8, undefined, 'middle'); }
  else tick(marks, 87.75, 569.4); // ยื่นปกติ
  tick(marks, 132.7, 526.7); // มาตรา 3 เตรส
  tick(marks, 280.6, 494.4); // ใบแนบ ภ.ง.ด.3
  at(marks, 529.7, 493, payeeCount, 8, undefined, 'middle');
  at(marks, 529.7, 476.1, annexCount, 8, undefined, 'middle');
  amount(marks, 506, 517.8, 334.65, totalIncome, 9);
  amount(marks, 506, 517.8, 316.7, totalTax, 9);
  if (!filing.sequence) {
    amount(marks, 506, 517.8, 298.65, 0, 9);
    amount(marks, 506, 517.8, 280.7, totalTax, 9);
  }
  return marks;
}

function annexMarks(filing: Pnd3Filing, pageNumber: number, pageCount: number, rows: Pnd3FilingLine[][]): Mark[] {
  const marks: Mark[] = [];
  digits(marks, ANNEX_PAYER_TAX_ID, 569.25, filing.payerTaxId);
  digits(marks, ANNEX_PAYER_BRANCH, 571.05, filing.payerBranch);
  at(marks, 722.5, 553.5, pageNumber, 8, undefined, 'middle');
  at(marks, 790, 553.5, pageCount, 8, undefined, 'middle');
  for (const [index, group] of rows.entries()) {
    const top = ANNEX_ROWS[index]!;
    const first = group[0]!;
    at(marks, 39.35, top + 2.2, (pageNumber - 1) * 6 + index + 1, 8, undefined, 'middle');
    digits(marks, ANNEX_PAYEE_TAX_ID, top + 3.4, first.payeeTaxId, 7.7);
    digits(marks, ANNEX_PAYEE_BRANCH, top + 3.4, first.payeeBranch, 7.7);
    const [firstName, surname] = splitPnd3PayeeName(first.payeeName);
    at(marks, 76, top - ANNEX_LINE_STEP + 2.2, firstName, 7.6, 166);
    at(marks, ANNEX_SURNAME_X, top - ANNEX_LINE_STEP + 2.2, surname, 7.6, 124.5);
    const address = printablePnd53PayeeAddress(first.payeeAddress);
    if (!address) throw new Error('PND3 payee address cannot be printed');
    at(marks, 81, top - ANNEX_LINE_STEP * 2 + 2.2, address, 6.8, 320);
    for (const [j, line] of group.entries()) {
      const y = top - j * ANNEX_LINE_STEP + 2.2;
      at(marks, 407, y, thaiDate(line.paidAt), 7);
      at(marks, 469.5, y, line.incomeType, 7, 110);
      at(marks, 594.55, y, line.rate, 7, undefined, 'middle');
      amount(marks, 684.3, 697.4, y, line.income, 7);
      amount(marks, 781.7, 794.05, y, line.withheld, 7);
      at(marks, 814.1, y, '1', 7, undefined, 'middle'); // หัก ณ ที่จ่าย
    }
  }
  amount(marks, 684.3, 697.4, 143.1, rows.flat().reduce((sum, row) => sum + row.income, 0), 8);
  amount(marks, 781.7, 794.05, 143.1, rows.flat().reduce((sum, row) => sum + row.withheld, 0), 8);
  return marks;
}

/** Paper ภ.ง.ด.3 + its attachment sheets, based on the RD masters. A human signs before filing. */
export function renderPnd3OfficialForm(filing: Pnd3Filing): Promise<Buffer> {
  return renderOfficialWithholdingForm({ main: MAIN, annex: ANNEX }, filing, pnd3MainMarks, annexMarks);
}
