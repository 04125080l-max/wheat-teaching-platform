// 冬小麦教学平台 · Cloudflare Worker（静态资源缓存头控制 + 307 重定向保留 query）
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let res = await env.ASSETS.fetch(request);
    // clean_urls 会把 /xxx.html 307 到 /xxx 且丢失 query → 手动跟随并保留 query
    if ((res.status === 307 || res.status === 308) && url.search) {
      const loc = res.headers.get("Location");
      if (loc) {
        const target = new URL(loc, url.origin);
        target.search = url.search;
        res = await env.ASSETS.fetch(target);
      }
    }
    const headers = new Headers(res.headers);
    const p = url.pathname;
    if (/\/\.(?:assets|wheat|variety|disease)\//.test(p) || /\.(?:js|css|webp|png|jpg|jpeg|svg|ico|woff2|mp4|webmanifest)$/.test(p)) {
      headers.set("Cache-Control", "public, max-age=604800");
    } else {
      headers.set("Cache-Control", "public, max-age=120");
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
