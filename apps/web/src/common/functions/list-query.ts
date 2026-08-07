import type { ListQuery } from '../models/list-query.model';

export function serializeListQuery(query: ListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortDir) params.set('sortDir', query.sortDir);
  if (query.page != null) params.set('page', String(query.page));
  if (query.pageSize != null) params.set('pageSize', String(query.pageSize));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.filters) {
    for (const [key, value] of Object.entries(query.filters)) {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(`filter_${key}`, v));
      } else {
        params.set(`filter_${key}`, value);
      }
    }
  }
  return params;
}

export function deserializeListQuery(params: URLSearchParams): ListQuery {
  const query: ListQuery = {};
  const search = params.get('search');
  if (search) query.search = search;
  const sortBy = params.get('sortBy');
  if (sortBy) query.sortBy = sortBy;
  const sortDir = params.get('sortDir');
  if (sortDir === 'asc' || sortDir === 'desc') query.sortDir = sortDir;
  const page = params.get('page');
  if (page) query.page = parseInt(page, 10);
  const pageSize = params.get('pageSize');
  if (pageSize) query.pageSize = parseInt(pageSize, 10);
  const cursor = params.get('cursor');
  if (cursor) query.cursor = cursor;
  const filters: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith('filter_')) {
      const filterKey = key.slice(7);
      const existing = filters[filterKey];
      if (existing === undefined) {
        filters[filterKey] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        filters[filterKey] = [existing, value];
      }
    }
  }
  if (Object.keys(filters).length > 0) query.filters = filters;
  return query;
}
