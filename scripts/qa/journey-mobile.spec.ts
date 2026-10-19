import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expectFitsScreen, screenOverflow } from '../../e2e/harness/screen-fit';

const rect = { left: 16, right: 400, top: 20, bottom: 64, width: 384, height: 44 };
function element(box = rect, css = {}, parentElement: any = null, hidden = false, drawer = false): any {
  return { tagName: 'BUTTON', textContent: 'บันทึก', parentElement,
    getBoundingClientRect: () => box,
    closest: () => hidden ? {} : null, matches: () => drawer,
    css: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', position: 'static', ...css } };
}
function collect(elements: any[]) {
  const globals = globalThis as any;
  const prior = { document: globals.document, getComputedStyle: globals.getComputedStyle };
  globals.document = { documentElement: { clientWidth: 375 }, body: { querySelectorAll: () => elements } };
  globals.getComputedStyle = (node: any) => node.css;
  try { return screenOverflow(); } finally { Object.assign(globals, prior); }
}

test('mobile guard catches a visible control or a clipped control past the right edge', () => {
  assert.equal(collect([element()]).length, 1);
  assert.equal(collect([element(rect, {}, element({ ...rect, right: 375 }, { overflowX: 'hidden' }))]).length, 1);
});
test('mobile guard allows scrolling content but still catches an overflowing scroll container', () => {
  const scroller = element({ ...rect, right: 375, width: 359 }, { overflowX: 'auto' });
  assert.deepEqual(collect([element(rect, {}, scroller)]), []);
  assert.equal(collect([element(rect, { overflowX: 'auto' })]).length, 1);
});
test('mobile guard ignores aria-hidden, sr-only, invisible and collapsed controls', () => {
  assert.deepEqual(collect([
    element(rect, {}, null, true), element({ ...rect, width: 1, height: 1 }),
    element(rect, { visibility: 'hidden' }),
    element(rect, {}, element({ ...rect, height: 0 }, { overflowY: 'hidden' })),
  ]), []);
});
test('mobile guard ignores a fixed off-canvas drawer but catches an offscreen fixed popup', () => {
  const offscreen = { ...rect, left: 400, right: 650 };
  const drawer = element(offscreen, { position: 'fixed' }, null, false, true);
  assert.deepEqual(collect([drawer, element(offscreen, {}, drawer)]), []);
  assert.equal(collect([element(offscreen, { position: 'fixed' })]).length, 1);
});
test('screen guard is a no-op in the chromium project', async () => {
  await expectFitsScreen({ evaluate: () => { throw new Error('desktop must not be evaluated'); } } as any, 'chromium');
});
test('mobile project uses Pixel 7 at 375 by 667 and proof keeps its safety setup and desktop default', () => {
  const config = readFileSync(new URL('../../playwright.config.ts', import.meta.url), 'utf8');
  const proof = readFileSync(new URL('../local-proof/proof-journeys.sh', import.meta.url), 'utf8');
  assert.match(config, /name: 'journeys-mobile',[\s\S]*?testMatch: \/journeys/);
  assert.match(config, /devices\['Pixel 7'\], viewport: \{ width: 375, height: 667 \}/);
  assert.match(proof, /lp_tag "\$\{1:-\}"; lp_heavy "\$@"\nlp_env proof/);
  assert.match(proof, /--project="\$\{JOURNEY_PROJECT:-chromium\}"/);
});
test('role sessions inherit the selected device and are covered by the arrival guard', () => {
  const fixtures = readFileSync(new URL('../../e2e/harness/fixtures.ts', import.meta.url), 'utf8');
  assert.match(fixtures, /browser.newContext\(\{ baseURL: WEB_BASE_URL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent \}\)/);
  assert.match(fixtures, /finish.push\(watchScreenFit\(context, info\)\)/);
});

test('the themed chooser reopens a list lost during placement and keeps an already open list open', async () => {
  const source = readFileSync(new URL('../../e2e/harness/e2e-utils.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function chooseThemedOption'), source.indexOf('/** Mirrors'));
  const code = ts.transpileModule(body.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const initiallyOpen of [false, true]) {
    let open = initiallyOpen, visible = initiallyOpen, clicks = 0, selections = 0;
    const trigger = {
      getAttribute: async () => String(open),
      click: async () => { clicks++; open = !open; visible = open;
        if (clicks === 1) { open = false; visible = false; } // Placement closes the first opening.
      },
    };
    const option = { click: async () => { assert.equal(open && visible, true); selections++; } };
    const assertions = (actual: any) => ({
      toHaveAttribute: async (_: string, expected: string) => assert.equal(await actual.getAttribute(), expected),
      toBeVisible: async () => assert.equal(visible, true),
      toPass: async () => {
        for (let attempt = 0; ; attempt++) {
          try { await actual(); return; } catch (error) { if (attempt === 2) throw error; }
        }
      },
    });
    const choose = new Function('expect', `${code}; return chooseThemedOption;`)(assertions);
    await choose({ getByRole: (role: string, args: any) => {
      assert.equal(role, 'option'); assert.deepEqual(args, { name: 'VAT รวมในราคา', exact: true }); return option;
    } }, trigger, 'VAT รวมในราคา');
    assert.equal(clicks, initiallyOpen ? 0 : 2);
    assert.equal(selections, 1);
  }
});
