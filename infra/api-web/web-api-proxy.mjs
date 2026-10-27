import http from 'node:http';
import { pathToFileURL } from 'node:url';

const listenPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_PORT || 3001);
const webPort = Number(process.env.WEB_PORT || 3002);

export function parseMaintenanceMode(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('GLOBAL_MAINTENANCE_MODE must be exactly true or false');
}

export function resolveMaintenanceMode(globalValue, servingMode, isProduction) {
  const maintenance = parseMaintenanceMode(globalValue);
  if (servingMode === undefined || servingMode === '') {
    if (isProduction) {
      throw new Error('PRODUCTION_SERVING_MODE must be exactly maintenance_only or live');
    }
    return maintenance;
  }
  if (servingMode !== 'maintenance_only' && servingMode !== 'live') {
    throw new Error('PRODUCTION_SERVING_MODE must be exactly maintenance_only or live');
  }
  if (maintenance !== (servingMode === 'maintenance_only')) {
    throw new Error('GLOBAL_MAINTENANCE_MODE must match PRODUCTION_SERVING_MODE');
  }
  return maintenance;
}

const maintenanceMode = resolveMaintenanceMode(
  process.env.GLOBAL_MAINTENANCE_MODE,
  process.env.PRODUCTION_SERVING_MODE,
  process.env.NODE_ENV === 'production',
);
const maintenanceBypassPaths = new Set(['/v1/health', '/v1/internal/health/readiness']);
const maintenanceAuthPaths = new Set([
  '/v1/auth/platform-access',
  '/v1/auth/login-channels',
  '/v1/auth/password/login',
  '/v1/auth/session/refresh',
  '/v1/auth/password/change',
  '/v1/auth/logout',
  '/v1/auth/me',
]);
const maintenanceHtml = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>ระบบกำลังปรับปรุง | MangmeePlus</title>
  <style>
    :root{color-scheme:light;font-family:Outfit,"IBM Plex Sans Thai",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f8f5;color:#1a2e22}
    *{box-sizing:border-box}body{margin:0;min-height:100dvh;background:radial-gradient(circle at 15% 15%,rgba(134,239,172,.34),transparent 34rem),radial-gradient(circle at 88% 82%,rgba(252,211,77,.28),transparent 30rem),#f6f8f5}
    main{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:min(100%,640px);overflow:hidden;border:1px solid #e3ebe5;border-radius:24px;background:rgba(255,255,255,.96);box-shadow:0 24px 70px rgba(20,83,45,.12)}
    .bar{height:7px;background:linear-gradient(90deg,#16a34a,#22c55e 55%,#fcd34d)}.content{padding:clamp(28px,7vw,56px);text-align:center}.mark{display:grid;place-items:center;width:82px;height:82px;margin:0 auto 22px;border:1px solid #dcfce7;border-radius:24px;background:#f0fdf4;box-shadow:0 10px 26px rgba(21,128,61,.12)}
    .brand{margin:0 0 28px;color:#166534;font-size:18px;font-weight:800;letter-spacing:.01em}.brand b{color:#d97706}.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;padding:7px 13px;border-radius:999px;background:#ecfdf3;color:#15803d;font-size:13px;font-weight:750}.dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.14)}
    h1{margin:0;color:#101828;font-size:clamp(30px,7vw,46px);line-height:1.18;letter-spacing:-.025em}p{margin:16px auto 0;max-width:470px;color:#475467;font-size:16px;line-height:1.8}.note,.privacy{margin-top:28px;padding:14px 18px;border-radius:14px;font-size:14px;line-height:1.65}.note{border:1px solid #fef3c7;background:#fffaeb;color:#92400e}.privacy{border:1px solid #dcfce7;background:#f0fdf4;color:#344054;text-align:left}.privacy strong{color:#166534}.privacy a{color:#166534;font-weight:700}
    footer{padding:18px 24px;border-top:1px solid #edf1ed;background:#fcfcfd;color:#667085;text-align:center;font-size:12px}footer a{color:#166534;font-weight:700;text-decoration:none}footer a:hover{text-decoration:underline}@media(max-width:520px){main{padding:14px}.card{border-radius:20px}.content{padding:30px 22px}.mark{width:72px;height:72px;border-radius:20px}}
  </style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="maintenance-title">
      <div class="bar" aria-hidden="true"></div>
      <div class="content">
        <div class="mark" aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none"><path d="M24 23c0-6 0-9 0-12" stroke="#FCD34D" stroke-width="2.6" stroke-linecap="round"/><path d="M24 15c-1.6-3-4.4-4-7.6-3.6.4 3.4 3.2 4.8 6 4.6" fill="#86EFAC"/><path d="M24 13c1.6-2.6 4.2-3.4 7-3-.3 3-2.8 4.2-5.4 4" fill="#BBF7D0"/><circle cx="24" cy="31" r="11" fill="#FCD34D" stroke="#FBBF24" stroke-width="1.5"/><path d="M24 26v10M22 28h3.2a2 2 0 0 1 0 4H22m0 0h3.6a2 2 0 0 1 0 4H22" stroke="#B45309" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <p class="brand">มั่ง<b>มี</b> · MangmeePlus</p>
        <p class="eyebrow"><span class="dot" aria-hidden="true"></span>กำลังเตรียมระบบ</p>
        <h1 id="maintenance-title">ระบบกำลังปรับปรุง</h1>
        <p>เรากำลังเตรียม MangmeePlus ให้พร้อมและมั่นคงยิ่งขึ้น ขณะนี้ยังไม่เปิดให้เข้าสู่ระบบ กรุณากลับมาใหม่อีกครั้ง</p>
        <div class="note" role="status">ระหว่างปิดปรับปรุง เนื้อหาคำขอที่ส่งผ่าน MangmeePlus หรือช่องทางเชื่อมต่อ LINE จะถูกทิ้งโดยไม่นำเข้าหรือจัดเก็บในระบบงาน กรุณาอย่าส่งข้อมูล เอกสาร หรือข้อความจนกว่าจะประกาศเปิดใช้งาน</div>
        <div class="privacy" role="note"><strong>ความเป็นส่วนตัวระหว่างปิดปรับปรุง</strong><br>เมื่อคุณเข้าหน้านี้ บริษัท มั่งมียั่งยืน จำกัด และผู้ให้บริการโครงสร้างพื้นฐานอาจบันทึกหมายเลขไอพี (IP Address) วันเวลา และข้อมูลเบราว์เซอร์ (User-Agent) ในบันทึกความปลอดภัย เพื่อรักษาความมั่นคงปลอดภัย ป้องกันเหตุผิดปกติ และปฏิบัติตามกฎหมาย โดยเก็บไว้ตามระยะเวลาที่กฎหมายกำหนดและเท่าที่จำเป็น คุณขอเข้าถึง แก้ไข ลบ คัดค้าน หรือใช้สิทธิอื่นตามกฎหมายได้ที่ <a href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a></div>
      </div>
      <footer>บริษัท มั่งมียั่งยืน จำกัด · ติดต่อ <a href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a></footer>
    </section>
  </main>
</body>
</html>`;

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
    || pathname === '/v1' || pathname.startsWith('/v1/')
    || pathname === '/local-storage' || pathname.startsWith('/local-storage/');
}

export function mayBypassMaintenance(method, url) {
  const parsed = new URL(url, 'http://localhost');
  return (method === 'GET' || method === 'HEAD') && maintenanceBypassPaths.has(parsed.pathname);
}

export function mayForwardMaintenance(method, url) {
  if (String(url).startsWith('//')) return false;
  const pathname = new URL(url, 'http://localhost').pathname;
  if (!isApiPath(pathname)) return method === 'GET' || method === 'HEAD';
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return true;
  const apiPath = pathname.startsWith('/api/v1/') ? pathname.slice(4) : pathname;
  return maintenanceAuthPaths.has(apiPath)
    || apiPath === '/v1/system'
    || apiPath.startsWith('/v1/system/');
}

function upstreamHeaders(headers, markMaintenance) {
  if (!markMaintenance) return headers;
  return {
    ...headers,
    'cache-control': 'no-store, max-age=0',
    'x-mangmee-maintenance': 'active',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  };
}

function renderMaintenance(req, res, pathname) {
  const apiResponse = isApiPath(pathname) || (req.method !== 'GET' && req.method !== 'HEAD');
  const body = apiResponse
    ? JSON.stringify({ statusCode: 200, code: 'global_maintenance', message: 'Service temporarily unavailable.' })
    : maintenanceHtml;
  res.writeHead(200, {
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(body),
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'content-type': apiResponse ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-mangmee-maintenance': 'active',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  });
  req.resume();
  res.end(req.method === 'HEAD' ? undefined : body);
}

function targetFor(url) {
  const parsed = new URL(url, 'http://localhost');
  // Session and Halloween draw handlers live in Next.js; other API routes stay below.
  if (parsed.pathname === '/api/auth' || parsed.pathname.startsWith('/api/auth/')
    || parsed.pathname === '/api/public/halloween/draw') {
    return { port: webPort, path: `${parsed.pathname}${parsed.search}` };
  }
  if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
    parsed.pathname = parsed.pathname.slice(4) || '/';
    return { port: apiPort, path: `${parsed.pathname}${parsed.search}` };
  }
  if (parsed.pathname === '/v1' || parsed.pathname.startsWith('/v1/') || parsed.pathname.startsWith('/local-storage/')) {
    return { port: apiPort, path: `${parsed.pathname}${parsed.search}` };
  }
  return { port: webPort, path: `${parsed.pathname}${parsed.search}` };
}

export function shouldRenderWebNotFound(method, accept, statusCode) {
  return (method === 'GET' || method === 'HEAD') && statusCode === 404 && accept.includes('text/html');
}

export const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', 'http://localhost');
  const maintenanceBypass = mayBypassMaintenance(req.method || 'GET', parsed.href);
  if (maintenanceMode
    && !maintenanceBypass
    && !mayForwardMaintenance(req.method || 'GET', req.url || '/')) {
    renderMaintenance(req, res, parsed.pathname);
    return;
  }
  const markMaintenance = maintenanceMode && !maintenanceBypass;
  const target = targetFor(req.url || '/');
  // Preserve the public host/proto for upstream URL building (publicApiBase reads x-forwarded-*).
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${target.port}`,
    'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host || '',
    'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'https',
  };
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: target.port,
      path: target.path,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      // Keep JSON 404s for API clients, but browser navigations should use the branded Next page.
      if (target.port === apiPort && shouldRenderWebNotFound(req.method || 'GET', String(req.headers.accept || ''), upstreamRes.statusCode)) {
        upstreamRes.resume();
        const webRequest = http.request(
          {
            hostname: '127.0.0.1',
            port: webPort,
            path: target.path,
            method: req.method,
            headers: { ...headers, host: `127.0.0.1:${webPort}` },
          },
          (webRes) => {
            res.writeHead(webRes.statusCode || 502, upstreamHeaders(webRes.headers, markMaintenance));
            webRes.pipe(res);
          },
        );
        webRequest.on('error', () => {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Upstream unavailable');
        });
        webRequest.end();
        return;
      }
      res.writeHead(upstreamRes.statusCode || 502, upstreamHeaders(upstreamRes.headers, markMaintenance));
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Upstream unavailable');
  });

  req.pipe(upstream);
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`web-api-proxy listening on :${listenPort}`);
  });
}
