#!/usr/bin/env node
"use strict";
/**
 * 仓库自检。跑在 CI 的第一步，也可以随时手跑：
 *
 *     npm run lint
 *
 * 它检查的不是代码风格 —— 那种事交给编辑器。它检查的是**这个仓库特有的、
 * 一旦破了就很难在 review 里看出来的约定**：
 *
 *   1. 生成物和源不许分叉。skin.css 是从 palette.json 生成的，但两个都要提交
 *      （皮肤必须自包含，别人下个 zip 就能用）。分叉了就是"仓库里的皮肤和
 *      文档说的不一样"，而没人会去比对。
 *   2. 每套皮肤都要有 license。一个开源皮肤仓最大的风险是有人 PR 进来一套
 *      带着别人美术素材的皮肤 —— 强制填 license 至少让这件事变成一个明确的声明。
 *   3. 文档里的相对链接得指向真实存在的文件。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const problems = [];
const note = (message) => problems.push(message);

/* 1. 皮肤生成物同步 */
try {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-skins.js"), "--check"],
    { cwd: ROOT, stdio: "pipe" });
} catch (error) {
  // execFileSync 失败时 stdout / stderr 是 Buffer，而**空 Buffer 也是 truthy** ——
  // 写成 `error.stdout || error.stderr` 会永远选中空的那个，于是"具体哪几套皮肤漂了"
  // 一个字都印不出来。第一次 CI 在 Windows 上失败时就是这样，只看到一行标题。
  const detail = [error.stdout, error.stderr]
    .map((b) => (b ? String(b).trim() : ""))
    .filter(Boolean)
    .join("\n");
  note(`皮肤生成物落后于 palette.json：\n${detail || "(子进程没有输出)"}`);
}

/* 1b. demo 的浏览器 bundle 不能落后于 core 源 */
try {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-demo.js"), "--check"],
    { cwd: ROOT, stdio: "pipe" });
} catch (error) {
  note(`demo/css-guard.js 落后于 packages/core/src。跑 npm run build:demo 再提交。`);
}

/* 2. 每套皮肤的元数据 */
const skinsDir = path.join(ROOT, "skins");
for (const entry of fs.readdirSync(skinsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(skinsDir, entry.name);
  const metaFile = path.join(dir, "skin.json");
  if (!fs.existsSync(metaFile)) { note(`${entry.name} 缺 skin.json`); continue; }
  if (!fs.existsSync(path.join(dir, "skin.css"))) { note(`${entry.name} 缺 skin.css`); continue; }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); }
  catch (error) { note(`${entry.name}/skin.json 不是合法 JSON：${error.message}`); continue; }
  if (!meta.name) note(`${entry.name} 的 skin.json 没写 name`);
  if (!meta.license) note(`${entry.name} 的 skin.json 没写 license —— 仓库里的每套皮肤都必须声明许可`);
  if (meta.id && meta.id !== entry.name) note(`${entry.name} 的 skin.json 里 id 写成了 ${meta.id}`);
}

/* 3. Markdown 里的相对链接 */
function markdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(abs, out);
    else if (entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}
for (const file of markdownFiles(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target.split("#")[0]);
    if (!fs.existsSync(resolved)) {
      note(`${path.relative(ROOT, file)} 链到了不存在的 ${target}`);
    }
  }
}

/* 4. 作者的个人账号不许出现在仓库里。
      这个项目刻意发在一个跟作者个人账号无关的账号下，一个字符串漏进任何文件
      （包括 package.json 的 author、schema 的 $id、README 里的一条旧链接）
      就把这层分离作废了，而且是**永久**的 —— git 历史删不掉。
      名字本身用 base64 存：明文写在这里，等于用一个检查器把要藏的东西发出去。 */
const FORBIDDEN = ["TGluemVDb2xpbg==", "bGluemV6aGFuZw=="]
  .map((b) => Buffer.from(b, "base64").toString("utf8"));
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(abs, out);
    else if (/\.(js|json|md|yml|yaml|css|html|sh)$/.test(entry.name)) out.push(abs);
  }
  return out;
}
for (const file of sourceFiles(ROOT)) {
  if (file === __filename) continue;      // 检查器自己只存编码后的形式
  const text = fs.readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) note(`${path.relative(ROOT, file)} 里出现了 ${needle}`);
  }
}

if (problems.length) {
  console.error("仓库自检没过：\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} 个问题`);
  process.exit(1);
}
console.log("仓库自检通过");
