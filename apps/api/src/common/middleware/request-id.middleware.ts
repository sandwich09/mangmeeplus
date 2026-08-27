import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Keep caller-supplied idempotency keys safely below PostgreSQL's btree entry limit. Oversized
// values stay deterministic so a lost-response retry cannot turn into a second OCR admission.
export const MAX_INBOUND_REQUEST_ID_BYTES = 256;

export function normalizeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.trim()) return randomUUID();
  if (Buffer.byteLength(candidate, 'utf8') <= MAX_INBOUND_REQUEST_ID_BYTES) return candidate;
  return `sha256:${createHash('sha256').update(candidate).digest('hex')}`;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
