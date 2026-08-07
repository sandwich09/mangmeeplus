export const BASE_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
} as const;

export function buildS3UploadOrigin(bucket: string | undefined, region: string | undefined): string | undefined {
  const safeBucket = bucket?.trim();
  const safeRegion = region?.trim();
  const bucketIsValid = Boolean(
    safeBucket
    && safeBucket.length >= 3
    && safeBucket.length <= 63
    && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(safeBucket)
    && !safeBucket.includes('..')
    && !safeBucket.includes('.-')
    && !safeBucket.includes('-.'),
  );
  if (!bucketIsValid || !safeRegion || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(safeRegion)) return undefined;
  return `https://${safeBucket}.s3.${safeRegion}.amazonaws.com`;
}

export function buildS3EndpointOrigin(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    return /^https?:$/.test(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  connectUrls: Array<string | undefined>,
  dev = false,
): string {
  const connectOrigins = [...new Set(connectUrls.flatMap((value) => {
    if (!value) return [];
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? [url.origin] : [];
    } catch {
      return [];
    }
  }))];
  // Development only: React tooling needs eval, and local presigned MinIO URLs use plain HTTP;
  // production stays strict and upgrades insecure requests.
  return [
    "default-src 'self'",
    dev
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    // Attachment previews are <img src> on the same signed storage origin the uploads use,
    // so it has to be allowed here too — plain-http local MinIO is not covered by `https:`.
    dev
      ? "img-src 'self' data: blob: https: http:"
      : `img-src 'self' data: blob: https: ${connectOrigins.join(' ')}`.trim(),
    "font-src 'self' data:",
    dev
      ? `connect-src 'self' http: https: ${connectOrigins.join(' ')}`.trim()
      : `connect-src 'self' ${connectOrigins.join(' ')}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
