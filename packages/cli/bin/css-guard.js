#!/usr/bin/env node
"use strict";
/**
 * css-guard —— 命令行。
 *
 * 存在的理由只有一个：**皮肤检查必须能在 CI 里跑**。
 * 皮肤是别人 PR 进来的、会被注入进用户界面的代码，人工审 CSS 是审不动的；
 * 这个命令让 "有没有远程 URL" 变成一个退出码。
 */

const fs = require("node:fs");
const path = require("node:path");
const core = require("@linzopen/css-guard");
const { zipSync } = require("./zip.js");

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", off: "\x1b[0m" }
  : { red: "", yellow: "", green: "", dim: "", off: "" };

const USAGE = `css-guard <command>

皮肤
  validate [path...]   检查皮肤：安全规则 + 稳定性规则 + 素材是否存在
                       path 可以是一套皮肤，也可以是装着若干套皮肤的目录
                       有 error 时退出码 1 —— 直接拿来当 CI 闸门
  list [path]          列出一个目录下的皮肤
  new <id> [--dir d]   生成一套新皮肤的骨架
  pack <path> [-o f]   把一套皮肤打成 .zip（零依赖，可复现）

出事之后（这几条**不需要程序在运行**，读写的是同一批文件）
  doctor [--fix]       体检：现在什么状况、每一条怎么修
  history              列出所有还原点
  undo [id]            退回还原点（不给 id 就是最近的一个）
                       默认先预演给你看，加 --yes 才真的动手
  snapshot [-m 说明]    现在存一个还原点
  safe-mode on|off|status
                       安全模式：程序启动时不套任何皮肤，也不轮播

  --json               所有命令都支持，输出机器可读的 JSON
  help                 这段

给 AI 助手：先跑 \`css-guard doctor --json\`，它带着每一条问题的修复命令。`;

/** 一个路径是"一套皮肤"还是"一堆皮肤的家"？有 skin.css 就是前者。 */
function collectSkins(target) {
  if (core.isSkinDir(target)) return [core.readSkin(target)];
  return core.scanDir(target);
}

function printFinding(finding) {
  const tag = finding.severity === "error" ? `${C.red}error${C.off}` : `${C.yellow}warn ${C.off}`;
  console.log(`    ${tag} L${finding.line} ${finding.rule} — ${finding.message}`);
  console.log(`          ${C.dim}${finding.why}${C.off}`);
  if (finding.snippet) console.log(`          ${C.dim}> ${finding.snippet}${C.off}`);
}

function cmdValidate(targets, opts) {
  const roots = targets.length ? targets : ["skins"];
  const results = [];
  for (const target of roots) {
    if (!fs.existsSync(target)) {
      console.error(`路径不存在：${target}`);
      process.exitCode = 2;
      return;
    }
    for (const skin of collectSkins(target)) {
      if (skin.broken) {
        results.push({ id: skin.id, dir: skin.dir, ok: false, errors: 1, warnings: 0,
          findings: [{ rule: "broken-skin", severity: "error", line: 1,
                       message: skin.error, why: "皮肤读不出来，宿主会直接跳过它。", snippet: "" }] });
        continue;
      }
      const css = fs.readFileSync(skin.cssFile, "utf8");
      const report = core.validateCss(css, { dir: skin.dir, assetsDir: skin.assets });
      results.push({ id: skin.id, name: skin.name, dir: skin.dir, ...report });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    if (!results.length) console.log("没找到任何皮肤（皮肤 = 一个含 skin.css 的目录）");
    for (const r of results) {
      const mark = r.errors ? `${C.red}✗${C.off}` : r.warnings ? `${C.yellow}!${C.off}` : `${C.green}✓${C.off}`;
      console.log(`  ${mark} ${r.id}${r.name && r.name !== r.id ? ` ${C.dim}(${r.name})${C.off}` : ""}`);
      for (const f of r.findings) printFinding(f);
    }
    const errors = results.filter((r) => r.errors).length;
    const warns = results.filter((r) => !r.errors && r.warnings).length;
    console.log(`\n共 ${results.length} 套：${C.green}通过 ${results.length - errors - warns}${C.off} · ` +
                `${C.yellow}提示 ${warns}${C.off} · ${C.red}拦下 ${errors}${C.off}`);
  }
  if (results.some((r) => r.errors)) process.exitCode = 1;
}

function cmdList(target, opts) {
  const skins = collectSkins(target || "skins");
  if (opts.json) { console.log(JSON.stringify(skins, null, 2)); return; }
  for (const s of skins) {
    const state = s.broken ? `${C.red}broken${C.off} ${s.error}` : `${C.dim}${s.appearance}${C.off}`;
    console.log(`  ${s.id.padEnd(24)} ${String(s.name).padEnd(20)} ${state}`);
  }
  console.log(`\n${skins.length} 套`);
}

const TEMPLATE_CSS = (id, name) => `/* ${name}
   ————————————————————————————————————————————————————————————
   稳定性约定（照着写，宿主升级了皮肤也还在）：
     · 只覆盖 :root 上的 CSS 变量
     · 只钩 #app / #root 这样的 id，和 [role=dialog] 这样的语义属性
     · 绝不钩 .aB3x_9f 这类编译产物类名 —— 它每次构建都会变
     · 绝不用 infinite 动画 —— 一条全窗口的永动动画能把宿主拖到 100% CPU
     · 素材写 url("__SKIN__/xxx.png")，宿主会替换成它自己的取图前缀
   跑 \`css-guard validate\` 会把上面每一条都检查一遍。
   ———————————————————————————————————————————————————————————— */

:root {
  --color-bg: #f6f7fb;
  --color-text: #1a1d29;
  --color-accent: #4c6ef5;

  --color-surface: rgba(255, 255, 255, .78);
  --color-line: rgba(26, 29, 41, .12);
}

html[data-color-scheme="dark"], :root[data-theme="dark"] {
  --color-bg: #10131c;
  --color-text: #e8ecf5;
  --color-accent: #7f9bff;

  --color-surface: rgba(24, 29, 44, .78);
  --color-line: rgba(232, 236, 245, .14);
}

/* 背景铺在挂载点上。#app 与 #root 都写，是因为不同宿主用的名字不一样。 */
#app, #root {
  background-color: var(--color-bg);
  background-image: linear-gradient(160deg, #eef1ff 0%, #f8f9ff 60%, #ffffff 100%);
  background-size: cover;
  background-position: center;
}

html[data-color-scheme="dark"] #app, :root[data-theme="dark"] #app,
html[data-color-scheme="dark"] #root, :root[data-theme="dark"] #root {
  background-image: linear-gradient(160deg, #0b0e17 0%, #151a2b 60%, #0f1320 100%);
}
`;

function cmdNew(id, opts) {
  if (!core.ID_RE.test(String(id || ""))) {
    console.error("皮肤 id 只允许小写字母、数字和连字符，例如 midnight-harbor");
    process.exitCode = 2;
    return;
  }
  const dir = path.join(opts.dir || "skins", id);
  if (fs.existsSync(dir)) { console.error(`已存在：${dir}`); process.exitCode = 2; return; }
  const name = opts.name || id;
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skin.json"), `${JSON.stringify({
    id, name, version: "0.1.0", tagline: "", author: "", license: "CC0-1.0",
    tags: [], accent: "#4c6ef5", appearance: "both",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "skin.css"), TEMPLATE_CSS(id, name));
  fs.writeFileSync(path.join(dir, "assets", ".gitkeep"), "");
  console.log(`已生成 ${dir}`);
  console.log(`  下一步：改 skin.css，然后 css-guard validate ${dir}`);
}

