import { STAFF_OA_URL } from '../../modules/line-ai/domain/logic/line-staff-menu.logic';
import { PACKAGE_ADVISOR_MASCOT_DATA_URI } from './line-package-advisor-mascot';

export const PACKAGE_ADVISOR_CONTENT = `
      <section class="package-advisor" aria-labelledby="advisor-title">
        <img class="advisor-mascot" src="${PACKAGE_ADVISOR_MASCOT_DATA_URI}" alt="" />
        <p class="advisor-kicker">ผู้ช่วยดูแลร้านของคุณ</p>
        <h1 id="advisor-title">ช่วยดูแพ็กเกจที่เหมาะกับร้าน</h1>
        <p id="advisor-intro" class="advisor-copy">มั่งมีขอรู้จักร้านอีกนิดนะคะ มีคำถามสั้น ๆ 4 ข้อ จะได้ช่วยดูว่าแพ็กเกจไหนเหมาะกับงานที่ร้านใช้จริง</p>
        <p id="advisor-status" role="status" class="advisor-status" aria-live="polite">กำลังตรวจสอบแพ็กเกจปัจจุบันค่ะ</p>
        <div id="advisor-step" hidden>
          <div class="advisor-progress"><span id="advisor-progress-label"></span><progress id="advisor-progress" max="4" value="1" aria-label="ความคืบหน้าแบบประเมิน"></progress></div>
          <h2 id="advisor-question" class="advisor-question"></h2>
          <p id="advisor-hint" class="advisor-hint"></p>
          <div id="advisor-options" class="advisor-options" role="radiogroup"></div>
          <div class="advisor-actions">
            <button id="advisor-back" type="button" class="advisor-secondary" hidden>ย้อนกลับ</button>
            <button id="advisor-next" type="button" disabled>ถัดไป</button>
          </div>
        </div>
        <section id="advisor-result" class="advisor-result" hidden aria-labelledby="advisor-result-title">
          <p class="advisor-kicker">คำแนะนำจากข้อมูลแพ็กเกจปัจจุบัน</p>
          <h2 id="advisor-result-title"></h2>
          <p id="advisor-result-reason" class="advisor-copy"></p>
          <div id="advisor-offer" class="advisor-offer"></div>
          <button id="advisor-billing" type="button">ดูแพ็กเกจนี้</button>
          <button id="advisor-edit" type="button" class="advisor-secondary">กลับไปแก้คำตอบ</button>
        </section>
        <div id="advisor-empty" hidden class="advisor-result" role="status"></div>
        <div class="advisor-footer">
          <a id="advisor-receipt" href="#">กลับไปส่งใบเสร็จ</a>
          <a id="advisor-support" href="${STAFF_OA_URL}" target="_blank" rel="noopener noreferrer">คุยกับทีมดูแล</a>
        </div>
      </section>`;

