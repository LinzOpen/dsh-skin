"use strict";
/**
 * 把本地图片导入成一套皮肤。
 *
 * 两个决定值得写下来：
 *
 * 1. 背景图**原样复制，不重编码**。重编码能省几百 KB，但换来的是立绘线稿被削钝 ——
 *    这些图往往是花时间或花钱产出的，几百 KB 换不来。只有缩略图重编码，因为它本来
 *    就是给人扫一眼用的。
 *
 * 2. 缩略图用 Electron 自带的 nativeImage，不调外部程序。原来这一步是调
 *    /usr/bin/python3 缩图的 —— 那等于把整个功能钉死在 macOS 上，Windows 用户
 *    连导入按钮都点不了。nativeImage 三个平台都在，且不用装任何东西。
 */
const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");
const { USER_SKINS, ensureUserDirs } = require("./paths");

const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const THUMB_WIDTH = 480;

/** 名字 → 合法皮肤 id。中文名取不出 ascii 时退回时间戳，不让它失败。 */
function slugify(name) {
  const slug = String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return /^[a-z0-9]/.test(slug) ? slug : `skin-${Date.now().toString(36)}`;
}

function uniqueDir(id) {
  let candidate = id;
  let n = 2;
  while (fs.existsSync(path.join(USER_SKINS, candidate))) candidate = `${id}-${n++}`;
  return candidate;
}

/**
 * 生成的皮肤 CSS。
 *
 * 遮罩为什么按"列"做，而不是整块压一层灰：
 *   背景铺开之后正文直接压在画面上，实测几乎读不了；但整块加回不透明底又把画面
 *   盖没了 —— 换皮肤等于没换。出路在构图：绝大多数竖构图的主体压在左边三分之一，
 *   右侧是留白。所以遮罩按列给：侧栏区和正文区淡淡压一层，主体那一段一点不遮。
 *   一条规则搞定，不碰任何子元素，也不依赖任何类名。
 *   想让主体靠右，把下面两个 0% / 17% / 30% 的位置对调即可。
 */
function skinCss(name, hasMultiple) {
  return `/* ${name} — 由「导入素材」生成
 *
 * 背景走 --dsh-backdrop 变量，${hasMultiple ? "宿主在轮播时只改这一个变量（重注整段样式会闪）" : "宿主套用时填入这套皮肤唯一的那张图"}。
 * 改配色请直接改下面的变量；换图请把文件丢进 assets/ 并改 skin.json 的 backdrops。
 */

:root {
  --color-bg: #10131c;
  --color-text: #e8ecf5;
  --color-accent: #7f9bff;

  /* 遮罩强度：0 = 完全不遮（图好看但字可能读不清），1 = 压死（字清楚但等于没换皮肤） */
  --dsh-veil: .72;
}

#app, #root {
  background-color: var(--color-bg);
  background-image:
    linear-gradient(to right,
      rgba(10, 14, 24, calc(var(--dsh-veil) * .92)) 0%,
      rgba(10, 14, 24, calc(var(--dsh-veil) * .78)) 11%,
      rgba(10, 14, 24, 0) 17%,
      rgba(10, 14, 24, 0) 30%,
      rgba(10, 14, 24, calc(var(--dsh-veil) * .95)) 40%,
      rgba(10, 14, 24, var(--dsh-veil)) 100%),
    var(--dsh-backdrop, none);
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

/* 只给真正承载文字的元素补底。钩标签名和 role，不钩类名 —— 类名会随宿主构建变。 */
#app :is(input, textarea, select), #root :is(input, textarea, select),
#app :is([role=dialog], [role=menu], [role=listbox], [role=tooltip]),
#root :is([role=dialog], [role=menu], [role=listbox], [role=tooltip]),
#app :is(pre, code), #root :is(pre, code) {
  background-color: rgba(16, 22, 36, .82);
}
`;
}

/**
 * @param {string[]} files 本地图片绝对路径
 * @param {{name?:string}} options
 * @returns {{ok:boolean, id?:string, dir?:string, count?:number, skipped?:string[], error?:string}}
 */
function importImages(files, options = {}) {
  const usable = files.filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()));
  const skipped = files.filter((f) => !usable.includes(f)).map((f) => path.basename(f));
  if (!usable.length) return { ok: false, error: "没有可用的图片（支持 png / jpg / webp / gif / bmp）", skipped };

  ensureUserDirs();
  const name = String(options.name || path.basename(usable[0], path.extname(usable[0]))).trim() || "我的皮肤";
  const id = uniqueDir(slugify(name));
  const dir = path.join(USER_SKINS, id);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const backdrops = [];
  const failed = [];
  usable.forEach((file, index) => {
    const ext = path.extname(file).toLowerCase();
    const target = `bg-${String(index + 1).padStart(2, "0")}${ext}`;
    try {
      fs.copyFileSync(file, path.join(dir, "assets", target));
      backdrops.push(`assets/${target}`);
    } catch (error) {
      failed.push(`${path.basename(file)}：${error.message}`);
    }
  });
  if (!backdrops.length) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, error: `一张也没复制成功：${failed[0] || "未知原因"}`, skipped };
  }

  // 缩略图取第一张。解不出来就不给缩略图 —— 界面会退回一个纯色卡片，不该因此整个失败。
  try {
    const image = nativeImage.createFromPath(path.join(dir, backdrops[0]));
    if (!image.isEmpty()) {
      fs.writeFileSync(path.join(dir, "thumb.png"),
        image.resize({ width: THUMB_WIDTH, quality: "good" }).toPNG());
    }
  } catch { /* 没有缩略图不是错误 */ }

  fs.writeFileSync(path.join(dir, "skin.json"), `${JSON.stringify({
    id, name, version: "1.0.0",
    tagline: backdrops.length > 1 ? `${backdrops.length} 张背景，可轮播` : "",
    author: "", license: "", tags: ["imported"], accent: "#7f9bff",
    appearance: "both", backdrops,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "skin.css"), skinCss(name, backdrops.length > 1));

  return { ok: true, id, dir, count: backdrops.length, skipped: [...skipped, ...failed] };
}

module.exports = { importImages, slugify, SUPPORTED };
