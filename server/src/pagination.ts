import type { Request } from 'express';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 100_000;

function toInt(value: unknown, fallback: number, max: number) {
  const n = Number.parseInt(String(value), 10);
  return n >= 1 ? Math.min(n, max) : fallback;
}

// Reads ?page= (from 1) and ?limit= from the query. Missing or bad values fall back to defaults instead of failing.
export function readPage(query: Request['query']) {
  const page = toInt(query.page, 1, MAX_PAGE);
  const limit = toInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

export type PageQuery = ReturnType<typeof readPage>;
