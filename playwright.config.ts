import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env['API_PORT'] ?? '3001';
const webPort = process.env['WEB_PORT'] ?? '3000';
const apiBaseUrl = process.env['E2E_API_BASE_URL'] ?? `http://127.0.0.1:${apiPort}/v1`;
const webBaseUrl = process.env['E2E_WEB_BASE_URL'] ?? `http://127.0.0.1:${webPort}`;
// Per-port API build output. Two runs in one checkout otherwise compile into the same
// dist while the other run's main.js is still being loaded from it, and the half-written
// files crash NestJS DI at boot. Nested under dist/ so .gitignore already covers it.
const apiDistDir = process.env['API_DIST_DIR'] ?? `dist/e2e-${apiPort}`;
// Deliberately no per-port default for the web dist dir: `next dev` rewrites the *tracked*
// apps/web/next-env.d.ts to point at whatever distDir it is given, and a deploy ships the
// dirty tree. A second concurrent run passes NEXT_DIST_DIR=.next/<name> explicitly (it
// reaches the web server through the process.env spread below). See e2e/HANDOFF.md.
const s3E2E = process.env['S3_E2E'] === '1' || process.env['S3_E2E_ACTIVE'] === '1';

const localEnv = {
  ...process.env,
  NODE_ENV: 'development',
  APP_ENV: 'local',
  SERVICE_NAME: 'api',
  SERVICE_VERSION: 'e2e',
  GIT_SHA: 'local',
  HOST: '127.0.0.1',
  PORT: apiPort,
  API_PORT: apiPort,
  WEB_PORT: webPort,
  API_DIST_DIR: apiDistDir,
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://watchdog:watchdog_local_password@localhost:5432/watchdog_bms?schema=public',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  S3_BUCKET: process.env['S3_BUCKET'] ?? 'watchdog-bms-local',
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? (s3E2E ? 'http://127.0.0.1:19000' : 'http://localhost:9000'),
  S3_REGION: process.env['S3_REGION'] ?? 'local',
  S3_FORCE_PATH_STYLE: process.env['S3_FORCE_PATH_STYLE'] ?? 'true',
  ...(s3E2E ? {
    S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'watchdog',
    S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'watchdog_local_secret',
    AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'] ?? process.env['S3_ACCESS_KEY_ID'] ?? 'watchdog',
    AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'] ?? process.env['S3_SECRET_ACCESS_KEY'] ?? 'watchdog_local_secret',
  } : {}),
  AUTH_PROVIDER: 'dev',
  DEV_AUTH_ENABLED: 'true',
  DEV_AUTH_SECRET: process.env['DEV_AUTH_SECRET'] ?? 'local-dev-secret-change-me',
  WATCHDOG_JWT_SECRET_ARN: process.env['WATCHDOG_JWT_SECRET_ARN'] ?? 'local-jwt-secret-change-me',
  WATCHDOG_JWT_ISSUER: process.env['WATCHDOG_JWT_ISSUER'] ?? `http://127.0.0.1:${apiPort}`,
  WATCHDOG_JWT_AUDIENCE: process.env['WATCHDOG_JWT_AUDIENCE'] ?? 'watchdog-bms-local',
  CREDENTIAL_ENCRYPTION_KEY: process.env['CREDENTIAL_ENCRYPTION_KEY'] ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  PDPA_PSEUDONYMIZATION_KEY: process.env['PDPA_PSEUDONYMIZATION_KEY'] ?? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS: process.env['PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS'] ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  WEB_BASE_URL: webBaseUrl,
  CORS_ALLOWED_ORIGINS: `${webBaseUrl},http://localhost:${webPort}`,
  NEXT_PUBLIC_API_URL: apiBaseUrl,
  NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
  NEXT_PUBLIC_AI_GATEWAY_BASE_URL: process.env['NEXT_PUBLIC_AI_GATEWAY_BASE_URL'] ?? 'http://127.0.0.1:3002/v1',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `corepack pnpm --filter @watchdog-bms/config build && corepack pnpm --filter @watchdog-bms/contracts build && corepack pnpm --filter @watchdog-bms/api build && node apps/api/${apiDistDir}/apps/api/src/main.js`,
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: localEnv,
    },
    {
      command: 'corepack pnpm --filter @watchdog-bms/config build && corepack pnpm --filter @watchdog-bms/contracts build && corepack pnpm --filter @watchdog-bms/web dev',
      url: webBaseUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        ...localEnv,
        SERVICE_NAME: 'web',
        PORT: webPort,
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /evidence\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /(responsive|evidence)\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    // ── evidence matrix (spec section 12.5) ────────────────────────────────
    // Rows 1-4 prove the mobile work; rows 5-7 answer "does anything fall off the edge on a
    // computer screen", which nothing in this repo asked before (responsive.spec.ts skips
    // every invariant unless isMobile). Desktop rows are measured, not enforced — decision
    // D11 records them as DESKTOP-FINDING because D2 (desktop pixel parity) outranks them.
    {
      name: 'iphone13-webkit',
      testMatch: /(responsive|evidence)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'iphone13-chromium',
      testMatch: /(responsive|evidence)\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 664 } },
    },
    {
      name: 'mobile-375',
      testMatch: /(responsive|evidence)\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 667 } },
    },
    {
      name: 'desktop-1280',
      testMatch: /evidence\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'desktop-1440',
      testMatch: /evidence\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-1920',
      testMatch: /evidence\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
