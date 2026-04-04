export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      const asset = new Request(new URL("/landing.html", url), request);
      const response = await env.ASSETS.fetch(asset);
      return withHtmlCacheHeaders(response);
    }

    return env.ASSETS.fetch(request);
  },
};

function withHtmlCacheHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
