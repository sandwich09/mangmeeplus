import type { NextFunction, Request, Response } from 'express';

export const PRIVATE_NO_STORE = 'private, no-store, max-age=0';

/**
 * ERP API responses are user-, company-, and permission-contextual by default. Routes that are
 * deliberately public/cacheable may replace this header explicitly in their controller.
 */
export function apiCacheControl(_req: Request, res: Response, next: NextFunction): void {
  if (!res.hasHeader('Cache-Control')) {
    res.setHeader('Cache-Control', PRIVATE_NO_STORE);
  }
  next();
}
