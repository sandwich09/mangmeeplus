/** The short description used by the expense source picker. Lines arrive in document order. */
export function expenseSourceDescription(lines: readonly { description: string }[]): string {
  return lines.map(line => line.description).join('; ').slice(0, 500);
}
