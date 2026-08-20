"use strict";
/**
 * 外壳窗口：把任意一个网页（多半是本地跑着的 Web UI）装进一个能换皮肤的窗口。
 *
 * 这是整个程序里唯一"对别人的界面动手"的地方，所以边界写死在这里：
 *   · 只注入 CSS，从不注入脚本。皮肤是样式，不是代码。
 *   · 注入前必过检查器，有 error 就不注入 —— 而不是注入完再警告。
 *   · 每次切换先撤掉上一段 CSS 再插新的，且**排队执行**。
 *     并发切换会让上一套皮肤的 CSS 永久留在页面里（实测：亮色拿到了新配色
 *     却还铺着旧背景），因为两边各自读写"当前 key"，谁先谁后是不确定的。
 */
const { BrowserWindow, shell: electronShell } = require("electron");
const skins = require("./skins");

/** url -> BrowserWindow */
const windows = new Map();
/** 每个窗口一条队列。跨窗口不用共享队列 —— 它们互不影响。 */
const queues = new WeakMap();

function apply(win, skinId) {
  if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: "窗口已关闭" });
  const prev = queues.get(win) || Promise.resolve();
  const next = prev.then(() => applyNow(win, skinId)).catch((error) => ({ ok: false, error: error.message }));
  queues.set(win, next);
  return next;
}

async function applyNow(win, skinId) {
  const wc = win.webContents;
  if (wc.__skinKey) {
    try { await wc.removeInsertedCSS(wc.__skinKey); } catch { /* 页面可能已经跳走了 */ }
    wc.__skinKey = null;
  }
  if (!skinId || skinId === "none") return { ok: true, skin: "none" };

  const { css, report, skin } = skins.compile(skinId);
  if (!css) {
    return { ok: false, skin: skinId,
      error: report ? `检查未通过：${report.findings.filter((f) => f.severity === "error").map((f) => f.message).join("；")}`
                    : (skin?.error || "皮肤读不出来") };
  }
  wc.__skinKey = await wc.insertCSS(css);

  // 自检：读回真正生效的值。不做这一步，"皮肤到底挂上没有"只能靠肉眼，
  // 而挂不上的表现常常是"看起来只是颜色没变"。
  let probe = null;
  try {
    probe = await wc.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const mount = document.getElementById("app") || document.getElementById("root") || document.body;
      return { accent: cs.getPropertyValue("--color-accent").trim(),
               layers: (getComputedStyle(mount).backgroundImage.match(/url\\(|gradient\\(/g) || []).length,
               mount: mount.id || "body" };
    })()`);
  } catch { /* 页面禁止求值时不算失败 */ }
  return { ok: true, skin: skinId, warnings: report.warnings, probe };
}

function open(url, skinId, onClosed) {
  const existing = windows.get(url);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return existing; }

  const win = new BrowserWindow({
    width: 1280, height: 860, title: url, backgroundColor: "#10131c",
    webPreferences: {
      // 外壳装的是别人的页面。不开 nodeIntegration、开 contextIsolation、
      // 不给 preload —— 这个窗口里没有任何我们的 API 可以被页面碰到。
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  windows.set(url, win);
  win.webContents.on("did-finish-load", () => apply(win, skinId));
  // 页面里的外链交给系统浏览器，不在外壳里开新窗口 —— 那些窗口没有皮肤，也没人管。
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) electronShell.openExternal(target);
    return { action: "deny" };
  });
  win.on("closed", () => { windows.delete(url); onClosed?.(url); });
  win.loadURL(url);
  return win;
}

const all = () => [...windows.entries()].filter(([, w]) => !w.isDestroyed());
function applyAll(skinId) { return Promise.all(all().map(([, w]) => apply(w, skinId))); }

module.exports = { open, apply, applyAll, all, windows };
