"use strict";
/**
 * @dsh-skin/host —— 让一个 Electron 窗口能换皮肤。
 *
 *   // main.js，app ready 之前
 *   const { registerSkinScheme, createSkinHost } = require("@dsh-skin/host");
 *   registerSkinScheme();
 *
 *   // ready 之后
 *   const skins = createSkinHost({ roots: [path.join(__dirname, "skins")] });
 *   skins.install();                 // 装协议处理器
 *   skins.attach(win);               // 这个窗口跟着皮肤走
 *   await skins.apply("midnight-harbor");
 *
 * 三件事是这个包替你做掉的，每一件单独看都很小，漏掉任何一件都会以"皮肤看起来
 * 没生效"的形式表现出来，而且都很难查：
 *
 *   1. 协议必须在 app ready **之前**注册。晚一步不会报错，只会所有素材 404。
 *   2. 切换必须串行。并发切换会让上一套皮肤的 CSS 永久留在页面里 ——
 *      实测表现是"亮色拿到了新配色却还铺着旧背景"。
 *   3. 注入前必须过检查器。皮肤是别人写的、会进你用户界面的代码，
 *      而纯 CSS 也能外泄输入内容（见 @dsh-skin/core 的 remote-url 规则）。
 */

const fs = require("node:fs");
const path = require("node:path");
const core = require("@dsh-skin/core");

const DEFAULT_SCHEME = "dshskin";

/** 必须在 app ready 之前调用。 */
function registerSkinScheme(scheme = DEFAULT_SCHEME) {
  const { protocol } = require("electron");
  protocol.registerSchemesAsPrivileged([{
    scheme,
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
      // 宿主页面多半带 CSP；不放行的话素材会被自己的 CSP 挡掉。
      bypassCSP: true,
    },
  }]);
}

function realpath(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
/** 跟穿 symlink 之后仍必须在 root 内。不做这一步，assets -> / 就绕过去了。 */
function inside(root, target) {
  const r = realpath(root);
  const t = realpath(target);
  return t === r || t.startsWith(r + path.sep);
}

/**
 * @param {object} options
 * @param {string[]} options.roots      皮肤根目录，后面的覆盖前面的同 id
 * @param {string} [options.scheme]     自定义协议名，默认 dshskin
 * @param {boolean} [options.enforce]   true（默认）= 有 error 的皮肤拒绝注入
 */
function createSkinHost(options) {
  const roots = [].concat(options.roots || []);
  const scheme = options.scheme || DEFAULT_SCHEME;
  const enforce = options.enforce !== false;

  let cache = null;
  const list = () => (cache || (cache = core.scanLibrary(roots)));
  const refresh = () => { cache = null; return list(); };
  const find = (id) => list().find((s) => s.id === id) || null;
  const assetBase = (id) => `${scheme}://skin/${id}`;

  function install() {
    const { protocol, net } = require("electron");
    protocol.handle(scheme, (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "skin") return new Response("not found", { status: 404 });
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const slash = rel.indexOf("/");
      if (slash < 1) return new Response("bad request", { status: 400 });
      const skin = find(rel.slice(0, slash));
      if (!skin || skin.broken) return new Response("no such skin", { status: 404 });
      const asset = rel.slice(slash + 1).split("?")[0];
      for (const candidate of [path.join(skin.dir, skin.assets, asset), path.join(skin.dir, asset)]) {
        if (inside(skin.dir, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return net.fetch(`file://${encodeURI(candidate.split(path.sep).join("/"))}`);
        }
      }
      return new Response("not found", { status: 404 });
    });
  }

  /** 编译成可注入的 CSS。enforce 时有 error 就返回 null。 */
  function compile(id) {
    const skin = find(id);
    if (!skin || skin.broken) return { css: null, report: null, skin, error: skin?.error || "找不到这套皮肤" };
    const raw = fs.readFileSync(skin.cssFile, "utf8");
    const report = core.validateCss(raw, { dir: skin.dir, assetsDir: skin.assets });
    if (enforce && !report.ok) {
      return { css: null, report, skin,
        error: report.findings.filter((f) => f.severity === "error").map((f) => f.message).join("；") };
    }
    let css = core.resolveCss(raw, assetBase(id));
    if (skin.backdrops.length) {
      css += `\n:root { --dsh-backdrop: url("${assetBase(id)}/${skin.backdrops[0]}"); }\n`;
    }
    return { css, report, skin, error: "" };
  }

  const attached = new Set();
  const queues = new WeakMap();
  let current = null;

  function attach(win) {
    attached.add(win);
    win.on("closed", () => attached.delete(win));
    // 页面自己跳转或刷新之后注入会丢，所以每次加载完都重来一遍。
    win.webContents.on("did-finish-load", () => { if (current) applyTo(win, current); });
    if (current) applyTo(win, current);
    return win;
  }

  function applyTo(win, id) {
    if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: "窗口已关闭" });
    const prev = queues.get(win) || Promise.resolve();
    const next = prev.then(() => applyNow(win, id)).catch((e) => ({ ok: false, error: e.message }));
    queues.set(win, next);
    return next;
  }

  async function applyNow(win, id) {
    const wc = win.webContents;
    if (wc.__dshSkinKey) {
      try { await wc.removeInsertedCSS(wc.__dshSkinKey); } catch { /* 页面可能已跳走 */ }
      wc.__dshSkinKey = null;
    }
    if (!id || id === "none") return { ok: true, skin: "none" };
    const { css, error, report } = compile(id);
    if (!css) return { ok: false, skin: id, error };
    wc.__dshSkinKey = await wc.insertCSS(css);
    return { ok: true, skin: id, warnings: report ? report.warnings : 0 };
  }

  /** 套用到所有 attach 过的窗口，并记住选择（新 attach 的窗口会自动跟上）。 */
  async function apply(id) {
    current = id;
    const wins = [...attached].filter((w) => !w.isDestroyed());
    return Promise.all(wins.map((w) => applyTo(w, id)));
  }

  return { list, refresh, find, compile, install, attach, apply, applyTo,
           assetBase, get current() { return current; }, scheme };
}

module.exports = { registerSkinScheme, createSkinHost, DEFAULT_SCHEME };
