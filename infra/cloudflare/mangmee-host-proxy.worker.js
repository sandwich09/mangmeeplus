// Cloudflare Worker: proxy mangmeeplus.com -> ECS Express origin with the Host
// header the AWS gateway expects.
//
// Why this exists: the ECS Express public gateway routes by HTTP Host header and
// returns a bare 404 for any Host other than its own endpoint hostname. Cloudflare
// (proxied) forwards Host: mangmeeplus.com, so every request 404s. The clean fix is
// Origin Rules "Host Header override", but that is Enterprise-only on this account,
// so we rewrite the Host here on the Free plan.
//
// Route this Worker at mangmeeplus.com/* (and www.mangmeeplus.com/* if used). The
// public DNS record must stay Proxied so requests reach Cloudflare and trigger the
// route. Bump to Workers Paid ($5/mo, 10M req) if the 100k/day Free cap is hit.
const ORIGIN = 'wa-d522885832ce41a5aa7f8d1ffbaaa84b.ecs.ap-southeast-1.on.aws';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const publicHost = url.hostname; // mangmeeplus.com
    if (url.pathname === '/') {
      url.pathname = '/login';
      return Response.redirect(url.toString(), 302);
    }

    url.hostname = ORIGIN; // Host header follows the URL -> ECS endpoint
    url.protocol = 'https:';
    url.port = '';

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', publicHost);
    headers.set('X-Forwarded-Proto', 'https');

    const resp = await fetch(
      new Request(url, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      }),
    );

    // Rewrite any redirect that leaks the origin hostname back to the public host.
    const loc = resp.headers.get('Location');
    if (loc && loc.includes(ORIGIN)) {
      const out = new Response(resp.body, resp);
      out.headers.set('Location', loc.split(ORIGIN).join(publicHost));
      return out;
    }
    return resp;
  },
};
