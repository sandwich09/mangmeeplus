import type { PayeeSnapshot, PayerSnapshot, WhtFormType } from '@watchdog-bms/contracts';
import { renderSubstituteReceiptPdf } from '../../../expenses/domain/logic/substitute-receipt-pdf.logic';
import { fitToWidth, formatThaiTaxId, money, thaiBahtText, wrapText, xml } from '../../../expenses/domain/logic/substitute-receipt.logic';

/**
 * WHT certificate system issuance plan §2.5 — the real 50 ทวิ template, built as its own dedicated
 * SVG rather than reusing/replacing `buildMinimalPdf` (which `GenerateTaxFilingPackageUseCase`
 * shares and must not change). Reuses the substitute-receipt module's SVG-building conventions
 * (font stack, `xml`/`money`/`formatThaiTaxId`/`wrapText`/`thaiBahtText` helpers) and its
 * `renderSubstituteReceiptPdf` raster pipeline directly — no new raster pipeline, no new dependency.
 *
 * Decision A (2026-09-22): v1 is signature-only. There is no seal/stamp param at all — the seal
 * position on the real form stays blank in every case, not a placeholder.
 */

export type WhtCertificateFields = {
  certificateNumber: string;
  formType: WhtFormType;
  incomeCategoryCode: string;
  incomeCategoryName: string;
  whtRate: string;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
  /** When the certificate was minted — printed as the document's own issue date. */
  issuedAt: string;
};

export type WhtCertificateSignature = { mode: 'AUTO_STAMP' | 'BLANK'; signatureImageBase64?: string };

function formatCertDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

const FIELD_WIDTH = 760;

