import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  AddProductBarcodeDto, CreateLocationDto, CreateMovementDto, CreateProductDto,
  GenerateEntityQrDto, GenerateQrLabelDto, StockCountDto, TransferStockDto,
  UpdateLocationDto, UpdateProductDto,
} from './inventory.dtos';

// Payloads below are the ones apps/web/src/features/inventory really sends.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

async function rejects(metatype: any, body: Record<string, unknown>, label?: string) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    label ?? `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('CreateMovementDto', () => {
  // inventory.api.ts createMovement — movementType is in the body even though the
  // endpoint (receive/issue/adjust) already determines it.
  const valid = { productId: 'prd_1', locationId: 'loc_1', movementType: 'STOCK_IN', quantity: '5', reason: 'รับเข้า' };

  it('accepts the movementType apps/web sends to /receive and /issue', async () => {
    const out = await accepts(CreateMovementDto, valid);
    assert.equal(out.movementType, 'STOCK_IN');
    assert.equal(out.quantity, '5');
  });

  it('accepts the direction /adjust reads to choose ADJUSTMENT_IN or ADJUSTMENT_OUT', async () => {
    assert.equal((await accepts(CreateMovementDto, { ...valid, movementType: 'ADJUSTMENT_OUT' })).movementType, 'ADJUSTMENT_OUT');
    assert.equal((await accepts(CreateMovementDto, { ...valid, movementType: undefined, direction: 'OUT' })).direction, 'OUT');
  });

  it('accepts a body without a reason — only stock count requires one', async () => {
    const out = await accepts(CreateMovementDto, { productId: 'prd_1', locationId: 'loc_1', quantity: '1' });
    assert.equal(out.reason, undefined);
  });

  it('rejects unknown movement types, negative quantities, and non-string quantities', async () => {
    await rejects(CreateMovementDto, { ...valid, movementType: 'STOCK_RETURN' });
    await rejects(CreateMovementDto, { ...valid, direction: 'BOTH' });
    await rejects(CreateMovementDto, { ...valid, quantity: '-5' });
    await rejects(CreateMovementDto, { ...valid, quantity: 5 as unknown as string });
    await rejects(CreateMovementDto, { ...valid, quantity: '' });
  });

  it('rejects tenant and ledger fields the movement writer owns', async () => {
    for (const poison of [{ companyId: 'other' }, { actorUserId: 'someone' }, { movementNumber: 'MV-1' }, { balanceAfter: '999' }]) {
      await rejects(CreateMovementDto, { ...valid, ...poison });
    }
  });
});

describe('TransferStockDto and StockCountDto', () => {
  it('accepts the transfer payload apps/web sends', async () => {
    const out = await accepts(TransferStockDto, { productId: 'prd_1', fromLocationId: 'loc_1', toLocationId: 'loc_2', quantity: '2', reason: 'ย้ายคลัง' });
    assert.equal(out.toLocationId, 'loc_2');
  });

  it('requires a non-empty reason on a stock count, like the use case does', async () => {
    const out = await accepts(StockCountDto, { productId: 'prd_1', locationId: 'loc_1', countedQuantity: '0', reason: 'นับสต๊อกประจำเดือน' });
    assert.equal(out.countedQuantity, '0', 'a counted quantity of zero is a real count result');
    await rejects(StockCountDto, { productId: 'prd_1', locationId: 'loc_1', countedQuantity: '3' });
    await rejects(StockCountDto, { productId: 'prd_1', locationId: 'loc_1', countedQuantity: '3', reason: '' });
  });
});

describe('product DTOs', () => {
  // InventoryPages.tsx create form
  const validCreate = { sku: 'SKU-1', name: 'สินค้าทดสอบ', unit: 'ชิ้น', kind: 'STOCKABLE', customerVisible: false };

  it('accepts the create form payload', async () => {
    const out = await accepts(CreateProductDto, { ...validCreate, description: 'รายละเอียด', category: 'ทั่วไป', reorderPoint: '10', salePrice: '250.00' });
    assert.equal(out.sku, 'SKU-1');
    assert.equal(out.salePrice, '250.00');
  });

  it('accepts the explicit nulls the edit form sends to clear columns', async () => {
    const out = await accepts(UpdateProductDto, {
      name: 'ชื่อใหม่', unit: 'ชิ้น', description: null, category: undefined,
      salePrice: null, bookingDurationMinutes: null, customerVisible: true,
    });
    assert.equal(out.description, null);
    assert.equal(out.salePrice, null);
    assert.equal(out.bookingDurationMinutes, null);
  });

  it('accepts a service product with a booking duration', async () => {
    const out = await accepts(CreateProductDto, { ...validCreate, kind: 'SERVICE', bookingDurationMinutes: 90 });
    assert.equal(out.bookingDurationMinutes, 90);
  });

  it('rejects unknown kinds, malformed prices, and non-integer durations', async () => {
    await rejects(CreateProductDto, { ...validCreate, kind: 'BUNDLE' });
    await rejects(CreateProductDto, { ...validCreate, salePrice: '฿250' });
    await rejects(CreateProductDto, { ...validCreate, bookingDurationMinutes: 90.5 });
    await rejects(UpdateProductDto, { name: '' });
  });

  it('rejects status, sku, and tenant fields on update', async () => {
    for (const poison of [{ companyId: 'other' }, { status: 'ARCHIVED' }, { sku: 'SKU-HIJACK' }, { kind: 'SERVICE' }, { id: 'prd_2' }]) {
      await rejects(UpdateProductDto, { name: 'x', ...poison });
    }
  });

  it('keeps barcodes to the known symbologies', async () => {
    assert.equal((await accepts(AddProductBarcodeDto, { type: 'EAN13', value: '8850001000019' })).type, 'EAN13');
    await rejects(AddProductBarcodeDto, { type: 'QR', value: 'x' });
    await rejects(AddProductBarcodeDto, { type: 'EAN13', value: '' });
    await rejects(AddProductBarcodeDto, { type: 'EAN13', value: 'x', productId: 'prd_other' });
  });
});

describe('location and QR DTOs', () => {
  it('accepts the create-location form payload', async () => {
    const out = await accepts(CreateLocationDto, { code: 'WH-01', name: 'คลังหลัก', type: 'WAREHOUSE' });
    assert.equal(out.type, 'WAREHOUSE');
  });

  it('rejects unknown location types and code changes on update', async () => {
    await rejects(CreateLocationDto, { code: 'WH-01', name: 'คลังหลัก', type: 'SHELF' });
    await rejects(UpdateLocationDto, { name: 'x', code: 'WH-02' });
    await rejects(UpdateLocationDto, { name: 'x', status: 'ARCHIVED' });
  });

  it('accepts the empty body apps/web sends for entity QR generation', async () => {
    const out = await accepts(GenerateEntityQrDto, {});
    assert.equal(out.labelText, undefined);
    await rejects(GenerateEntityQrDto, { entityId: 'prd_other' });
  });

  it('requires an entity on the generic label endpoint', async () => {
    assert.equal((await accepts(GenerateQrLabelDto, { entityType: 'LOCATION', entityId: 'loc_1' })).entityType, 'LOCATION');
    await rejects(GenerateQrLabelDto, { entityType: 'BRANCH', entityId: 'br_1' });
    await rejects(GenerateQrLabelDto, { entityType: 'PRODUCT' });
  });
});
