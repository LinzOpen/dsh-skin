#!/usr/bin/env node
"use strict";
/**
 * 从 palette.json 生成 skin.css。
 *
 * 为什么要生成，而不是直接手写 CSS：
 *   宿主（DSH / Kimi Code 这一类）认的是一整套变量名 —— 光是表面色就有
 *   surface / raised / overlay / sunken / deep 五级。手写一套皮肤要填五十来个值，
 *   六套就是三百个，抄错一个就是"某个弹窗在深色下白底白字"，而且要等用户点到
 *   那个弹窗才发现。调色板只有十个颜色，五十个变量是从它算出来的。
 *
 * 为什么生成物照样提交进仓库：
 *   一套皮肤必须是**自包含**的 —— 别人下载一个 zip 解压就能用，不该要求他先装
 *   Node 再跑构建。所以 palette.json 是源、skin.css 是产物，两个都进仓库，
 *   CI 负责盯着它们不许分叉（scripts/check-repo.js）。
 *
 * 用法： node scripts/build-skins.js [--check]
 */

const fs = require("node:fs");
const path = require("node:path");

const SKINS_DIR = path.join(__dirname, "..", "skins");

/* ── 颜色小工具：只处理 #rgb / #rrggbb，够用且不引依赖 ───────────────── */

function hexToRgb(hex) {
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`不是合法颜色：${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };
/** 往 to 方向挪 amount（0-1）。用来从底色推出"更高一层"和"更沉一层"的表面色。 */
function mix(hex, to, amount) {
  const a = hexToRgb(hex); const b = hexToRgb(to);
  const out = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 一个色板 → 一整套宿主变量。
 * 变量名取自 DSH / Kimi Code 实际在用的那一套；宿主不认识的变量会被忽略，
 * 所以多写不出错，少写才会出"某一处没跟着变"。
 */
function variables(p, isDark) {
  // 三个方向，别混用 —— 混用过一次，结果是浅色模式下「抬高一层」的表面反而更暗，
  // 而且把色相洗成了灰（#ffffff 往黑挪出来的一定是中性灰）。
  const lift = "#ffffff";                        // 表面抬高：永远往白挪
  const sink = "#000000";                        // 表面压低：永远往黑挪
  const ink = isDark ? "#ffffff" : "#000000";    // 文字/强调加重：往背景的反方向挪
  const surface = p.surface || mix(p.bg, lift, isDark ? 0.06 : 0.6);

  return {
    "--color-bg": p.bg,
    "--bg": rgba(p.bg, 0.35),
    "--canvas": rgba(p.bg, 0.55),

    "--color-surface": rgba(surface, isDark ? 0.74 : 0.78),
    "--color-surface-raised": rgba(mix(surface, lift, isDark ? 0.10 : 0.4), isDark ? 0.86 : 0.92),
    "--color-surface-overlay": rgba(mix(surface, lift, isDark ? 0.14 : 0.6), 0.97),
    "--color-surface-sunken": rgba(mix(surface, sink, isDark ? 0.18 : 0.06), isDark ? 0.78 : 0.7),
    "--color-surface-deep": rgba(mix(surface, sink, isDark ? 0.26 : 0.1), isDark ? 0.7 : 0.65),
    "--color-sidebar-bg": rgba(p.bg, 0.42),
    "--color-sidebar-tint": rgba(p.accent, 0.10),
    "--panel": rgba(surface, isDark ? 0.74 : 0.78),
    "--panel2": rgba(p.accent, 0.09),
    "--color-well": rgba(mix(surface, sink, isDark ? 0.2 : 0.07), 0.7),
    "--color-menu-bg": rgba(mix(surface, lift, isDark ? 0.12 : 0.5), 0.97),
    "--color-composer-bg": rgba(mix(surface, lift, isDark ? 0.08 : 0.35), 0.92),
    "--color-user-bubble-bg": rgba(mix(p.accent, p.bg, isDark ? 0.72 : 0.84), 0.9),

    "--color-text": p.text,
    "--color-text-strong": mix(p.text, ink, 0.25),
    "--color-text-muted": rgba(p.text, 0.68),
    "--color-text-faint": rgba(p.text, 0.42),
    "--dim": rgba(p.text, 0.68),
    "--muted": rgba(p.text, 0.5),
    "--faint": rgba(p.text, 0.32),

    "--color-accent": p.accent,
    "--blue": p.accent,
    "--logo": p.logo || p.accent,
    "--color-accent-hover": mix(p.accent, ink, 0.18),
    "--blue2": mix(p.accent, ink, 0.18),
    "--color-accent-soft": rgba(p.accent, 0.16),
    "--soft": rgba(p.accent, 0.16),
    "--bluebg": rgba(p.accent, 0.14),
    "--color-accent-bd": rgba(p.accent, 0.45),
    "--bd": rgba(p.accent, 0.45),
    "--blueln": rgba(p.accent, 0.4),

    "--color-line": rgba(p.line || p.text, isDark ? 0.16 : 0.14),
    "--color-line-strong": rgba(p.line || p.text, isDark ? 0.3 : 0.26),
    "--color-composer-line": rgba(p.accent, 0.5),
    "--color-composer-focus-line": p.accent,
    "--color-hover": rgba(p.accent, 0.12),
    "--color-selected": rgba(p.accent, 0.2),
    "--color-subtle": rgba(p.accent, 0.08),
    "--color-send-bg": p.accent,
    "--color-send-bg-hover": mix(p.accent, ink, 0.18),
    "--color-send-icon": isDark ? p.bg : "#ffffff",
    "--color-inline-code-bg": rgba(p.accent, 0.12),
    "--p-selection": rgba(p.accent, 0.28),
  };
}

const block = (selector, vars, indent = "  ") =>
  `${selector} {\n${Object.entries(vars).map(([k, v]) => `${indent}${k}: ${v};`).join("\n")}\n}`;

/* 深色模式的宿主写法不统一：DSH 用 html[data-color-scheme=dark]，
   别的用 :root[data-theme=dark] 或 .dark。全写上，命中哪个算哪个。 */
const DARK_SELECTORS = [
  'html[data-color-scheme="dark"]',
  ':root[data-theme="dark"]',
  "html.dark",
  "body.dark",
];
const LIGHT_SELECTORS = [":root", 'html[data-color-scheme="light"]', 'html[data-color-scheme="system"]'];
const MOUNTS = ["#app", "#root"];

function render(meta, palette) {
  const light = palette.light;
  const dark = palette.dark;
  const head = `/* ${meta.name}${meta.tagline ? ` — ${meta.tagline}` : ""}
 *
 * 由 palette.json 生成，别直接改这个文件：改 palette.json，然后
 *     npm run build:skins
 *
 * 这套皮肤只做三件事：覆盖 :root 上的颜色变量、给 #app / #root 铺一层
 * 纯 CSS 的背景、把输入框和弹窗的底色调成半透明。没有图片、没有动画、
 * 没有一个编译产物类名 —— 宿主升级之后它照样在。
 */`;

  const parts = [head, ""];
  parts.push("/* ── 浅色 ── */");
  parts.push(block(LIGHT_SELECTORS.join(",\n"), variables(light, false)));
  parts.push("");
  parts.push("/* ── 深色 ── */");
  parts.push(block(DARK_SELECTORS.join(",\n"), variables(dark, true)));
  parts.push("");
  parts.push(`/* ── 背景 ──
   铺在挂载点上而不是 body::before：z-index:-1 的伪元素要能被看见，得 html、body
   和每一层祖先都不挡它 —— 实测在真实宿主里挡住了，表现是"皮肤装了但界面一片空白"。
   直接画成挂载点的 background-image 就没有这个问题。 */`);
  parts.push(`html:has(${MOUNTS.map((m) => `${m}`).join(", ")}) { background-color: ${light.bg}; }`);
  parts.push(block(MOUNTS.join(",\n"), {
    "background-color": "var(--color-bg)",
    "background-image": light.scene,
    "background-size": "cover",
    "background-position": "center center",
    "background-repeat": "no-repeat",
    "background-attachment": "fixed",
  }));
  parts.push("");
  parts.push(block(DARK_SELECTORS.flatMap((d) => MOUNTS.map((m) => `${d} ${m}`)).join(",\n"), {
    "background-image": dark.scene,
  }));
  parts.push("");
  parts.push(`/* ── 承载文字的地方补半透明底 ──
   背景铺开之后正文直接压在画面上会读不清，但整块加回不透明底又把背景盖没了。
   只给真正需要底才读得清的元素加，且用半透明，背景仍然透得出来。
   钩的是标签名和 role，不是类名 —— 类名会随宿主构建变，role 不会。 */`);
  parts.push(block(
    [":is(input, textarea, select)", ":is([role=dialog], [role=menu], [role=listbox], [role=tooltip])", ":is(pre, code)"]
      .flatMap((sel) => MOUNTS.map((m) => `${m} ${sel}`)).join(",\n"),
    { "background-color": "var(--color-surface-raised)" }));
  return `${parts.join("\n")}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const dirs = fs.readdirSync(SKINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKINS_DIR, e.name, "palette.json")))
    .map((e) => path.join(SKINS_DIR, e.name));
  let drift = 0;
  for (const dir of dirs) {
    const palette = JSON.parse(fs.readFileSync(path.join(dir, "palette.json"), "utf8"));
    const metaFile = path.join(dir, "skin.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    // 画廊里的色卡：一半浅一半深，一眼看出这套皮肤两种模式都长什么样。
    // 生成而不是手填，是因为它必须跟着 palette 走，手填一定会漂。
    const swatch = [palette.light.bg, palette.dark.bg, meta.accent || palette.dark.accent];
    if (JSON.stringify(meta.swatch) !== JSON.stringify(swatch)) {
      if (check) { console.error(`  ✗ ${path.basename(dir)} 的 swatch 与 palette.json 不同步`); drift += 1; }
      else { meta.swatch = swatch; fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`); }
    }
    const css = render(meta, palette);
    const file = path.join(dir, "skin.css");
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (current === css) { if (!check) console.log(`  = ${path.basename(dir)}`); continue; }
    if (check) { console.error(`  ✗ ${path.basename(dir)} 的 skin.css 与 palette.json 不同步`); drift += 1; continue; }
    fs.writeFileSync(file, css);
    console.log(`  ✎ ${path.basename(dir)}`);
  }
  if (check && drift) {
    console.error(`\n${drift} 套皮肤的 skin.css 落后于 palette.json。跑 npm run build:skins 再提交。`);
    process.exit(1);
  }
  console.log(`\n${dirs.length} 套皮肤${check ? "全部同步" : "已生成"}`);
}

main();