export const PACKAGE_ADVISOR_STYLE = `
    .package-advisor{--advisor-ink:var(--ink);--advisor-muted:var(--muted);--advisor-line:var(--line);--advisor-tint:var(--ground);max-width:540px;margin:0 auto;color:var(--advisor-ink)}
    .advisor-mascot{display:block;width:112px;height:112px;object-fit:contain;margin:0 auto 8px}
    .advisor-kicker{margin:0;color:var(--brand-dark);font-size:13px;font-weight:700;letter-spacing:.02em;text-align:center}
    .package-advisor h1,.package-advisor h2{color:var(--advisor-ink)}
    #advisor-title{text-align:center;margin:2px 0 8px;font-size:22px;line-height:1.35}
    .advisor-copy{color:var(--advisor-muted);line-height:1.75;margin:8px 0 16px}
    .advisor-status{padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--advisor-tint);color:var(--ink);margin:14px 0}
    .advisor-status:empty,.advisor-hint:empty{display:none}
    .advisor-progress{margin:18px 0 14px}
    #advisor-progress-label{display:block;margin-bottom:6px;font-size:13px;color:var(--advisor-muted)}
    #advisor-progress{width:100%;height:8px;accent-color:var(--brand-dark)}
    .advisor-question{font-size:19px;line-height:1.5;margin:0 0 4px}
    .advisor-hint{font-size:14px;color:var(--advisor-muted);margin:0 0 12px}
    .advisor-options{display:grid;gap:9px;margin:12px 0}
    .advisor-choice{width:100%;min-height:52px;padding:12px 14px;border:1px solid var(--advisor-line);border-radius:13px;background:#fff;color:var(--advisor-ink);font:inherit;font-weight:600;text-align:left;cursor:pointer}
    .advisor-choice[aria-checked="true"]{border-color:var(--brand-dark);background:#F0FDF4;box-shadow:0 0 0 1px var(--brand-dark)}
    .advisor-actions{display:flex;gap:10px;margin-top:16px}
    .advisor-actions button{flex:1}
    .package-advisor button:not(.advisor-choice):not(.advisor-secondary){border:0;border-radius:12px;background:var(--brand-dark);color:#fff;min-height:48px;padding:11px 16px;font:inherit;font-weight:700;cursor:pointer}
    .package-advisor button:disabled{opacity:.5;cursor:default}
    .package-advisor button.advisor-secondary{background:#fff;color:var(--brand-dark);border:1px solid var(--line)}
    .package-advisor button.advisor-choice{width:100%;min-height:52px;padding:12px 14px;border:1px solid var(--advisor-line);border-radius:13px;background:#fff;color:var(--advisor-ink);font:inherit;font-weight:600;text-align:left;cursor:pointer}
    .package-advisor button.advisor-choice[aria-checked="true"]{border-color:var(--brand-dark);background:#F0FDF4;box-shadow:0 0 0 1px var(--brand-dark)}
    .advisor-result{margin-top:18px;padding:18px;border:1px solid var(--line);border-radius:16px;background:var(--ground)}
    .advisor-result>button{margin:4px 6px 0 0}
    .advisor-result .advisor-kicker{text-align:left}
    #advisor-result-title{font-size:21px;margin:4px 0 8px}
    .advisor-offer{padding:12px;background:#fff;border:1px solid var(--advisor-line);border-radius:12px;line-height:1.8;margin:12px 0}
    .advisor-footer{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0 2px}
    .advisor-footer a{display:flex;min-height:46px;align-items:center;justify-content:center;padding:9px;border:1px solid var(--line);border-radius:12px;color:var(--brand-dark);background:#fff;text-align:center;font-size:14px;font-weight:700;text-decoration:none}
    @media(max-width:380px){.advisor-mascot{width:92px;height:92px}.advisor-footer{grid-template-columns:1fr}.advisor-actions{gap:7px}.advisor-actions button{padding-inline:10px}}
    @media(prefers-reduced-motion:reduce){.package-advisor *{scroll-behavior:auto!important;transition:none!important}}`;

