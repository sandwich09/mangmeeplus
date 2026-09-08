/** Conservative internal Flex preview limit, measured like the outcome reader: UTF-16 units. */
export const LINE_FLEX_PREVIEW_LIMIT = 400;

export function lineMessagePreview(value: string, max = LINE_FLEX_PREVIEW_LIMIT): string {
  const text = value.trim();
  if (text.length <= max) return text;
  // Leave space for the ellipsis and never leave half of an astral character at the boundary.
  return `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`;
}