/** 收集皮肤目录下要打包的文件。node_modules 之类的不该进包。 */
function filesUnder(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(abs, rel));
    else if (entry.isFile()) out.push({ name: rel, data: fs.readFileSync(abs) });
  }
  return out;
}

function cmdPack(target, opts) {
  if (!core.isSkinDir(target)) { console.error(`不是一套皮肤（缺 skin.css）：${target}`); process.exitCode = 2; return; }
  const skin = core.readSkin(target);
  const css = fs.readFileSync(skin.cssFile, "utf8");
  const report = core.validateCss(css, { dir: skin.dir, assetsDir: skin.assets });
  if (!report.ok) {
    console.error(`${C.red}拒绝打包${C.off}：${skin.id} 有 ${report.errors} 个 error，先跑 css-guard validate`);
    process.exitCode = 1;
    return;
  }
  const out = opts.out || `${skin.id}.css-guard.zip`;
  // 包内带一层皮肤 id 目录：解压出来就是一套能直接放进 skins/ 的皮肤。
  const entries = filesUnder(target).map((f) => ({ name: `${skin.id}/${f.name}`, data: f.data }));
  fs.writeFileSync(out, zipSync(entries));
  console.log(`${C.green}✓${C.off} ${out}  ${entries.length} 个文件 · ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}

/* ── 救援 ──────────────────────────────────────────────────────────────
   这几条命令存在的唯一理由：程序打不开的时候，用户和他的 agent 还得有路可走。
   所以它们不 require electron、不需要程序在运行，只读写 ~/.css-guard。 */

const LEVEL_MARK = { ok: `${C.green}✓${C.off}`, warn: `${C.yellow}!${C.off}`, error: `${C.red}✗${C.off}` };

function cmdDoctor(opts) {
  const report = opts.fix
    ? (() => { const r = core.doctor.repair(); return { ...r.after, repaired: r.done }; })()
    : core.doctor.diagnose();

  if (opts.json) { console.log(JSON.stringify(report, null, 2)); }
  else {
    if (report.repaired?.length) {
      console.log(`${C.green}已自动修复：${C.off}`);
      for (const d of report.repaired) console.log(`  ✓ ${d.action}${C.dim} — ${d.detail}${C.off}`);
      console.log("");
    }
    for (const c of report.checks) {
      console.log(`  ${LEVEL_MARK[c.level]} ${c.title}`);
      if (c.detail) console.log(`      ${C.dim}${c.detail}${C.off}`);
      if (c.fix) console.log(`      ${C.dim}→ ${c.fix.command ? `${c.fix.command}  ` : ""}${c.fix.description || ""}${C.off}`);
    }
    const bad = report.checks.filter((c) => c.level !== "ok").length;
    console.log(`\n${bad ? `${bad} 处需要处理` : "一切正常"}${opts.fix ? "" : `${C.dim}（加 --fix 自动修能安全修的那些）${C.off}`}`);
  }
  // 只有 error 才非零退出。warn 是"留意"，不该让脚本以为失败了。
  if (report.level === "error") process.exitCode = 1;
}

function cmdHistory(opts) {
  const points = core.history.list();
  if (opts.json) { console.log(JSON.stringify(points, null, 2)); return; }
  if (!points.length) { console.log("还没有还原点。做任何改动时会自动存，也可以 css-guard snapshot 手动存。"); return; }
  for (const p of points) {
    const mark = p.broken ? `${C.red}✗${C.off}` : " ";
    console.log(`  ${mark} ${p.id}`);
    console.log(`      ${p.label}${C.dim} · ${p.at || "时间未知"} · ${p.skins} 套皮肤${C.off}`);
  }
  console.log(`\n${points.length} 个。回退：css-guard undo [id]`);
}

function cmdUndo(id, opts) {
  const points = core.history.list().filter((p) => !p.broken);
  if (!points.length) {
    console.error("没有可用的还原点 —— 没得退。");
    process.exitCode = 1;
    return;
  }
  const target = id || points[0].id;
  // 默认预演。回退是一个会覆盖文件的动作，不该因为命令行敲错一个字就发生。
  const dry = core.history.restore(target, { dryRun: true });
  if (!dry.ok) { console.error(dry.error); process.exitCode = 1; return; }

  if (opts.json && !opts.yes) { console.log(JSON.stringify({ dryRun: true, ...dry }, null, 2)); return; }
  if (!opts.yes) {
    console.log(`要恢复到：${C.green}${dry.label}${C.off}  ${C.dim}(${dry.at})${C.off}\n`);
    for (const c of dry.changes) console.log(`  · ${c.action} ${c.skin ? `${c.skin}/` : ""}${c.file}`);
    if (dry.missingAssets.length) {
      console.log(`\n  ${C.yellow}注意${C.off}：${dry.missingAssets.length} 张素材图当时在、现在不在了。还原点只存文字，图找不回来。`);
    }
    if (dry.kept.length) console.log(`\n  那之后新增的会原样保留（恢复不删东西）：${dry.kept.join("、")}`);
    console.log(`\n这只是预演。真的执行：${C.green}css-guard undo ${target} --yes${C.off}`);
    return;
  }

  // 真的动手之前，先给"现在的样子"也存一个还原点 —— 否则回退就是一条单行道。
  core.history.snapshot("before-undo", "回退之前的状态");
  const result = core.history.restore(target);
  if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!result.ok) { console.error(result.error); process.exitCode = 1; return; }
  console.log(`${C.green}✓${C.off} 已恢复到「${result.label}」，改了 ${result.changes.length} 处。`);
  console.log(`${C.dim}回退之前的样子也存下来了，反悔就再 css-guard history 看一眼。${C.off}`);
}

function cmdSnapshot(opts) {
  const label = opts.message || "手动存档";
  try {
    const record = core.history.snapshot("manual", label);
    if (opts.json) console.log(JSON.stringify(record, null, 2));
    else console.log(`${C.green}✓${C.off} ${record.id}  ${record.label}`);
  } catch (error) {
    console.error(`存不下来：${error.message}`);
    process.exitCode = 1;
  }
}

function cmdSafeMode(action, opts) {
  if (action === "on" || action === "off") {
    core.home.setSafeMode(action === "on", "命令行");
  } else if (action && action !== "status") {
    console.error("用法：css-guard safe-mode on|off|status");
    process.exitCode = 2;
    return;
  }
  const info = core.home.safeModeInfo();
  if (opts.json) { console.log(JSON.stringify({ on: Boolean(info), info }, null, 2)); return; }
  if (info) {
    console.log(`安全模式${C.yellow}开${C.off} —— 程序启动时不会套任何皮肤，也不轮播。`);
    console.log(`${C.dim}原因：${info.reason}${info.at ? `（${info.at}）` : ""}${C.off}`);
    console.log(`${C.dim}你的皮肤都还在。确认问题解决后：css-guard safe-mode off${C.off}`);
  } else {
    console.log(`安全模式${C.green}关${C.off} —— 正常套用皮肤。`);
  }
}

function main(argv) {
  const opts = { json: argv.includes("--json") };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") continue;
    if (a === "--dir") { opts.dir = argv[++i]; continue; }
    if (a === "--name") { opts.name = argv[++i]; continue; }
    if (a === "-o" || a === "--out") { opts.out = argv[++i]; continue; }
    if (a === "-m" || a === "--message") { opts.message = argv[++i]; continue; }
    if (a === "--fix") { opts.fix = true; continue; }
    if (a === "-y" || a === "--yes") { opts.yes = true; continue; }
    rest.push(a);
  }
  const [command, ...args] = rest;
  switch (command) {
    case "validate": return cmdValidate(args, opts);
    case "list": return cmdList(args[0], opts);
    case "new": return cmdNew(args[0], opts);
    case "pack": return cmdPack(args[0], opts);
    case "doctor": return cmdDoctor(opts);
    case "history": return cmdHistory(opts);
    case "undo": case "restore": return cmdUndo(args[0], opts);
    case "snapshot": return cmdSnapshot(opts);
    case "safe-mode": return cmdSafeMode(args[0], opts);
    case "help": case "--help": case "-h": case undefined: return void console.log(USAGE);
    default:
      console.error(`未知命令：${command}\n`);
      console.log(USAGE);
      process.exitCode = 2;
  }
}

main(process.argv.slice(2));
