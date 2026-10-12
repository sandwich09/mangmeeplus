import { test } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { expectMainReady } from './harness/e2e-utils';

const BASELINES = [
  ['dashboard', '/dashboard'],
  ['expenses', '/expenses'],
  ['wht-certificates', '/expenses/wht-certificates'],
  ['reimbursements', '/reimbursements'],
  ['accounting', '/accounting'],
  ['journal', '/journal'],
  ['settings', '/settings'],
] as const;

test.describe('Desktop responsive baseline capture', () => {
  test.skip(process.env['RESPONSIVE_BASELINE'] !== '1', 'Set RESPONSIVE_BASELINE=1 to capture baselines.');

  test('captures the desktop parity pages', async ({ authedPage, companyId }) => {
    for (const [name, route] of BASELINES) {
      await authedPage.goto(`/companies/${companyId}${route}`);
      await expectMainReady(authedPage);
      await authedPage.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await expectNoClientError(authedPage);
      await authedPage.screenshot({
        path: `${process.env['RESPONSIVE_BASELINE_DIR'] ?? 'outputs/responsive-baseline'}/${name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  });
});