export const PACKAGE_ADVISOR_SCRIPT = String.raw`'use strict';
(function () {
  const root = document.body;
  const apiBase = (() => {
    try {
      const value = new URL(root.dataset.apiBase || '', location.origin);
      return value.origin === location.origin && value.pathname.replace(/\/$/, '') === '/v1' && !value.search && !value.hash
        ? value.origin + '/v1' : '';
    } catch { return ''; }
  })();
  const liffId = root.dataset.liffId || '';
  const supportUrl = root.dataset.supportUrl || '${STAFF_OA_URL}';
  const oaAddUrl = root.dataset.oaAddUrl || '';
  const webBase = root.dataset.webBase || '';
  const byId = (id) => document.getElementById(id);
  const status = byId('advisor-status');
  const intro = byId('advisor-intro');
  const stepView = byId('advisor-step');
  const resultView = byId('advisor-result');
  const emptyView = byId('advisor-empty');
  const progress = byId('advisor-progress');
  const progressLabel = byId('advisor-progress-label');
  const question = byId('advisor-question');
  const hint = byId('advisor-hint');
  const choices = byId('advisor-options');
  const next = byId('advisor-next');
  const back = byId('advisor-back');
  const resultTitle = byId('advisor-result-title');
  const resultReason = byId('advisor-result-reason');
  const offerBox = byId('advisor-offer');
  const billing = byId('advisor-billing');
  const answers = [null, null, null, null];
  const copy = [
    { q: 'ที่ร้านมีคนช่วยดูแลใบเสร็จและรายจ่ายกี่คนคะ?', h: 'นับตัวคุณด้วยนะคะ' },
    { q: 'แต่ละเดือนมีใบเสร็จให้ดูแลประมาณกี่ใบคะ?', h: 'เลือกจำนวนคร่าว ๆ ได้ค่ะ ถ้ายังไม่แน่ใจก็ไม่เป็นไร' },
    { q: 'ตอนนี้อยากให้มั่งมีช่วยงานไหนมากที่สุดคะ?', h: '' },
    { q: 'ปกติที่ร้านเก็บใบเสร็จและจดรายจ่ายกันอย่างไรคะ?', h: '' }
  ];
  const goalOptions = [
    ['receipt_capture', 'อ่านและเก็บใบเสร็จ'], ['expense_collection', 'รวบรวมรายจ่าย'],
    ['dashboard_notifications', 'ดูภาพรวมร้าน'], ['employee_access', 'ช่วยทีมทำงานร่วมกัน']
  ];
  const workflowOptions = [['paper', 'กระดาษหรือสมุด'], ['spreadsheet', 'ตาราง'], ['software', 'โปรแกรมเดิม'], ['accountant', 'สำนักงานบัญชี']];
  let catalog = null;
  let step = 0;
  let selectedOffer = null;
  let reviewedFingerprint = '';
  let busy = false;

  function setStatus(text, isError) {
    status.textContent = text;
    status.classList.toggle('advisor-error', !!isError);
  }
  function validCatalog(value) {
    if (!value || value.schemaVersion !== 1 || !['LIVE', 'TEST', 'DISABLED'].includes(value.mode)
      || !['INCLUSIVE_VAT_7', 'EXCLUSIVE_VAT_7', 'NOT_VAT_REGISTERED', null].includes(value.taxTreatment)
      || !Array.isArray(value.offers) || typeof value.catalogRevision !== 'string' || !value.catalogRevision
      || !Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) <= Date.now()) return false;
    return !(value.mode === 'DISABLED' && value.offers.some((offer) => offer?.availability === 'AVAILABLE'))
      && value.offers.every((offer) => offer && typeof offer.offerKey === 'string' && ['month', 'year'].includes(offer.interval)
      && ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'].includes(offer.offerKey)
      && offer.currency === 'THB' && typeof offer.label === 'string' && !!offer.label && Number.isSafeInteger(offer.priceSatang) && offer.priceSatang >= 0
      && Number.isSafeInteger(offer.intervalCount) && offer.intervalCount === 1
      && Number.isSafeInteger(offer.branchLimit) && offer.branchLimit > 0
      && Number.isSafeInteger(offer.employeeLimit) && offer.employeeLimit > 0 && Number.isSafeInteger(offer.monthlySlipLimit)
      && offer.monthlySlipLimit > 0 && Number.isSafeInteger(offer.receiptAllowance) && offer.receiptAllowance > 0
      && offer.receiptAllowanceCadence === 'PAID_PERIOD'
      && Array.isArray(offer.featureKeys) && offer.featureKeys.every((key) => typeof key === 'string')
      && ['AVAILABLE', 'UNAVAILABLE', 'COMING_SOON'].includes(offer.availability));
  }
  async function loadCatalog() {
    const response = await fetch(apiBase + '/billing/catalog', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('ตอนนี้ยังอ่านข้อมูลแพ็กเกจไม่ได้ค่ะ ลองใหม่อีกครั้งได้เลยนะคะ');
    const value = await response.json();
    if (!validCatalog(value)) throw new Error('ข้อมูลแพ็กเกจหมดอายุหรือไม่ครบค่ะ ลองอ่านข้อมูลล่าสุดอีกครั้งนะคะ');
    return value;
  }
  function availableCaps(field) {
    return Array.from(new Set(catalog.offers.filter((offer) => offer.interval === 'month' && Number.isSafeInteger(offer[field]) && offer[field] > 0)
      .map((offer) => offer[field]))).sort((a, b) => a - b);
  }
  function bandOptions(field, suffix) {
    let lower = 1;
    return availableCaps(field).map((upper) => {
      const label = lower === upper ? upper.toLocaleString('th-TH') : lower.toLocaleString('th-TH') + '–' + upper.toLocaleString('th-TH');
      const item = { value: upper, label: label + ' ' + suffix };
      lower = upper + 1;
      return item;
    }).concat([{ value: 'over', label: 'มากกว่า ' + (lower - 1).toLocaleString('th-TH') + ' ' + suffix }]);
  }
  function optionsFor(index) {
    if (index === 0) return bandOptions('employeeLimit', 'คน');
    if (index === 1) return bandOptions('monthlySlipLimit', 'ใบต่อเดือน').concat([{ value: 'unknown', label: 'ยังไม่แน่ใจ' }]);
    if (index === 2) return goalOptions.map(([value, label]) => ({ value, label }));
    return workflowOptions.map(([value, label]) => ({ value, label }));
  }
  function renderStep() {
    resultView.hidden = true;
    emptyView.hidden = true;
    stepView.hidden = false;
    const item = copy[step];
    question.textContent = item.q;
    hint.textContent = item.h;
    progress.value = step + 1;
    progressLabel.textContent = 'ข้อ ' + (step + 1) + ' จาก 4';
    choices.replaceChildren();
    for (const option of optionsFor(step)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'advisor-choice';
      button.setAttribute('role', 'radio');
      button.dataset.value = String(option.value);
      button.setAttribute('aria-checked', String(answers[step] === option.value));
      button.textContent = option.label;
      button.addEventListener('click', function () {
        selectAnswer(option.value);
      });
      choices.appendChild(button);
    }
    next.disabled = answers[step] === null;
    next.textContent = step === 3 ? 'ดูคำแนะนำ' : 'ถัดไป';
    next.hidden = false;
    back.hidden = step === 0;
    setStatus('', false);
  }
  function selectAnswer(value) {
    answers[step] = value;
    for (const choice of choices.children) choice.setAttribute('aria-checked', String(choice.dataset.value === String(value)));
    next.disabled = false;
  }
  choices.addEventListener('keydown', function (event) {
    if (event.target.getAttribute('role') !== 'radio') return;
    const current = Array.from(choices.children).indexOf(event.target);
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key) || current < 0) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (current + direction + choices.children.length) % choices.children.length;
    const choice = choices.children[nextIndex];
    choice.focus();
    selectAnswer(optionsFor(step)[nextIndex].value);
  });
  function selectedAnswers() {
    const peopleChoice = answers[0];
    const receiptChoice = answers[1];
    const peopleCaps = availableCaps('employeeLimit');
    const receiptCaps = availableCaps('monthlySlipLimit');
    const people = peopleChoice === 'over' ? (peopleCaps[peopleCaps.length - 1] || 0) + 1 : Number(peopleChoice);
    const receipts = receiptChoice === 'unknown' ? null : receiptChoice === 'over' ? (receiptCaps[receiptCaps.length - 1] || 0) + 1 : Number(receiptChoice);
    if (!Number.isSafeInteger(people) || people < 1 || (receipts !== null && (!Number.isSafeInteger(receipts) || receipts < 1))) return null;
    if (!['receipt_capture', 'expense_collection', 'dashboard_notifications', 'employee_access'].includes(String(answers[2]))) return null;
    const peopleLabel = bandOptions('employeeLimit', 'คน').find((option) => option.value === peopleChoice)?.label;
    return { people, peopleLabel, receipts, goal: answers[2], workflow: answers[3] };
  }
  function match() {
    const input = selectedAnswers();
    if (!input) return null;
    const matches = catalog.offers.filter((offer) => offer.interval === 'month' && offer.availability === 'AVAILABLE'
      && offer.employeeLimit >= input.people && (input.receipts === null || offer.monthlySlipLimit >= input.receipts)
      && offer.featureKeys.includes(input.goal === 'receipt_capture' || input.goal === 'expense_collection' ? 'expenses' : input.goal));
    matches.sort((a, b) => a.priceSatang - b.priceSatang || a.employeeLimit - b.employeeLimit || a.monthlySlipLimit - b.monthlySlipLimit
      || a.offerKey.localeCompare(b.offerKey));
    return matches[0] ? { offer: matches[0], input } : null;
  }
  function money(satang) {
    return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(satang / 100);
  }
  function fingerprint(offer) {
    return [catalog.catalogRevision, catalog.taxTreatment, offer.offerKey, offer.label, offer.interval, offer.priceSatang, offer.branchLimit,
      offer.employeeLimit, offer.monthlySlipLimit, offer.receiptAllowance, offer.availability, (offer.featureKeys || []).slice().sort().join(',')].join('|');
  }
  function showResult(result, note) {
    stepView.hidden = true;
    emptyView.hidden = true;
    if (!result) {
      intro.hidden = false;
      resultView.hidden = true;
      emptyView.hidden = false;
      emptyView.textContent = 'จากจำนวนที่เลือก ยังไม่พบแพ็กเกจที่เปิดขายและรองรับครบค่ะ ลองปรับคำตอบหรือคุยกับทีมดูแลได้เลยนะคะ';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'advisor-secondary';
      edit.textContent = 'กลับไปแก้คำตอบ';
      edit.addEventListener('click', function () { step = 0; renderStep(); });
      emptyView.appendChild(edit);
      setStatus(note || '', false);
      return;
    }
    selectedOffer = result.offer;
    intro.hidden = true;
    reviewedFingerprint = fingerprint(result.offer);
    resultTitle.textContent = result.offer.label;
    resultReason.textContent = 'จากที่คุณเล่า มั่งมีแนะนำแพ็กเกจนี้ค่ะ ' + reasonText(result.input)
      + (note ? ' ' + note : '');
    offerBox.textContent = 'ราคา ' + money(result.offer.priceSatang) + ' บาทต่อเดือน รองรับผู้ดูแล ' + result.offer.employeeLimit.toLocaleString('th-TH')
      + ' คน และประมาณ ' + result.offer.monthlySlipLimit.toLocaleString('th-TH') + ' ใบต่อเดือน';
    resultView.hidden = false;
    setStatus('', false);
  }
  function reasonText(input) {
    const goalName = { receipt_capture: 'อ่านและเก็บใบเสร็จ', expense_collection: 'รวบรวมรายจ่าย', dashboard_notifications: 'ดูภาพรวมร้าน', employee_access: 'ช่วยทีมทำงานร่วมกัน' }[input.goal];
    const workflow = { paper: 'เริ่มจากถ่ายใบเสร็จและเก็บรายการไว้ดูในที่เดียว', spreadsheet: 'เริ่มจากส่งใบเสร็จสักใบ แล้วตรวจข้อมูลที่มั่งมีอ่านให้ก่อนบันทึกได้เลยค่ะ',
      software: 'ดูสิทธิ์ที่รวมอยู่ในแพ็กเกจนี้ควบคู่กับวิธีเดิม', accountant: 'รวบรวมข้อมูลไว้ตรวจร่วมกับสำนักงานบัญชี' }[input.workflow];
    return 'เพราะร้านอยาก' + goalName + ' และมีผู้ดูแลอยู่ในช่วง ' + (input.peopleLabel || ('ไม่เกิน ' + input.people.toLocaleString('th-TH') + ' คน'))
      + (input.receipts === null ? ' ยังไม่ระบุจำนวนใบเสร็จ จึงเป็นคำแนะนำเบื้องต้น' : ' รองรับจำนวนที่เลือกประมาณ ' + input.receipts.toLocaleString('th-TH') + ' ใบต่อเดือน')
      + ' ' + workflow;
  }
  function validWebBase() {
    try {
      const base = new URL(webBase);
      return base.protocol === 'https:' && base.origin === webBase.replace(/\/$/, '') && !base.username && !base.password ? base : null;
    } catch { return null; }
  }
  function safeHandoff(value) {
    const base = validWebBase();
    if (!base || typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return url.origin === base.origin && url.protocol === 'https:' && !url.username && !url.password
        && /^\/l\/[A-Za-z0-9_-]{32}$/.test(url.pathname)
        && !url.search && !url.hash ? url.href : '';
    } catch { return ''; }
  }
  function webFallback(offer) {
    const base = validWebBase();
    if (!base) return '';
    const url = new URL('/billing/companies', base.origin);
    url.searchParams.set('offer', offer.offerKey);
    url.searchParams.set('interval', 'month');
    url.searchParams.set('channel', 'line');
    return url.href;
  }
  function support() {
    try {
      const url = new URL(supportUrl);
      return url.href === '${STAFF_OA_URL}' ? url.href : '${STAFF_OA_URL}';
    } catch { return '${STAFF_OA_URL}'; }
  }
  const supportLink = byId('advisor-support');
  supportLink.href = support();
  function returnToReceipt() {
    if (window.liff && liff.isInClient()) {
      try { liff.closeWindow(); return; } catch { /* fall back to the system OA below */ }
    }
    try {
      const url = new URL(oaAddUrl);
      const lineRedirect = url.hostname === 'line.me' && !url.port && /^\/R\/ti\/p\/(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/.test(url.pathname);
      const shortLink = url.hostname === 'lin.ee' && !url.port && /^\/[A-Za-z0-9_-]{4,32}$/.test(url.pathname);
      if (url.protocol === 'https:' && !url.username && !url.password && (lineRedirect || shortLink) && !url.search && !url.hash) { location.assign(url.href); return; }
    } catch { /* no safe OA destination; keep the current page available */ }
    setStatus('กลับไปที่แชท LINE เพื่อส่งใบเสร็จได้เลยค่ะ', false);
  }
  byId('advisor-receipt').addEventListener('click', function (event) { event.preventDefault(); returnToReceipt(); });
  byId('advisor-edit').addEventListener('click', function () { step = 0; renderStep(); });
  back.addEventListener('click', function () { if (step > 0) { step -= 1; renderStep(); } });
  next.addEventListener('click', function () {
    if (next.disabled) return;
    if (step < 3) { step += 1; renderStep(); return; }
    void calculateResult();
  });
  async function calculateResult() {
    if (busy) return;
    busy = true;
    setStatus('กำลังอ่านแพ็กเกจปัจจุบันค่ะ', false);
    try {
      catalog = await loadCatalog();
      showResult(match());
    } catch {
      stepView.hidden = true;
      emptyView.hidden = false;
      emptyView.textContent = 'ยังอ่านข้อมูลแพ็กเกจไม่ได้ค่ะ ลองอีกครั้งได้เลยนะคะ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'ลองอีกครั้ง';
      retry.addEventListener('click', function () { emptyView.hidden = true; stepView.hidden = false; void calculateResult(); });
      emptyView.appendChild(retry);
      setStatus('', true);
    } finally { busy = false; }
  }
  billing.addEventListener('click', function () { void beginBilling(); });
  async function beginBilling() {
    if (busy || !selectedOffer) return;
    busy = true;
    billing.disabled = true;
    setStatus('กำลังตรวจสอบแพ็กเกจล่าสุดค่ะ', false);
    try {
      const fresh = await loadCatalog();
      const oldFingerprint = reviewedFingerprint;
      catalog = fresh;
      const current = match();
      if (!current) { showResult(null, 'แพ็กเกจที่แนะนำเปลี่ยนสถานะแล้วค่ะ ลองดูคำแนะนำล่าสุดหรือคุยกับทีมดูแลได้เลยนะคะ'); return; }
      const newFingerprint = fingerprint(current.offer);
      if (oldFingerprint !== newFingerprint) {
        showResult(current, 'มีการอัปเดตข้อมูลแพ็กเกจค่ะ กรุณาตรวจคำแนะนำและราคาใหม่ก่อนกดไปต่อ');
        return;
      }
      if (!window.liff || !liff.isInClient()) {
        const fallback = webFallback(current.offer);
        if (!fallback) throw new Error('ยังเปิดหน้าแพ็กเกจไม่ได้ค่ะ กรุณาคุยกับทีมดูแล');
        location.assign(fallback);
        return;
      }
      if (!await initLiff()) return;
      const token = liff.getIDToken();
      if (typeof token !== 'string' || !token) throw new Error('ตรวจสอบบัญชี LINE ไม่สำเร็จค่ะ ลองเปิดหน้านี้อีกครั้งนะคะ');
      const response = await fetch(apiBase + '/auth/line/liff/session', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: token, billingOffer: current.offer.offerKey, billingInterval: 'month' }) });
      const payload = await response.json();
      if (!response.ok) throw new Error('ยังเปิดหน้าแพ็กเกจไม่ได้ค่ะ ลองอีกครั้งหรือคุยกับทีมดูแลได้เลย');
      if (payload.needsSelection) { showCompanies(payload.companies || []); return; }
      if (payload.needsSignup) throw new Error('ยังไม่พบร้านที่ผูกกับ LINE นี้ค่ะ กรุณาเปิดร้านก่อนแล้วค่อยเลือกแพ็กเกจนะคะ');
      if (payload.reason || !payload.handoffUrl) throw new Error('ยังเปิดหน้าแพ็กเกจไม่ได้ค่ะ กรุณาลองอีกครั้งหรือคุยกับทีมดูแล');
      openHandoff(payload.handoffUrl);
    } catch { setStatus('ยังเปิดหน้าแพ็กเกจไม่ได้ค่ะ ลองอีกครั้งหรือคุยกับทีมดูแลได้เลย', true); }
    finally { busy = false; billing.disabled = false; }
  }
  function showCompanies(companies) {
    choices.replaceChildren();
    resultView.hidden = true;
    stepView.hidden = false;
    question.textContent = 'เลือกหาร้านที่ต้องการดูแพ็กเกจ';
    hint.textContent = 'มั่งมีจะแสดงแพ็กเกจของร้านที่คุณเลือก';
    for (const company of companies) {
      if (!company || typeof company.id !== 'string' || typeof company.name !== 'string') continue;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'advisor-choice'; button.textContent = company.name;
      button.addEventListener('click', function () {
        void selectCompany(company.id).catch(() => setStatus('ยังเปิดหน้าแพ็กเกจไม่ได้ค่ะ ลองอีกครั้งหรือคุยกับทีมดูแลได้เลย', true));
      });
      choices.appendChild(button);
    }
    next.hidden = true; back.hidden = false;
    setStatus('', false);
  }
  async function selectCompany(companyId) {
    if (busy || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return;
    busy = true;
    setStatus('กำลังตรวจสอบร้านค่ะ', false);
    try {
      const oldFingerprint = reviewedFingerprint;
      catalog = await loadCatalog();
      const current = match();
      if (!current) { showResult(null, 'แพ็กเกจที่แนะนำเปลี่ยนสถานะแล้วค่ะ ลองดูคำแนะนำล่าสุดหรือคุยกับทีมดูแลได้เลยนะคะ'); return; }
      if (oldFingerprint !== fingerprint(current.offer)) {
        showResult(current, 'มีการอัปเดตข้อมูลแพ็กเกจค่ะ กรุณาตรวจคำแนะนำและราคาใหม่ก่อนกดไปต่อ');
        return;
      }
      const response = await fetch(apiBase + '/auth/line/liff/session', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: liff.getIDToken(), companyId, billingOffer: current.offer.offerKey, billingInterval: 'month' }) });
      const payload = await response.json();
      if (!response.ok || payload.needsSelection || payload.reason || !payload.handoffUrl) throw new Error('ยังเปิดหน้าแพ็กเกจของร้านนี้ไม่ได้ค่ะ');
      openHandoff(payload.handoffUrl);
    } finally { busy = false; }
  }
  function openHandoff(value) {
    const url = safeHandoff(value);
    if (!url) throw new Error('ลิงก์เปิดหน้าแพ็กเกจไม่ถูกต้องค่ะ ลองใหม่อีกครั้ง');
    liff.openWindow({ url, external: true });
  }
  async function initLiff() {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(liffId) || !apiBase) throw new Error('ตั้งค่าการเชื่อมต่อ LINE ไม่ครบค่ะ');
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
    return true;
  }
  const retry = document.createElement('button');
  retry.type = 'button'; retry.textContent = 'ลองอ่านแพ็กเกจอีกครั้ง';
  retry.addEventListener('click', function () { void initialize(); });
  async function initialize() {
    setStatus('กำลังตรวจสอบแพ็กเกจปัจจุบันค่ะ', false);
    try {
      catalog = await loadCatalog();
      if (!availableCaps('employeeLimit').length || !availableCaps('monthlySlipLimit').length) throw new Error('ยังไม่พบข้อมูลจำนวนผู้ดูแลและใบเสร็จในแพ็กเกจค่ะ');
      renderStep();
    } catch {
      stepView.hidden = true;
      emptyView.hidden = false;
      emptyView.textContent = 'ตอนนี้ยังอ่านข้อมูลแพ็กเกจไม่ได้ค่ะ ลองอีกครั้งได้เลยนะคะ';
      emptyView.appendChild(retry);
      setStatus('', true);
    }
  }
  void initialize();
})();`;
