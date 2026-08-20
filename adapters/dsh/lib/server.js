/**
 * 皮肤素材服务。
 *
 * 为什么 DSH 这条路必须走 http，而 Electron 宿主可以走自定义协议：
 * DSH 这个构建给每个插件只开一条静态路由 —— `/plugins/<pkg>/client.js`，
 * 挂载目录下的其它路径一律 404，而渲染进程又拒绝 file://。
 * 于是浏览器那半只能通过 http 拿到图。
 *
 * 为什么服务住在插件里而不是一个独立进程：独立进程要用户记着启动，
 * 第一次忘了启动的表现是"挑选器还能用、但一张背景都没有" —— 读起来像皮肤坏了。
 * 放进插件之后，装插件就是全部安装步骤，而且它跟着宿主一起死，不会活得比宿主久。
 *
 * 这个文件不依赖 DSH，可以单独跑、单独测。
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { scanLibrary, validateCss, resolveCss } from "@linzopen/css-guard";

const TYPES = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

/** 跟穿 symlink；取不到就退回 resolve（文件不存在时 realpath 会抛）。 */
const realOrResolve = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/**
 * @param {object} options
 * @param {string[]} options.roots  皮肤根目录
 * @param {number} [options.port]   默认 3099
 * @param {string} [options.host]   默认 127.0.0.1 —— 只监听回环，绝不对外
 */
export function createAssetServer({ roots, port = 3099, host = "127.0.0.1" }) {
  let cache = null;
  const list = () => (cache || (cache = scanLibrary(roots)));
  const refresh = () => { cache = null; return list(); };
  const find = (id) => list().find((s) => s.id === id) || null;
  const base = `http://${host}:${port}`;

  /** 目录：只给浏览器那半需要的字段，路径一律换成这台服务的绝对 URL。 */
  const catalog = () => list().filter((s) => !s.broken).map((s) => ({
    id: s.id, name: s.name, tagline: s.tagline, tags: s.tags, accent: s.accent,
    appearance: s.appearance, swatch: s.swatch || null,
    preview: s.preview ? `${base}/skin/${s.id}/${encodeURIComponent(s.preview)}` : null,
    css: `${base}/css/${s.id}`,
  }));

  /** 一套皮肤的可注入 CSS。带 error 的一律 409 —— 服务端就拦掉，不指望浏览器那半自觉。 */
  function css(id) {
    const skin = find(id);
    if (!skin || skin.broken) return { status: 404, body: `/* no such skin: ${id} */` };
    const raw = readFileSync(skin.cssFile, "utf8");
    const report = validateCss(raw, { dir: skin.dir, assetsDir: skin.assets });
    if (!report.ok) {
      const why = report.findings.filter((f) => f.severity === "error")
        .map((f) => `L${f.line} ${f.rule}: ${f.message}`).join("\n   ");
      return { status: 409, body: `/* css-guard 拒绝提供这套皮肤：\n   ${why}\n*/` };
    }
    let out = resolveCss(raw, `${base}/skin/${skin.id}`);
    if (skin.backdrops.length) out += `\n:root{--skin-backdrop:url("${base}/skin/${skin.id}/${skin.backdrops[0]}")}\n`;
    return { status: 200, body: out };
  }

  /** 素材。解析后的真实路径必须仍在这套皮肤目录内。 */
  function assetPath(id, rel) {
    const skin = find(id);
    if (!skin || skin.broken) return null;
    const root = realOrResolve(skin.dir);
    for (const candidate of [join(skin.dir, skin.assets, rel), join(skin.dir, rel)]) {
      const real = realOrResolve(candidate);
      if ((real === root || real.startsWith(root + sep)) && existsSync(real) && statSync(real).isFile()) return real;
    }
    return null;
  }

  const server = createServer((req, res) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
      res.end(body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") { send(405, "method not allowed"); return; }

    const url = new URL(req.url, base);
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);

    if (parts[0] === "catalog.json") { send(200, JSON.stringify(catalog()), TYPES[".json"]); return; }
    if (parts[0] === "css" && parts[1]) { const r = css(parts[1]); send(r.status, r.body, TYPES[".css"]); return; }
    if (parts[0] === "skin" && parts.length >= 3) {
      const file = assetPath(parts[1], parts.slice(2).join("/"));
      if (!file) { send(404, "not found"); return; }
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": statSync(file).size,
        "Access-Control-Allow-Origin": "*",
        // 同一路径下的素材永远不变。不缓存的话每次换背景都要重新拉一遍几 MB 的图，
        // 表现就是"切换卡了一下"。
        "Cache-Control": "public, max-age=86400, immutable",
      });
      if (req.method === "HEAD") { res.end(); return; }
      createReadStream(file).pipe(res);
      return;
    }
    send(404, "not found");
  });

  return {
    server, list, refresh, find, catalog, css, assetPath, base,
    listen: () => new Promise((done, fail) => {
      server.once("error", fail);
      server.listen(port, host, () => done(base));
    }),
    close: () => new Promise((done) => server.close(done)),
  };
}
