const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('/Users/thawatchai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const dir = __dirname;
const lockedDir = path.resolve(dir, '../line-system-oa-design-lock-2026-10-04');
const examples = JSON.parse(fs.readFileSync(lockedDir + '/source-answer-examples.json', 'utf8'));
const business = JSON.parse(fs.readFileSync(lockedDir + '/business-summary-examples.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [];
  const errors = [];
  try {
    for (const width of [736, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('file://' + dir + '/preview.html');
      const frame = page.frameLocator('iframe');
      const root = frame.locator('#mm-system-flex-preview');
      await root.waitFor();
      await root.evaluate(async root => {
        await Promise.race([root.ownerDocument.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))]);
        await Promise.all([...root.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
      });
      const state = async design => root.evaluate((root, design) => {
        root.ownerDocument.defaultView.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: { privateContent: { design } } } } }));
      }, design);
      const check = async (id, name) => {
        const card = frame.locator(id);
        const metrics = await card.evaluate(card => {
          const bubble = card.querySelector('.mm-bubble');
          const bounds = bubble.getBoundingClientRect();
          const texts = [...bubble.querySelectorAll('p,span,h3,button')].filter(node => node.getClientRects().length);
          const clipped = texts.filter(node => {
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1);
          }).map(node => node.textContent.slice(0, 60));
          const colons = [...bubble.querySelectorAll('.mm-colon')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().left);
          const image = bubble.querySelector('.mm-top img');
          const imageBounds = image.getBoundingClientRect();
          const paper = bubble.querySelector('.mm-paper').getBoundingClientRect();
          const title = bubble.querySelector('.mm-title').getBoundingClientRect();
          const overhang = imageBounds.bottom - paper.top;
          const headerCollision = title.right > imageBounds.left && title.bottom > imageBounds.top && title.top < imageBounds.bottom;
          const hit = card.ownerDocument.elementFromPoint(imageBounds.left + imageBounds.width / 2, paper.top + 5);
          const kicker = bubble.querySelector('.mm-kicker');
          const view = card.ownerDocument.defaultView;
          const headerLines = Math.round(title.height / parseFloat(view.getComputedStyle(bubble.querySelector('.mm-title')).lineHeight)) + (kicker ? Math.round(kicker.getBoundingClientRect().height / parseFloat(view.getComputedStyle(kicker).lineHeight)) : 0);
          return { height: Math.ceil(card.getBoundingClientRect().height), stageHeight: Math.ceil(card.closest('.mm-stage').getBoundingClientRect().height), headerHeight: Math.ceil(bubble.querySelector('.mm-top').getBoundingClientRect().height), headerLines, mascotWidth: Math.round(imageBounds.width), hasBrandRow: !!bubble.querySelector('.mm-brand-bar'), overflow: card.scrollWidth > card.clientWidth, clipped, missingImages: [...bubble.querySelectorAll('img')].some(img => !img.naturalWidth), colonSpread: colons.length ? Math.max(...colons) - Math.min(...colons) : 0, overhang, headerCollision, imageAbovePaper: hit === image };
        });
        assert.equal(metrics.overflow, false, name);
        assert.deepEqual(metrics.clipped, [], name);
        assert.equal(metrics.missingImages, false, name);
        assert.equal(metrics.colonSpread, 0, name);
        assert.ok(metrics.overhang >= 14 && metrics.overhang <= 18, name);
        assert.ok(metrics.headerHeight <= 145, name);
        assert.equal(metrics.headerLines, 2, name);
        assert.equal(metrics.hasBrandRow, false, name);
        assert.ok(metrics.mascotWidth >= 96, name);
        assert.equal(metrics.headerCollision, false, name);
        assert.equal(metrics.imageAbovePaper, true, name);
        await card.screenshot({ path: dir + '/screenshots/' + name + '-' + width + '.png' });
        results.push({ width, name, ...metrics });
      };
      await check('#mm-expense-summary-card', 'business-expense-summary');
      assert.equal(await frame.locator('#mm-summary-amount').textContent(), Number(business.expense.data.summary.totalAmount).toFixed(2) + ' บาท');
      assert.equal(await frame.locator('#mm-summary-count').textContent(), business.expense.data.total + ' รายการ');
      assert.equal(await frame.locator('#mm-summary-period').textContent(), business.expense.data.period.fromDate + ' – ' + business.expense.data.period.toDate);
      assert.equal(await frame.locator('#mm-summary-excluded').textContent(), business.expense.replyText.split('\n')[1]);
      assert.equal(await frame.locator('#mm-summary-source').textContent(), business.expense.sourceRefs[0].label);
      assert.equal(await frame.locator('#mm-summary-asof').textContent(), business.expense.asOf.slice(0, 10));
      await frame.locator('#mm-expense-summary-card [data-preview-action]').click();
      assert.match(await frame.locator('#mm-preview-response').textContent(), /ยังไม่ได้เปิดหรือแก้ไขรายการจริง/);
      await frame.locator('.viz-carousel-next').click();
      await state({ openWorkMode: 'พบแจ้งเตือน' });
      assert.equal(await frame.locator('#mm-open-work-title').textContent(), 'พบ ' + business.alerts.data.count + ' รายการ');
      assert.equal(await frame.locator('#mm-alert-item-title').textContent(), business.alerts.design.requestNumber);
      assert.equal(business.alerts.data.items[0].severity, 'ACTION');
      assert.equal(await frame.locator('#mm-alert-action .mm-label').textContent(), 'ต้องทำ');
      assert.equal(await frame.locator('#mm-alert-action .mm-value').textContent(), 'ตรวจสอบและอนุมัติใบเบิก');
      assert.equal(await frame.locator('#mm-open-work-action').textContent(), 'เปิดใบเบิกเพื่ออนุมัติ');
      assert.equal(await frame.locator('#mm-open-work-card [data-preview-action]').getAttribute('data-design-target'), business.alerts.design.proposedDetailPath);
      assert.equal(await frame.locator('#mm-open-work-card [href]').count(), 0);
      assert.doesNotMatch(await frame.locator('#mm-open-work-card').textContent(), /ระดับแจ้งเตือน|ขอบเขต/);
      await frame.locator('#mm-open-work-card [data-preview-action]').click();
      assert.match(await frame.locator('#mm-preview-response').textContent(), /เปิดใบเบิกเพื่ออนุมัติ.*ยังไม่ได้เปิดหรือแก้ไขรายการจริง/);
      await check('#mm-open-work-card', 'business-open-alert');
      await state({ openWorkMode: 'ไม่พบแจ้งเตือน' });
      assert.equal(business.emptyAlerts.data.count, 0);
      assert.equal(await frame.locator('#mm-open-work-title').textContent(), 'ไม่พบรายการ');
      assert.equal(await frame.locator('#mm-alert-item').isVisible(), false);
      assert.equal(await frame.locator('#mm-alert-action').isVisible(), false);
      assert.equal(await frame.locator('#mm-open-work-card [data-preview-action]').getAttribute('data-design-target'), business.emptyAlerts.sourceRefs[0].webPath);
      await check('#mm-open-work-card', 'business-empty-alerts');
      await state({ openWorkMode: 'ไม่พบงานที่มอบหมาย' });
      assert.equal(business.emptyTasks.data.total, 0);
      assert.equal(await frame.locator('#mm-open-work-title').textContent(), 'ไม่พบงานค้าง');
      assert.equal(await frame.locator('#mm-open-work-note').textContent(), 'ตรวจเฉพาะงานที่มอบหมายให้คุณและยังไม่เสร็จ');
      assert.equal(await frame.locator('#mm-open-work-card [data-preview-action]').getAttribute('data-design-target'), business.emptyTasks.sourceRefs[0].webPath);
      await check('#mm-open-work-card', 'business-empty-assigned-tasks');
      await state({ openWorkMode: 'พบแจ้งเตือน' });
      await frame.locator('.viz-carousel-next').click();
      for (const [mode, example, name] of [['ความสามารถ', 'capability', 'source-capability'], ['คุยทั่วไป', 'casual', 'source-casual'], ['อธิบายบิล', 'explain', 'source-explain']]) {
        await state({ answerMode: mode });
        assert.equal((await frame.locator('#mm-answer-text').textContent()).trim(), examples[example].replyText);
        assert.equal(await frame.locator('#mm-answer-question').getAttribute('aria-label'), examples[example].question);
        assert.equal(await frame.locator('#mm-answer-question').textContent(), example === 'explain' ? 'ค่าบริการในบิลทำไมคิดแยก' : examples[example].question);
        await check('#mm-answer-card', name);
      }
      await frame.locator('.viz-carousel-next').click();
      await state({ commandStatus: 'ก่อนยืนยัน' });
      assert.equal(await frame.locator('#mm-command-title').textContent(), 'รอยืนยัน');
      await check('#mm-command-card', 'source-command-preview');
      assert.equal(await frame.locator('#mm-command-confirm-buttons button').count(), 2);
      await frame.locator('[data-command-outcome="แก้ไขสำเร็จ"]').click();
      assert.equal(await frame.locator('#mm-command-result-text').textContent(), examples.command.appliedText.split('\n')[0]);
      assert.equal(await frame.locator('#mm-command-confirm-buttons').isVisible(), false);
      assert.equal(await frame.locator('#mm-command-title').textContent(), 'แก้ไขแล้ว');
      await check('#mm-command-card', 'source-command-applied');
      await state({ commandStatus: 'ก่อนยืนยัน' });
      await frame.locator('[data-command-outcome="ยกเลิก"]').click();
      assert.equal(await frame.locator('#mm-command-result-text').textContent(), examples.command.cancelledText);
      assert.equal(await frame.locator('#mm-command-title').textContent(), 'ยกเลิกแล้ว');
      await check('#mm-command-card', 'cancelled');
      await state({ commandStatus: 'ต้องถามเพิ่ม' });
      assert.equal(await frame.locator('#mm-command-result-text').textContent(), examples.command.ambiguousLineText);
      assert.equal(await frame.locator('#mm-command-title').textContent(), 'ขอข้อมูลเพิ่ม');
      await check('#mm-command-card', 'clarify');
      for (const id of ['#mm-general-card', '#mm-review-card', '#mm-payment-card', '#mm-scanning-card']) {
        await frame.locator('.viz-carousel-next').click();
        assert.equal(await frame.locator(id).isVisible(), true);
        await check(id, id.slice(1) + '-layered');
        if (id === '#mm-general-card') {
          for (const status of ['กำลังตรวจสอบข้อมูล', 'ปฏิเสธ', 'ยกเลิก']) {
            await state({ generalStatus: status });
            await check(id, 'general-' + status);
          }
          await state({ generalStatus: 'ยืนยันแล้ว' });
        }
        if (id === '#mm-payment-card') {
          for (const status of ['ยังไม่ชำระ', 'ชำระบางส่วน']) {
            await state({ paymentStatus: status });
            await check(id, 'payment-' + status);
          }
          await state({ paymentStatus: 'ชำระแล้ว' });
        }
      }
      await page.close();
    }
    assert.deepEqual(errors, []);
    const source = fs.readFileSync(lockedDir + '/approved-preview.html', 'utf8');
    assert.ok(Buffer.byteLength(source) < 1000000);
    assert.ok(!source.includes('3,424.00'));
    assert.ok(!source.includes('ยืนยันค่าใช้จ่ายแล้ว แปลว่าจ่ายเงินแล้วใช่ไหม'));
    fs.writeFileSync(dir + '/source-backed-card-checks.json', JSON.stringify({ status: 'PASS', sourceBytes: Buffer.byteLength(source), errors, results }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', sourceBytes: Buffer.byteLength(source), errors, results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
