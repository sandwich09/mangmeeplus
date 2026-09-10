/** Remove former system display metadata from derived copies only. This is not an SVG sanitizer:
 * the caller must retain its MIME/access checks and render SVG in image mode. */
export function removeSubstituteReceiptDisplayMetadata(svg: string): string {
  return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/gu, (element, attributes: string, text: string) => {
    if (!/\bx="425"(?:\s|$)/u.test(attributes) || !/\btext-anchor="middle"(?:\s|$)/u.test(attributes)) return element;
    const formerHeader = /^เลขที่ [^<\r\n]+ · version \d+$/u.test(text);
    const formerFooter = text === 'เอกสารนี้เป็นหลักฐานประกอบรายจ่ายภายใน มิใช่ใบกำกับภาษี และไม่ก่อสิทธิภาษีซื้อโดยลำพัง'
      || text === 'เอกสารนี้ยังไม่สมบูรณ์จนกว่าจะมีลายเซ็นผู้จ่ายและผู้อนุมัติ';
    return formerHeader || formerFooter ? '' : element;
  });
}
