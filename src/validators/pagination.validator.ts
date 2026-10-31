import { HttpError } from '../middlewares/error.middleware';
import type { PaginationInput } from '../types/pagination.types';

export function validatePagination(query: Record<string, unknown>): PaginationInput {
  function integer(value: unknown, fallback: number, min: number, max: number, name: string) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw new HttpError(400, `${name} phải là số nguyên.`, 'invalid_pagination');
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new HttpError(400, `${name} phải từ ${min} đến ${max}.`, 'invalid_pagination');
    }
    return number;
  }
  return {
    limit: integer(query.limit, 50, 1, 100, 'limit'),
    offset: integer(query.offset, 0, 0, 1000000, 'offset'),
  };
}
