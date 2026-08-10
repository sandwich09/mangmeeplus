import type { NextFunction, Request, Response } from 'express';

export type ProductionServingMode = 'live' | 'maintenance_only';

export function parseProductionServingMode(value: string | undefined, isProduction: boolean): ProductionServingMode {
  if (value === 'live' || value === 'maintenance_only') return value;
  if (!isProduction && (value === undefined || value === '')) return 'live';
  throw new Error('PRODUCTION_SERVING_MODE must be exactly maintenance_only or live');
}

export function productionMaintenanceMiddleware(mode: ProductionServingMode) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    if (mode === 'live' || ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/v1/health')) {
      next();
      return;
    }

    const body = JSON.stringify({
      statusCode: 200,
      code: 'global_maintenance',
      message: 'Service temporarily unavailable.',
    });
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Mangmee-Maintenance', 'active');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    req.resume();
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
