import { test, expect } from './harness/fixtures';
import { firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';

type Supplier = { id: string; displayNameSnapshot: string };
type PurchaseOrderLine = { id: string; lineNumber: number; receivedQuantity: string };
type PurchaseOrder = { id: string; status: string; purchaseOrderNumber?: string | null; grandTotalAmount: string; lines: PurchaseOrderLine[] };
type PurchaseOrderPage = { data: PurchaseOrder[] };
type GoodsReceiptLine = { id: string; lineNumber: number; inventoryMovementId?: string | null };
type GoodsReceipt = { id: string; status: string; goodsReceiptNumber?: string | null; lines: GoodsReceiptLine[] };
type Movement = { id: string; movementNumber?: string | null; referenceId?: string | null; quantity: string };
type Page<T> = { items: T[] };

async function createSupplier(api: any, companyId: string) {
  return json<Supplier>(await api.post(`companies/${companyId}/procurement/suppliers`, {
    data: { displayName: unique('E2E PO supplier'), supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' },
  }));
}

function serviceLine() {
  return {
    lineNumber: 1,
    lineType: 'SERVICE',
    description: unique('E2E PO line'),
    unitName: 'each',
    orderedQuantity: '1',
    unitPrice: '100.00',
    discountAmount: '0.00',
    vatMode: 'NO_VAT',
    vatAmount: '0.00',
    lineSubtotalAmount: '100.00',
    lineTotalAmount: '100.00',
  };
}

async function createPurchaseOrder(api: any, companyId: string, lines: unknown[] = [serviceLine()]) {
  const supplier = await createSupplier(api, companyId);
  const today = new Date().toISOString();
  const total = (100 * lines.length).toFixed(2);
  const po = await json<PurchaseOrder>(await api.post(`companies/${companyId}/procurement/purchase-orders`, {
    data: {
      supplierId: supplier.id,
      branchId: (await firstActiveBranch(api, companyId)).id,
      orderDate: today,
      currency: 'THB',
      matchingMode: 'NONE',
      subtotalAmount: total,
      discountAmount: '0.00',
      taxableAmount: total,
      vatAmount: '0.00',
      grandTotalAmount: total,
      outstandingAmount: total,
      lines,
    },
  }));
  return { supplier, po };
}

test.describe('PROC — procurement', () => {
  test('PROC-01 @smoke procurement workspace renders', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/procurement');
    await expect(authedPage.getByRole('heading', { name: /จัดซื้อ|Procurement/i })).toBeVisible();
    for (const tab of [/ผู้จำหน่าย|Supplier/i, /ใบขอซื้อ|PR/i, /ใบสั่งซื้อ|PO/i, /ใบรับสินค้า|GR/i]) {
      await expect(authedPage.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('PROC-02 @p1 creates and issues a purchase order with a number', async ({ authedPage, api, companyId }) => {
    const { supplier, po } = await createPurchaseOrder(api, companyId);
    const approved = await json<PurchaseOrder>(await api.post(`companies/${companyId}/procurement/purchase-orders/${po.id}/approve`, { data: {} }));
    expect(approved.status).toBe('APPROVED');
    const issued = await json<PurchaseOrder>(await api.post(`companies/${companyId}/procurement/purchase-orders/${po.id}/issue`, { data: {} }));
    expect(issued.status).toBe('ISSUED');
    expect(issued.purchaseOrderNumber).toBeTruthy();

    await gotoCompany(authedPage, companyId, '/procurement');
    await authedPage.getByRole('button', { name: /ใบสั่งซื้อ|PO/i }).click();
    await expect(authedPage.getByRole('heading', { name: /จัดซื้อ|Procurement/i })).toBeVisible();
    expect(supplier.displayNameSnapshot).toBeTruthy();
  });

  test('PROC-03 @p1 approval transition is visible through API list', async ({ api, companyId }) => {
    const { po } = await createPurchaseOrder(api, companyId);
    const approved = await json<PurchaseOrder>(await api.post(`companies/${companyId}/procurement/purchase-orders/${po.id}/approve`, { data: { note: 'E2E approval' } }));
    expect(approved.status).toBe('APPROVED');

    const list = await json<PurchaseOrderPage>(await api.get(`companies/${companyId}/procurement/purchase-orders?pageSize=100`));
    expect(list.data.some((item) => item.id === po.id && item.status === 'APPROVED')).toBe(true);
  });

  // Two STOCK lines for the SAME product and location: both used to reserve the
  // movement number under one product+location idempotency key, so the second
  // insert collided on StockMovement @@unique([companyId, movementNumber]) and
  // the whole post failed. Posting is also one transaction now — the movements
  // and the purchase-order roll-forward commit together.
  test('PROC-04 @p1 posts a goods receipt whose stock lines share a product and location', async ({ api, companyId }) => {
    const products = await json<Page<{ id: string }>>(await api.get(`companies/${companyId}/inventory/products?pageSize=20`));
    const locations = await json<Page<{ id: string }>>(await api.get(`companies/${companyId}/inventory/locations?pageSize=20`));
    expect(products.items.length).toBeGreaterThan(0);
    expect(locations.items.length).toBeGreaterThan(0);
    const productId = products.items[0]!.id;
    const locationId = locations.items[0]!.id;

    const stockLine = (lineNumber: number) => ({
      lineNumber, lineType: 'STOCK', productId, inventoryLocationId: locationId,
      description: unique(`E2E GR stock line ${lineNumber}`), unitName: 'each',
      orderedQuantity: '10', unitPrice: '10.00', discountAmount: '0.00',
      vatMode: 'NO_VAT', vatAmount: '0.00', lineSubtotalAmount: '100.00', lineTotalAmount: '100.00',
    });
    const { supplier, po } = await createPurchaseOrder(api, companyId, [stockLine(1), stockLine(2)]);
    await api.post(`companies/${companyId}/procurement/purchase-orders/${po.id}/approve`, { data: {} });
    const issued = await json<PurchaseOrder>(await api.post(`companies/${companyId}/procurement/purchase-orders/${po.id}/issue`, { data: {} }));
    const poLines = [...issued.lines].sort((a, b) => a.lineNumber - b.lineNumber);

    const balanceBefore = await json<Array<{ quantity: string }>>(await api.get(`companies/${companyId}/inventory/balances?productId=${productId}&locationId=${locationId}`));
    const onHandBefore = Number(balanceBefore[0]?.quantity ?? 0);

    const receiptLine = (lineNumber: number, purchaseOrderLineId: string, qty: string) => ({
      purchaseOrderLineId, lineNumber, lineType: 'STOCK', productId, inventoryLocationId: locationId,
      description: unique(`E2E GR receipt line ${lineNumber}`), unitName: 'each',
      orderedQuantity: '10', previouslyReceivedQuantity: '0', receivedQuantity: qty, acceptedQuantity: qty, rejectedQuantity: '0',
    });
    const gr = await json<GoodsReceipt>(await api.post(`companies/${companyId}/procurement/goods-receipts`, {
      data: {
        purchaseOrderId: po.id, supplierId: supplier.id, receivedAt: new Date().toISOString(),
        lines: [receiptLine(1, poLines[0]!.id, '4'), receiptLine(2, poLines[1]!.id, '6')],
      },
    }));

    const posted = await json<GoodsReceipt>(await api.post(`companies/${companyId}/procurement/goods-receipts/${gr.id}/post`, { data: {} }));
    expect(posted.status).toBe('POSTED');
    expect(posted.goodsReceiptNumber).toBeTruthy();

    const detail = await json<GoodsReceipt>(await api.get(`companies/${companyId}/procurement/goods-receipts/${gr.id}`));
    const movementIds = detail.lines.map((line) => line.inventoryMovementId).filter(Boolean);
    expect(movementIds).toHaveLength(2);
    expect(new Set(movementIds).size).toBe(2);

    const movements = await json<Page<Movement>>(await api.get(`companies/${companyId}/inventory/movements?productId=${productId}&locationId=${locationId}&pageSize=100`));
    const mine = movements.items.filter((movement) => movement.referenceId === gr.id);
    expect(mine).toHaveLength(2);
    // The regression guard: one reservation for both lines gave them one number.
    const numbers = mine.map((movement) => movement.movementNumber);
    expect(numbers.every(Boolean)).toBe(true);
    expect(new Set(numbers).size).toBe(2);
    expect(mine.map((movement) => Number(movement.quantity)).sort((a, b) => a - b)).toEqual([4, 6]);

    const balanceAfter = await json<Array<{ quantity: string }>>(await api.get(`companies/${companyId}/inventory/balances?productId=${productId}&locationId=${locationId}`));
    expect(Number(balanceAfter[0]?.quantity ?? 0) - onHandBefore).toBe(10);

    const reloaded = await json<PurchaseOrder>(await api.get(`companies/${companyId}/procurement/purchase-orders/${po.id}`));
    const received = [...reloaded.lines].sort((a, b) => a.lineNumber - b.lineNumber).map((line) => Number(line.receivedQuantity));
    expect(received).toEqual([4, 6]);
  });
});
