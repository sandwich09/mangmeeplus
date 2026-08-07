export const LINE_ID_TOKEN_MAX_LENGTH = 4096;
export const LINE_ID_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const LINE_CHANNEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const EMPLOYEE_LINE_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const LIFF_PAGE_CSP = "default-src 'self'; script-src 'self' https://static.line-scdn.net; connect-src 'self' https://api.line.me; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://access.line.me https://liff.line.me; object-src 'none'; base-uri 'none'; form-action 'self'";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function validLineChannelId(value: string | null): string {
  return value && LINE_CHANNEL_ID_PATTERN.test(value) ? value : '';
}

// Static same-origin code: untrusted query values stay runtime data and never enter an executable HTML parser context.
export const LIFF_PAGE_SCRIPT = String.raw`'use strict';
(function () {
  const root = document.body;
  const mode = root.dataset.liffMode || '';
  const liffId = root.dataset.liffId || '';
  const apiBase = sameOriginApiBase(root.dataset.apiBase || '');
  const devMode = root.dataset.devMode === 'true';
  const oaAddUrl = root.dataset.oaAddUrl || '';
  const query = new URLSearchParams(location.search);
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  const actionBtn = document.getElementById(mode === 'customer' ? 'register' : 'link');
  const openLineEl = document.getElementById('open-line');

  if (openLineEl && oaAddUrl) {
    openLineEl.href = oaAddUrl;
    openLineEl.hidden = false;
  }

  function sameOriginApiBase(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url.href.replace(/\/$/, '') : '';
    } catch {
      return '';
    }
  }

  function validIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : '';
  }

  function validChannelId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : '';
  }

  function validIdToken(value) {
    return typeof value === 'string' && value.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
  }

  function validWatchDogToken(value) {
    return typeof value === 'string' && value.length <= 32768 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
  }

  function setStatus(text, detail) {
    statusEl.textContent = text;
    detailEl.textContent = detail || '';
  }

  function removeQueryParam(name) {
    const url = new URL(location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  async function getWatchDogToken(watchdogUserId) {
    const stored = localStorage.getItem('watchdog_access_token');
    if (validWatchDogToken(stored)) return stored;
    if (stored) localStorage.removeItem('watchdog_access_token');
    if (!devMode) throw new Error('WatchDog session missing. Login to WatchDog first.');
    const tokenUrl = apiBase + '/auth/dev/token?fresh=' + Date.now();
    const res = await fetch(tokenUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(watchdogUserId ? { userId: watchdogUserId } : {}) })
    });
    const text = await res.text();
    if (!res.ok) throw new Error('Dev token failed: ' + res.status + '\nURL: ' + tokenUrl + '\nBody: ' + text.slice(0, 500));
    const data = JSON.parse(text);
    if (!validWatchDogToken(data.accessToken)) throw new Error('Dev token response was invalid.');
    localStorage.setItem('watchdog_access_token', data.accessToken);
    return data.accessToken;
  }

  async function initLiff() {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(liffId)) throw new Error('LINE_LIFF_ID is not configured.');
    if (!apiBase) throw new Error('Invalid API origin.');
    setStatus('Initializing LIFF...');
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return false;
    }
    return true;
  }

  function currentIdToken() {
    const decoded = liff.getDecodedIDToken();
    if (!decoded || !decoded.exp || decoded.exp * 1000 < Date.now() + 60000) {
      setStatus('Refreshing LINE session...');
      liff.logout();
      liff.login({ redirectUri: location.href });
      return '';
    }
    const idToken = liff.getIDToken();
    if (!validIdToken(idToken)) throw new Error('LINE ID token missing or invalid.');
    return idToken;
  }

  async function linkAccount() {
    const companyId = validIdentifier(query.get('companyId'));
    const watchdogUserId = validIdentifier(query.get('watchdogUserId'));
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    const accessToken = await getWatchDogToken(watchdogUserId);
    setStatus('Linking...');
    const res = await fetch(apiBase + '/auth/line/link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + accessToken,
        ...(companyId ? { 'x-company-id': companyId } : {})
      },
      body: JSON.stringify({ idToken, ...(companyId ? { companyId } : {}) })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Link failed: ' + res.status));
    if (oaAddUrl) {
      setStatus('Linked. Opening LINE...');
      setTimeout(function () { location.href = oaAddUrl; }, 800);
    } else {
      setStatus('Linked. Send LINE OA a message now.', text);
    }
  }

  async function linkEmployee() {
    const linkToken = query.get('token') || '';
    if (!/^[A-Za-z0-9_-]{32}$/.test(linkToken)) throw new Error('Missing or invalid link token. Ask your admin for a new QR code.');
    if (!await initLiff()) return;
    removeQueryParam('token');
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('Linking...');
    const res = await fetch(apiBase + '/auth/line/employee-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: linkToken, idToken })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Link failed: ' + res.status));
    if (oaAddUrl) {
      setStatus('Linked. Opening LINE...');
      openLineEl.href = oaAddUrl;
      openLineEl.hidden = false;
      setTimeout(function () { location.href = oaAddUrl; }, 800);
    } else {
      setStatus('Linked. You can close this page and use LINE AI now.');
    }
  }

  async function registerCustomer() {
    const lineChannelId = validChannelId(query.get('lineChannelId'));
    const consentEl = document.getElementById('consent');
    if (!lineChannelId) throw new Error('Missing or invalid LINE channel.');
    if (!consentEl.checked) throw new Error('Consent is required.');
    if (!await initLiff()) return;
    const idToken = currentIdToken();
    if (!idToken) return;
    setStatus('Registering...');
    const res = await fetch(apiBase + '/auth/line/customer-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, lineChannelId, consent: true })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('Registration failed: ' + res.status));
    setStatus('Registered. You can close this page and continue in LINE.');
  }

  async function run() {
    actionBtn.disabled = true;
    try {
      if (mode === 'account') await linkAccount();
      else if (mode === 'employee') await linkEmployee();
      else if (mode === 'customer') await registerCustomer();
      else throw new Error('Invalid LIFF page mode.');
    } catch (error) {
      setStatus(mode === 'customer' ? 'Registration failed' : 'Link failed', error && error.message ? error.message : String(error));
      actionBtn.disabled = false;
    }
  }

  actionBtn.addEventListener('click', run);
  if (mode !== 'customer') void run();
})();
`;
