/* 页面内的"攻击者服务器"。
 *
 * 为什么需要它：GitHub Pages 是纯静态的，collect/?... 会 404，而浏览器会把 404
 * 负缓存，同一个 URL 第二次就不再请求 —— 攻击只能演示一次。真实攻击者的服务器
 * 返回唯一的 200，不会遇到这件事。这个 Service Worker 就地扮演那台服务器：
 * 拦下 collect/ 请求，回一个不缓存的 1x1 透明 gif。
 *
 * 它只拦 collect/，别的一律放行。不存储、不上报、不联网 —— 它存在的唯一目的，
 * 是让"浏览器确实为每个前缀发出了一个真实请求"这件事在静态托管下也成立。
 */
const PIXEL = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes("/collect")) return;
  // 广播给所有受控页面：SW **确实收到了**这个请求 —— 也就是浏览器确实发了。
  // 这是页面的真相来源。用它而不是 Resource Timing，是因为被 SW 应答的请求
  // 不进页面的 resource timing，而这个攻击的整个要点就是"请求真的发出去了"。
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll();
    for (const client of clients) client.postMessage({ type: "collect", query: url.search.slice(1) });
  })());
  event.respondWith(new Response(PIXEL, {
    status: 200,
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  }));
});
