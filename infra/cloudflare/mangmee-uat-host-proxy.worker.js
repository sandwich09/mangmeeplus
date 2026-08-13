// Cloudflare Worker: proxy uat.mangmeeplus.com to the isolated UAT ECS origin
// while preserving the public hostname for redirects and application identity.
const ORIGIN = 'wa-6ec8b40da38e4baaa1441b1844801d72.ecs.ap-southeast-1.on.aws';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const publicHost = url.hostname;
    if (url.pathname === '/') {
      url.pathname = '/login';
      return Response.redirect(url.toString(), 302);
    }

    url.hostname = ORIGIN;
    url.protocol = 'https:';
    url.port = '';

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', publicHost);
    headers.set('X-Forwarded-Proto', 'https');

    const response = await fetch(
      new Request(url, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      }),
    );

    const location = response.headers.get('Location');
    if (location && location.includes(ORIGIN)) {
      const output = new Response(response.body, response);
      output.headers.set('Location', location.split(ORIGIN).join(publicHost));
      return output;
    }
    return response;
  },
};
