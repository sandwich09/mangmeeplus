export const DEFAULT_PAGE_SIZE = 10;

/** Clamped slice bounds for a client-side paged list. `page` is 1-based. */
export function pageBounds(total: number, page: number, pageSize: number = DEFAULT_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { totalPages, page: current, start, end, from: total === 0 ? 0 : start + 1, to: end };
}
