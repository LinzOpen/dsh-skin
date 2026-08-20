"use strict";
/**
 * 生成应用图标。
 *
 * 用 Electron 渲染一张 HTML 再截图，而不是提交一个二进制 PNG：图标就该跟着
 * 品牌色走，而品牌色写在 CSS 里。想改配色改这个文件重跑一次就行，
 * 不用找设计源文件 —— 那种文件在开源仓里十次有九次是丢的。
 *
 *     npx electron scripts/make-icon.js
 *
 * electron-builder 会从 app/build/icon.png 自动生成 mac 的 .icns 和 win 的 .ico，
 * 所以这里只产出一张 1024×1024 的 PNG。
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUT = path.join(__dirname, "..", "app", "build", "icon.png");
const SIZE = 1024;

const HTML = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  .tile{width:100%;height:100%;border-radius:${SIZE * 0.22}px;overflow:hidden;position:relative;
    background:
      radial-gradient(110% 85% at 16% 8%, #1d3b5a 0%, rgba(29,59,90,0) 58%),
      radial-gradient(85% 65% at 88% 96%, #16304f 0%, rgba(22,48,79,0) 66%),
      linear-gradient(168deg,#0f2033 0%,#0b1626 60%,#070f1c 100%);}
  /* 一道斜切：左半浅、右半深 —— 跟画廊里的色卡是同一个语言，
     "一套皮肤同时管明暗两面"这件事在图标上就说清楚了。 */
  .cut{position:absolute;inset:0;
    background:linear-gradient(118deg,#eef3fa 0 34%,#d9b56a 34% 39%,rgba(0,0,0,0) 39% 100%);}
  .mark{position:absolute;inset:0;display:grid;place-items:center;}
  .mark b{font:700 ${SIZE * 0.3}px/1 -apple-system,"Helvetica Neue",system-ui,sans-serif;
    color:#d9b56a;letter-spacing:-.04em;transform:translateX(${SIZE * 0.09}px)}
</style><div class="tile"><div class="cut"></div><div class="mark"><b>ds</b></div></div>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, image.toPNG());
  console.log(`${OUT}  ${image.getSize().width}×${image.getSize().height}`);
  app.exit(0);
});
