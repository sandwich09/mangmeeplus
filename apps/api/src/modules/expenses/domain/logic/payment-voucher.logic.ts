import { formatThaiTaxId, money, thaiBahtText, wrapText, xml } from './substitute-receipt.logic';

export const PAYMENT_VOUCHER_TITLE = 'ใบสำคัญรับเงิน';

const FULL_THAI_DATE = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export type PaymentVoucherInput = {
  companyName: string;
  paymentDate: string | null;
  payeeName: string | null;
  payeeAddress: string | null;
  payeeTaxId: string | null;
  expenseDescription: string;
  amount: string;
};

type RuledField = { markup: string; nextY: number };

export function renderPaymentVoucherSvg(input: PaymentVoucherInput): Buffer {
  const fields: string[] = [];
  let y = 172;

  const appendField = (
    name: string,
    label: string,
    value: string | null,
    lineStart: number,
    lineEnd = 792,
  ) => {
    const field = ruledField(name, label, value, y, lineStart, lineEnd);
    fields.push(field.markup);
    y = field.nextY;
  };

  appendField('payee-name', 'ข้าพเจ้า', input.payeeName, 135);
  appendField('payee-address', 'ที่อยู่', input.payeeAddress, 112);
  appendField(
    'payee-tax-id',
    'เลขประจำตัวประชาชน/เลขประจำตัวผู้เสียภาษี',
    input.payeeTaxId ? formatThaiTaxId(input.payeeTaxId) : null,
    455,
  );
  appendField('company-name', 'ได้รับเงินจาก', input.companyName, 180);
  appendField('expense-description', 'เป็นค่า', input.expenseDescription, 112);
  appendField('amount', 'เป็นจำนวนเงิน', `${money(input.amount)} บาท (${thaiBahtText(input.amount)})`, 185);

  const acknowledgementY = y + 16;
  const signaturesStart = acknowledgementY + 95;
  const height = Math.max(1040, signaturesStart + 300);
  const paymentDate = formatFullThaiDate(input.paymentDate);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="850" height="${height}" viewBox="0 0 850 ${height}" role="img" aria-label="${PAYMENT_VOUCHER_TITLE}">
  <rect width="850" height="${height}" fill="#fff"/>
  <g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="18" fill="#111">
    <text x="425" y="70" text-anchor="middle" font-size="30" font-weight="700">${PAYMENT_VOUCHER_TITLE}</text>
    <g data-field="payment-date">
      <text x="535" y="122">วันที่</text>
      ${paymentDate ? `<text x="602" y="118">${xml(paymentDate)}</text>` : ''}
      <line x1="595" y1="123" x2="792" y2="123" stroke="#222" stroke-width="1"/>
    </g>
    ${fields.join('\n    ')}
    <text x="58" y="${acknowledgementY}">ไว้เป็นการถูกต้องแล้ว</text>
    ${signatureBlock(signaturesStart, 'ผู้รับเงิน')}
    ${signatureBlock(signaturesStart + 145, 'ผู้จ่ายเงิน')}
  </g>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

function ruledField(
  name: string,
  label: string,
  value: string | null,
  y: number,
  lineStart: number,
  lineEnd: number,
): RuledField {
  const text = value?.trim() ?? '';
  const lines = text ? wrapText(text, lineEnd - lineStart - 10) : [''];
  const lineHeight = 39;
  const markup = `<g data-field="${name}">
      <text x="58" y="${y - 5}">${xml(label)}</text>
      ${lines.map((line, index) => {
    const baseline = y + (index * lineHeight);
    return `${line ? `<text x="${lineStart + 5}" y="${baseline - 5}">${xml(line)}</text>` : ''}
      <line x1="${index === 0 ? lineStart : 58}" y1="${baseline}" x2="${lineEnd}" y2="${baseline}" stroke="#222" stroke-width="1"/>`;
  }).join('\n      ')}
    </g>`;
  return { markup, nextY: y + (lines.length * lineHeight) + 12 };
}

function signatureBlock(y: number, role: string): string {
  return `<g>
      <text x="360" y="${y}">ลงชื่อ</text>
      <line x1="430" y1="${y + 5}" x2="680" y2="${y + 5}" stroke="#222" stroke-width="1"/>
      <text x="700" y="${y}">${role}</text>
      <text x="555" y="${y + 42}" text-anchor="middle">(.....................................)</text>
    </g>`;
}

function formatFullThaiDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? value : FULL_THAI_DATE.format(date);
}
