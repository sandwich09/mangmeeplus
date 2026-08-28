/** The API accepts exactly five ASCII digits; an empty optional field is omitted/cleared. */
export function taxBranchCodeError(value: string | null | undefined): string | null {
  const code = value?.trim();
  return !code || /^[0-9]{5}$/.test(code) ? null : 'รหัสสาขาภาษีต้องเป็นตัวเลข 5 หลัก หรือเว้นว่างหากไม่มี';
}
