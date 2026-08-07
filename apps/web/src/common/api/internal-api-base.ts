// Server-side ERP API base for BFF route handlers and server components.
// Mirrors the resolution order used by next.config.mjs for the /api/* rewrite.
const RAW_BASE =
  process.env['INTERNAL_API_URL'] ??
  process.env['NEXT_PUBLIC_API_BASE_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001/v1';

const API_ORIGIN = RAW_BASE.replace(/\/+$/, '').replace(/\/v1$/, '');

export function internalApiV1Base(): string {
  return `${API_ORIGIN}/v1`;
}
