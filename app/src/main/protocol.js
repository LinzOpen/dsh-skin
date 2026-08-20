"use strict";
/**
 * cssguard:// —— App 自己的取图协议。
 *
 * 为什么不用 file://：渲染进程对 file:// 有一堆限制（远程页面里根本加载不到），
 * 而外壳模式恰恰要把本地素材铺进一个 http(s) 页面。为什么不起一个本地 http 服务：
 * 那是一个会被同机任何进程访问到的端口，为了几张背景图开一个监听不值得。
 *
 * 两条路由：
 *   cssguard://app/<file>        渲染进程自己的页面（工作室 + 预览沙盒）
 *   cssguard://skin/<id>/<path>  某套皮肤的素材
 *
 * 安全：皮肤素材只在"这套皮肤自己的目录"里找，且解析后的真实路径必须仍在目录内。
 * 不做这一步，一个 url("__SKIN__/../../../.ssh/id_ed25519") 就能把私钥读成背景图。
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { protocol, net } = require("electron");
const skins = require("./skins");

const SCHEME = "cssguard";
const RENDERER = path.join(__dirname, "..", "renderer");

/** 必须在 app ready 之前调用。 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: {
      standard: true,        // 有正常的 origin，iframe 才能跟父页面同源
      secure: true,          // 算安全上下文，否则 fetch / module 都用不了
      supportFetchAPI: true,
      corsEnabled: true,
      // 外壳模式要把素材铺进别人的页面，那些页面多半有 CSP。
      bypassCSP: true,
    },
  }]);
}

/** 解析后的路径必须还在 root 里面。symlink 也要跟穿，否则 assets -> / 就绕过去了。 */
function inside(root, target) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const r = real(root);
  const t = real(target);
  return t === r || t.startsWith(r + path.sep);
}

function serve(file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response("not found", { status: 404 });
  }
  // pathToFileURL，不是手拼 file:// + encodeURI。
  // encodeURI **不转义 #**，所以一个叫 "a #1 b.png" 的素材会被解析成
  // 路径 "a%20" + 片段 "#1%20b.png" —— 图静默 404，而用户从相册导出的文件
  // 名里带 # 是很常见的。它同时也处理好 Windows 的盘符和空格。
  return net.fetch(pathToFileURL(file).href);
}

function handle(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");

  if (url.hostname === "app") {
    const file = path.join(RENDERER, rel || "index.html");
    return inside(RENDERER, file) ? serve(file) : new Response("forbidden", { status: 403 });
  }

  if (url.hostname === "skin") {
    const slash = rel.indexOf("/");
    if (slash < 1) return new Response("bad request", { status: 400 });
    const skin = skins.find(rel.slice(0, slash));
    if (!skin || skin.broken) return new Response("no such skin", { status: 404 });
    const asset = rel.slice(slash + 1).split("?")[0];
    // assets/ 优先，再退回皮肤根 —— 社区里两种放法都有。
    for (const candidate of [path.join(skin.dir, skin.assets, asset), path.join(skin.dir, asset)]) {
      if (inside(skin.dir, candidate) && fs.existsSync(candidate)) return serve(candidate);
    }
    return new Response("not found", { status: 404 });
  }

  return new Response("not found", { status: 404 });
}

function install() { protocol.handle(SCHEME, handle); }

module.exports = { SCHEME, registerScheme, install, RENDERER };
