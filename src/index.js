// 冬小麦教学平台 · Cloudflare Worker（静态资源缓存头控制）
// 仅改写响应头，不影响任何业务逻辑/静态内容
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    const p = url.pathname;
    // 静态资源：7 天浏览器缓存（assets/wheat/variety/disease + 常见扩展名）
    if (/\/\.(?:assets|wheat|variety|disease)\//.test(p) || /\.(?:js|css|webp|png|jpg|jpeg|svg|ico|woff2|mp4|webmanifest)$/.test(p)) {
      headers.set("Cache-Control", "public, max-age=604800");
    } else {
      // HTML/导航：2 分钟缓存（切换页面后内容可较快更新）
      headers.set("Cache-Control", "public, max-age=120");
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
