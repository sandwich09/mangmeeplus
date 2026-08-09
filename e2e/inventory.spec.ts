import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Page<T> = { items: T[]; data?: T[] };
type Product = { id: string; sku: string; name: string };
type Location = { id: string; code: string; name: string };

async function firstProduct(api: any, companyId: string): Promise<Product> {
  const body = await json<Page<Product>>(await api.get(`companies/${companyId}/inventory/products?pageSize=20`));
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!;
}

async function firstLocation(api: any, companyId: string): Promise<Location> {
  const body = await json<Page<Location>>(await api.get(`companies/${companyId}/inventory/locations?pageSize=20`));
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!;
}

test.describe('INV — inventory', () => {
  test('INV-01 @smoke inventory opens product list', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory');
    // Scoped to <main>: the sidebar's "สินค้าและบริการ / Products & Services" settings
    // link also matches this regex and sits outside main, causing a strict-mode violation.
    await authedPage.locator('main').getByRole('link', { name: /สินค้า|Products/i }).click();
    await expect(authedPage.getByRole('heading', { name: /สินค้า|Products/i })).toBeVisible();
    await expect(authedPage.locator('table')).toBeVisible();
    await expectNoClientError(authedPage);
  });

  test('INV-02 @p1 products table shows seeded rows and columns', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/products');
    await expect(authedPage.getByRole('columnheader', { name: /SKU/i })).toBeVisible();
    await expect(authedPage.getByRole('columnheader', { name: /ชื่อสินค้า|Name/i })).toBeVisible();
    await expect(authedPage.locator('tbody tr').first()).toBeVisible();
  });

  test('INV-03 INV-03b @smoke creates product and verifies API truth', async ({ authedPage, api, companyId }) => {
    const sku = unique('E2E-SKU');
    const expectedSku = sku.toUpperCase();
    const productName = `E2E Product ${sku}`;
    await gotoCompany(authedPage, companyId, '/inventory/products/new');
    await authedPage.locator('input[name="sku"]').fill(sku);
    await authedPage.locator('input[name="name"]').fill(productName);
    await authedPage.locator('input[name="unit"]').fill('pcs');
    await authedPage.getByRole('button', { name: /บันทึก|Save/i }).click();
    await expect(authedPage).toHaveURL(/\/inventory\/products\/[^/]+$/);
    await expect(authedPage.getByRole('heading', { name: productName, exact: true })).toBeVisible();
    await expect(authedPage.getByText(expectedSku, { exact: true })).toBeVisible();

    const body = await json<Page<Product>>(await api.get(`companies/${companyId}/inventory/products?search=${encodeURIComponent(sku)}`));
    expect(body.items.some((product) => product.sku === expectedSku)).toBe(true);
  });

  test('INV-04 @p1 product detail shows balances and movement history', async ({ authedPage, api, companyId }) => {
    const product = await firstProduct(api, companyId);
    await gotoCompany(authedPage, companyId, `/inventory/products/${product.id}`);
    await expect(authedPage.getByRole('heading', { name: product.name })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: /ยอดตามสถานที่|Balances/i })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: /ความเคลื่อนไหวล่าสุด|Movements/i })).toBeVisible();
  });

  test('INV-05 @p1 movements list renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/movements');
    await expect(authedPage.getByRole('heading', { name: /ความเคลื่อนไหวสต็อก|Stock Movements/i })).toBeVisible();
    await expect(authedPage.locator('table')).toBeVisible();
  });

  test('INV-06 @p1 creates stock-in movement and API balance reflects it', async ({ authedPage, api, companyId }) => {
    const product = await firstProduct(api, companyId);
    const location = await firstLocation(api, companyId);
    const before = await json<Array<{ quantity: string }>>(await api.get(`companies/${companyId}/inventory/balances?productId=${product.id}&locationId=${location.id}`));
    const beforeQty = Number(before[0]?.quantity ?? 0);

    await gotoCompany(authedPage, companyId, '/inventory/movements/new');
    await authedPage.locator('input[name="productId"]').fill(product.id);
    await authedPage.locator('input[name="locationId"]').fill(location.id);
    await authedPage.locator('input[name="quantity"]').fill('5');
    await authedPage.getByRole('button', { name: /บันทึก|Save/i }).click();
    // Success now surfaces as the global toast "บันทึกรับเข้าเรียบร้อยแล้ว" (top-center), not inline copy.
    await expect(authedPage.getByText(/เรียบร้อยแล้ว|Saved/i)).toBeVisible();

    const after = await json<Array<{ quantity: string }>>(await api.get(`companies/${companyId}/inventory/balances?productId=${product.id}&locationId=${location.id}`));
    expect(Number(after[0]?.quantity ?? 0)).toBeGreaterThanOrEqual(beforeQty + 5);
  });

  test('INV-07 @p1 stock-count workspace renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/stock-count');
    await expect(authedPage.getByRole('heading', { name: /บันทึกสต็อก|Stock Action/i })).toBeVisible();
    // The action picker is now a ThemedSelect (details/summary combobox), not a native
    // <select>, so it has to be asserted via its displayed label instead of .value.
    // Labels are Thai-only since the movement-type copy sweep.
    await expect(authedPage.getByRole('combobox')).toHaveText('ตรวจนับ');
  });

  test('INV-08 @p1 locations list renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/locations');
    await expect(authedPage.getByRole('heading', { name: /สถานที่จัดเก็บ|Inventory Locations/i })).toBeVisible();
    await expect(authedPage.locator('table')).toBeVisible();
  });

  test('INV-09 @p1 stock report renders rows', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/reports/stock');
    await expect(authedPage.getByRole('heading', { name: /รายงานสต็อก|Stock Report/i })).toBeVisible();
    await expect(authedPage.locator('table')).toBeVisible();
  });

  test('INV-10 @p2 scan page has permission-less input fallback', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/scan');
    await expect(authedPage.getByRole('heading', { name: /สแกน QR|Scan QR/i })).toBeVisible();
    await expect(authedPage.getByPlaceholder(/WD1:P|WD1:LOC/i)).toBeVisible();
  });

  test('INV-11 @p2 product form required fields block empty submit', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/inventory/products/new');
    await authedPage.getByRole('button', { name: /บันทึก|Save/i }).click();
    await expect(authedPage).toHaveURL(/\/inventory\/products\/new$/);
  });
});
