import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastContext, type ToastContextValue } from '@/common/components/toast/use-toast';
import type { ProductDetail } from './inventory.model';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const previousSvgLoader = require.extensions['.svg'];
require.extensions['.svg'] = (module) => {
  module.exports = () => null;
};
const { ProductDetailPageClient, ProductsPageClient } = require('./InventoryPages') as typeof import('./InventoryPages');
if (previousSvgLoader) require.extensions['.svg'] = previousSvgLoader;
else delete require.extensions['.svg'];

const reactRuntime = require('react') as typeof React;
const toast: ToastContextValue = {
  success: () => undefined,
  warning: () => undefined,
  error: () => undefined,
};
const product: ProductDetail = {
  id: 'product-1',
  companyId: 'company-1',
  sku: 'SKU-001',
  name: 'Fixture Product',
  unit: 'ชิ้น',
  kind: 'STOCKABLE',
  customerVisible: false,
  status: 'ACTIVE',
  createdByUserId: 'user-1',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  barcodes: [],
};

function renderLoadedProductDetail(props: { canManage?: boolean; canManageLabels?: boolean } = {}): string {
  const realUseState = reactRuntime.useState;
  let productInjected = false;
  Reflect.set(reactRuntime, 'useState', (initialState: unknown) => {
    const state = (realUseState as (initialState: unknown) => [unknown, (value: unknown) => void])(initialState);
    if (initialState === null && !productInjected) {
      productInjected = true;
      return [product, state[1]];
    }
    if (initialState === true) return [false, state[1]];
    return state;
  });

  try {
    return renderToStaticMarkup(
      React.createElement(
        ToastContext.Provider,
        { value: toast },
        React.createElement(ProductDetailPageClient, {
          companyId: 'company-1',
          productId: product.id,
          ...props,
        }),
      ),
    );
  } finally {
    Reflect.set(reactRuntime, 'useState', realUseState);
  }
}

describe('inventory product permission defaults', () => {
  it('omits the create action when ProductsPageClient canManage is omitted', () => {
    const readOnly = renderToStaticMarkup(React.createElement(ProductsPageClient, { companyId: 'company-1' }));
    const manager = renderToStaticMarkup(React.createElement(ProductsPageClient, {
      companyId: 'company-1',
      canManage: true,
    }));

    assert.match(readOnly, /ค้นหา SKU/);
    assert.doesNotMatch(readOnly, /href="\/companies\/company-1\/inventory\/products\/new"/);
    assert.match(manager, /href="\/companies\/company-1\/inventory\/products\/new"/);
  });

  it('omits edit and label controls when ProductDetailPageClient flags are omitted', () => {
    const readOnly = renderLoadedProductDetail();
    const manager = renderLoadedProductDetail({ canManage: true, canManageLabels: true });

    assert.match(readOnly, /Fixture Product/);
    assert.match(readOnly, /<dl/);
    assert.doesNotMatch(readOnly, /name="name"/);
    assert.doesNotMatch(readOnly, /บันทึก \/ Save/);
    assert.doesNotMatch(readOnly, /สร้าง QR/);
    assert.doesNotMatch(readOnly, /placeholder="Barcode"/);
    assert.match(manager, /name="name"/);
    assert.match(manager, /บันทึก \/ Save/);
    assert.match(manager, /สร้าง QR/);
    assert.match(manager, /placeholder="Barcode"/);
  });
});
