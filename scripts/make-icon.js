"use strict";
/**
 * 生成应用图标。
 *
 * 用 Electron 离屏画一张 Canvas 再截图，而不是提交一个二进制 PNG：图标跟着
 * 品牌色走，改配色改这个文件重跑一次就行，不用找设计源文件 —— 那种文件在开源仓
 * 里十次有九次是丢的。
 *
 *     npx electron scripts/make-icon.js
 *
 * electron-builder 从 app/build/icon.png 自动生成 mac 的 .icns 和 win 的 .ico，
 * 所以这里只产出一张 1024×1024 的 PNG。
 *
 * 图案是一枚原创徽章：深蓝底、金色刻度环、盾牌里托着一颗守护之星 ——
 * 「guard」的意象，蓝金配色，刻意不去照搬任何现成品牌的标记，
 * 一个安全工具带着别人的 logo 只会显得可疑。
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUT = path.join(__dirname, "..", "app", "build", "icon.png");
const SIZE = 1024;

const HTML = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  canvas{display:block}
</style><canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script>
const S = ${SIZE};
const ctx = document.getElementById("c").getContext("2d");
const cx = S/2, cy = S/2;
const TAU = Math.PI * 2;

const NAVY_HI = "#25507a", NAVY = "#12294a", NAVY_LO = "#070f1c";
const GOLD = "#d9b56a", GOLD_HI = "#f0dca8", GOLD_LO = "#a9823c";
const PALE = "#eaf2fb";

// macOS 圆角方板：图案本身是圆徽章，衬在一块深色圆角底上
function roundRect(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

// 底板
const pad = S*0.085;
const plate = ctx.createLinearGradient(0, pad, 0, S-pad);
plate.addColorStop(0, "#152a44");
plate.addColorStop(0.55, "#0d1a2e");
plate.addColorStop(1, "#070f1c");
roundRect(pad, pad, S-2*pad, S-2*pad, S*0.225);
ctx.fillStyle = plate;
ctx.fill();

// 徽章主体的中心与半径
const R = S*0.335;

// 外发光的深蓝圆盘
const disk = ctx.createRadialGradient(cx, cy - R*0.3, R*0.2, cx, cy, R*1.05);
disk.addColorStop(0, NAVY_HI);
disk.addColorStop(0.6, NAVY);
disk.addColorStop(1, NAVY_LO);
ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = disk; ctx.fill();

// 金色双环
function ring(r, w, grad){
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = w; ctx.strokeStyle = grad; ctx.stroke();
}
const goldGrad = ctx.createLinearGradient(cx-R, cy-R, cx+R, cy+R);
goldGrad.addColorStop(0, GOLD_HI);
goldGrad.addColorStop(0.5, GOLD);
goldGrad.addColorStop(1, GOLD_LO);
ring(R, S*0.012, goldGrad);
ring(R*0.865, S*0.006, goldGrad);

// 刻度环（星盘感）—— 结构性的，不是装饰堆砌
ctx.strokeStyle = goldGrad;
for (let i = 0; i < 60; i++){
  const a = (i/60)*TAU - Math.PI/2;
  const major = i % 5 === 0;
  const r1 = R*0.905, r2 = R*(major ? 0.845 : 0.875);
  ctx.lineWidth = major ? S*0.006 : S*0.003;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a)*r1, cy + Math.sin(a)*r1);
  ctx.lineTo(cx + Math.cos(a)*r2, cy + Math.sin(a)*r2);
  ctx.stroke();
}

// 盾牌
const sw = R*0.62, sh = R*1.02, sy = cy - R*0.5;
function shieldPath(scale){
  const w = sw*scale, h = sh*scale, top = cy - h*0.46;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + w*0.5, top + h*0.14);
  ctx.lineTo(cx + w*0.5, top + h*0.5);
  ctx.quadraticCurveTo(cx + w*0.5, top + h*0.86, cx, top + h);
  ctx.quadraticCurveTo(cx - w*0.5, top + h*0.86, cx - w*0.5, top + h*0.5);
  ctx.lineTo(cx - w*0.5, top + h*0.14);
  ctx.closePath();
}
// 盾牌底
shieldPath(1);
const shieldFill = ctx.createLinearGradient(cx, cy-R*0.5, cx, cy+R*0.5);
shieldFill.addColorStop(0, "#1b3557");
shieldFill.addColorStop(1, "#0a1a30");
ctx.fillStyle = shieldFill;
ctx.fill();
// 盾牌金边
shieldPath(1);
ctx.lineWidth = S*0.009; ctx.strokeStyle = goldGrad; ctx.stroke();

// 守护之星（四角星 + 细长芒）
function star(r, spikes, inner, rot){
  ctx.beginPath();
  for (let i = 0; i < spikes*2; i++){
    const rad = i % 2 === 0 ? r : r*inner;
    const a = (i/(spikes*2))*TAU - Math.PI/2 + rot;
    const x = cx + Math.cos(a)*rad, y = (cy - R*0.08) + Math.sin(a)*rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}
// 星芒光晕
const glow = ctx.createRadialGradient(cx, cy-R*0.08, 2, cx, cy-R*0.08, R*0.5);
glow.addColorStop(0, "rgba(240,220,168,0.55)");
glow.addColorStop(1, "rgba(240,220,168,0)");
ctx.beginPath(); ctx.arc(cx, cy-R*0.08, R*0.5, 0, TAU); ctx.fillStyle = glow; ctx.fill();
// 主星
star(R*0.4, 4, 0.18, 0);
const starFill = ctx.createLinearGradient(cx, cy-R*0.45, cx, cy+R*0.3);
starFill.addColorStop(0, PALE);
starFill.addColorStop(1, GOLD);
ctx.fillStyle = starFill; ctx.fill();
// 副星（斜 45°，细）
star(R*0.28, 4, 0.10, Math.PI/4);
ctx.fillStyle = "rgba(234,242,251,0.85)"; ctx.fill();

// 顶部星形尖顶（对应参考里环上那颗星）
function finial(fx, fy, r){
  ctx.beginPath();
  for (let i = 0; i < 8; i++){
    const rad = i % 2 === 0 ? r : r*0.42;
    const a = (i/8)*TAU - Math.PI/2;
    const x = fx + Math.cos(a)*rad, y = fy + Math.sin(a)*rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}
ctx.beginPath(); ctx.arc(cx, cy - R, R*0.14, 0, TAU);
ctx.fillStyle = NAVY_LO; ctx.fill();
ctx.lineWidth = S*0.008; ctx.strokeStyle = goldGrad; ctx.stroke();
finial(cx, cy - R, R*0.1);
ctx.fillStyle = GOLD_HI; ctx.fill();
</script>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  await new Promise((r) => setTimeout(r, 700));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, image.toPNG());
  console.log(`${OUT}  ${image.getSize().width}×${image.getSize().height}`);
  app.exit(0);
});
