import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { emptyDealForm } from './sales-console.logic';

(globalThis as any).React = React;
const priorSvg = require.extensions['.svg'];
require.extensions['.svg'] = (module) => { module.exports = () => null; };
const SalesDealFormPage = require('./SalesDealFormPage').default;
if (priorSvg) require.extensions['.svg'] = priorSvg; else delete require.extensions['.svg'];
const runtime = require('react') as typeof React;

for (const autoRenew of [false, true]) test(`MONEY-Q1 a 2600-baht Starter yearly offer warns against the 2490-baht catalog: auto=${autoRenew}`, () => {
  const original = runtime.useState;
  let index = 0;
  Reflect.set(runtime, 'useState', (initial: any) => {
    const pair = (original as any)(initial), i = index++;
    if (i === 0) return [{ ...emptyDealForm(), base: 'STARTER_249', priceBaht: '2600', months: '12', autoRenew, cadence: 'year' }, pair[1]];
    if (i === 1) return [{ companyId: 'shop', name: 'ร้านทดสอบ', accessState: 'NO_PACKAGE', tierKey: null, branchCount: 1, employeeCount: 1,
      catalogMonthlyPriceSatang: 24900, openDealId: null, province: null }, pair[1]];
    return pair;
  });
  try {
    const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push() {}, replace() {} } as any }, React.createElement(SalesDealFormPage, { canApprove: false })));
    assert.match(html, /ราคานี้สูงกว่าราคาปกติ/);
    assert.match(html, /฿2,490\.00/);
    assert.doesNotMatch(html, /฿2,988\.00/);
  } finally { Reflect.set(runtime, 'useState', original); }
});