/** Pure — no I/O, no randomness, so a golden-fixture byte comparison is possible in tests. */
export function buildWhtCertificateSvg(
  fields: WhtCertificateFields,
  payerSnapshot: PayerSnapshot,
  payeeSnapshot: PayeeSnapshot,
  signature?: WhtCertificateSignature,
): Buffer {
  const isPnd53 = fields.formType === 'PND53';
  const payerAddressLines = wrapText(`ที่อยู่: ${payerSnapshot.address ?? '-'}`, FIELD_WIDTH);
  const payeeAddressLines = wrapText(`ที่อยู่: ${payeeSnapshot.address ?? '-'}`, FIELD_WIDTH);
  const bahtText = thaiBahtText(fields.withheldAmount);

  let y = 100;
  const payerBlockTop = y;
  y += 26; // name
  y += 26; // taxId + branch
  const payerAddressY = y;
  y += payerAddressLines.length * 20 + 16;
  const payeeBlockTop = y;
  y += 26;
  y += 26;
  const payeeAddressY = y;
  y += payeeAddressLines.length * 20 + 16;
  const formCheckboxY = y + 10;
  y += 46;
  const tableTop = y;
  const tableHeaderHeight = 36;
  const tableRowY = tableTop + tableHeaderHeight + 26;
  const tableBottom = tableRowY + 20;
  const totalTextY = tableBottom + 30;
  const payerCheckboxY = totalTextY + 40;
  const signatureBlockTop = payerCheckboxY + 40;
  const height = signatureBlockTop + 170;

  const signatureImage = signature?.mode === 'AUTO_STAMP' && signature.signatureImageBase64
    ? `<image href="data:image/png;base64,${signature.signatureImageBase64}" x="${560 - 100}" y="${signatureBlockTop + 6}" width="200" height="70" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}" role="img" aria-label="หนังสือรับรองการหักภาษี ณ ที่จ่าย">
  <rect width="850" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="15" fill="#111">
    <text x="425" y="40" text-anchor="middle" font-size="22" font-weight="700">หนังสือรับรองการหักภาษี ณ ที่จ่าย</text>
    <text x="425" y="64" text-anchor="middle" font-size="13">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</text>
    <text x="60" y="64" font-weight="700">เลขที่ ${xml(fields.certificateNumber)}</text>

    <text x="60" y="${payerBlockTop}" font-weight="700">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงิน)</text>
    <text x="60" y="${payerBlockTop + 26}">ชื่อ: ${xml(payerSnapshot.companyName)}</text>
    <text x="60" y="${payerBlockTop + 52}">เลขประจำตัวผู้เสียภาษีอากร: ${xml(payerSnapshot.taxId ? formatThaiTaxId(payerSnapshot.taxId) : '-')} สาขา: ${xml(payerSnapshot.branchCode ?? 'สำนักงานใหญ่')}</text>
    ${payerAddressLines.map((line, index) => `<text x="60" y="${payerAddressY + index * 20}">${xml(line)}</text>`).join('')}

    <text x="60" y="${payeeBlockTop}" font-weight="700">ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้รับเงิน)</text>
    <text x="60" y="${payeeBlockTop + 26}">ชื่อ: ${xml(payeeSnapshot.name)}</text>
    <text x="60" y="${payeeBlockTop + 52}">เลขประจำตัวผู้เสียภาษีอากร/เลขประจำตัวประชาชน: ${xml(payeeSnapshot.taxId ? formatThaiTaxId(payeeSnapshot.taxId) : '-')}</text>
    ${payeeAddressLines.map((line, index) => `<text x="60" y="${payeeAddressY + index * 20}">${xml(line)}</text>`).join('')}

    <text x="60" y="${formCheckboxY}">ยื่นรายการตามแบบ:</text>
    <rect x="200" y="${formCheckboxY - 12}" width="14" height="14" fill="#fff" stroke="#111"/>
    ${!isPnd53 ? '<text x="203" y="' + formCheckboxY + '" font-weight="700">✓</text>' : ''}
    <text x="222" y="${formCheckboxY}">ภ.ง.ด.3 (บุคคลธรรมดา)</text>
    <rect x="400" y="${formCheckboxY - 12}" width="14" height="14" fill="#fff" stroke="#111"/>
    ${isPnd53 ? '<text x="403" y="' + formCheckboxY + '" font-weight="700">✓</text>' : ''}
    <text x="422" y="${formCheckboxY}">ภ.ง.ด.53 (นิติบุคคล)</text>

    <rect x="60" y="${tableTop}" width="730" height="${tableHeaderHeight}" fill="#f3f3f3" stroke="#888"/>
    <text x="70" y="${tableTop + 24}" font-weight="700">ประเภทเงินได้พึงประเมินที่จ่าย</text>
    <text x="430" y="${tableTop + 24}" font-weight="700">วันที่จ่าย</text>
    <text x="540" y="${tableTop + 24}" font-weight="700" text-anchor="end">จำนวนเงินที่จ่าย</text>
    <text x="700" y="${tableTop + 24}" font-weight="700" text-anchor="end">ภาษีที่หักและนำส่ง</text>
    <rect x="60" y="${tableTop + tableHeaderHeight}" width="730" height="46" fill="#fff" stroke="#888"/>
    <text x="70" y="${tableRowY}"${fitToWidth(`${fields.incomeCategoryName} (${fields.incomeCategoryCode}) — อัตรา ${money(fields.whtRate)}%`, 350)}>${xml(fields.incomeCategoryName)} (${xml(fields.incomeCategoryCode)}) — อัตรา ${xml(money(fields.whtRate))}%</text>
    <text x="430" y="${tableRowY}">${xml(formatCertDate(fields.paymentDate))}</text>
    <text x="540" y="${tableRowY}" text-anchor="end">${money(fields.grossAmount)}</text>
    <text x="700" y="${tableRowY}" text-anchor="end">${money(fields.withheldAmount)}</text>

    <text x="60" y="${totalTextY}">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร): ${xml(bahtText)}</text>

    <text x="60" y="${payerCheckboxY}">ผู้จ่ายเงิน</text>
    <rect x="130" y="${payerCheckboxY - 12}" width="14" height="14" fill="#fff" stroke="#111"/>
    <text x="133" y="${payerCheckboxY}" font-weight="700">✓</text>
    <text x="152" y="${payerCheckboxY}">(1) หัก ณ ที่จ่าย</text>

    <line x1="460" y1="${signatureBlockTop + 92}" x2="760" y2="${signatureBlockTop + 92}" stroke="#222"/>
    ${signatureImage}
    <text x="610" y="${signatureBlockTop + 116}" text-anchor="middle">ลงชื่อ ....................................... ผู้จ่ายเงิน</text>
    <text x="610" y="${signatureBlockTop + 142}" text-anchor="middle">วันที่ออกหนังสือรับรองฯ ${xml(formatCertDate(fields.issuedAt))}</text>
  </g>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

/** `renderSubstituteReceiptPdf` is the general-purpose SVG→raster→pdf-lib primitive the
 *  substitute-receipt feature already validated (Thai-font raster + dark-pixel-ratio guard) — no
 *  expense-specific logic is baked into it, so this calls it directly instead of forking a second
 *  raster pipeline (plan §2.5). */
export async function renderWhtCertificatePdf(svg: Buffer, certificateNumber: string): Promise<Buffer> {
  return renderSubstituteReceiptPdf(svg, certificateNumber);
}
