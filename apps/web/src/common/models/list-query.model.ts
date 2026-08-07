export type SortDirection = 'asc' | 'desc';

export type ListQuery = {
  search?: string;
  filters?: Record<string, string | string[]>;
  sortBy?: string;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
  cursor?: string;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
