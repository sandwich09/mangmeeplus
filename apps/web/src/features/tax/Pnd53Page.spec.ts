import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const svg = require.extensions['.svg'];
require.extensions['.svg'] = module => { module.exports = () => null; };
const { Pnd53Page } = require('./Pnd53Page');
if (svg) require.extensions['.svg'] = svg; else delete require.extensions['.svg'];
(globalThis as any).React = React;

test('PND53 links to the shop certificate list only when the reader may issue certificates', () => {
  for (const allowed of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(Pnd53Page, { companyId: 'shop-1', permissions: ['wht.pnd53.read', ...(allowed ? ['wht.certificate.issue'] : [])] }));
    assert.equal(html.includes('หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ของรายการเหล่านี้'), allowed);
    assert.equal(html.includes('href="/companies/shop-1/expenses/wht-certificates"'), allowed);
    assert.ok(html.includes('ภ.ง.ด.53'));
  }
});
