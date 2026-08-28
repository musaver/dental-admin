/**
 * Pagination for list endpoints.
 *
 * These endpoints return an ENVELOPE rather than the bare array the rest of
 * the codebase uses. That is a deliberate divergence: a bare array leaves
 * nowhere to report the total, so the UI cannot render "page 2 of 9" and the
 * endpoint can never grow pagination without breaking its callers.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Read page/pageSize from a URL, clamped so a hostile value cannot scan the table. */
export function parsePageParams(url: URL | string): PageParams {
  const params = typeof url === 'string' ? new URL(url).searchParams : url.searchParams;

  const rawPage = Number(params.get('page'));
  const rawSize = Number(params.get('pageSize'));

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginate<T>(rows: T[], total: number, params: PageParams): Paginated<T> {
  return {
    rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/** Trimmed free-text search term, or null. Callers should also cap the length. */
export function parseSearch(url: URL, key = 'q'): string | null {
  const raw = url.searchParams.get(key)?.trim();
  return raw ? raw.slice(0, 100) : null;
}
