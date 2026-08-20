"use strict";
/**
 * 皮肤检查器。输入一段 CSS（可选：皮肤目录，用来核对素材是否真的存在），
 * 输出一串带行号的 finding。
 *
 * 设计上刻意分成两级：
 *   error —— 宿主**不许套用**。全是安全问题，用户点了"仍然套用"也不给。
 *   warn  —— 照常套用，但界面上标出来。全是"能用，但宿主一升级/机器一发烫就出事"。
 * 混成一级会有两个后果：要么真危险的被当噪音点掉，要么合法皮肤被误杀。
 */

/* fs / path 刻意**不在这里 require**，只在需要核对素材是否存在时按需取。
   这样 validate.js 在浏览器、Worker、Deno、浏览器扩展里都能直接跑 ——
   而"检查一段 CSS 安不安全"这件事，最该发生的地方恰恰就是这些环境：
   在把用户的样式表注入页面之前，当场判断。绑死 node:fs 等于把它们全挡在门外。 */
const {
  SECURITY_RULES, QUALITY_RULES, REQUIRED_VARIABLES,
  CLASS_TOKEN, looksHashedClass,
} = require("./rules");

/** 素材占位符。皮肤里写 url("__SKIN__/bg.png")，宿主套用时换成自己的取图前缀。 */
const ASSET_TOKEN = "__SKIN__";

/** 去掉注释再扫，否则"注释里写了一个远程 URL 的说明"会被当成命中。 */
function stripComments(css) {
  // 用等长空白替换，行号和列号才不会漂。
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function lineOf(css, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (css.charCodeAt(i) === 10) line += 1;
  return line;
}

function snippet(css, index) {
  const start = css.lastIndexOf("\n", index) + 1;
  let end = css.indexOf("\n", index);
  if (end === -1) end = css.length;
  const text = css.slice(start, end).trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function collect(css, rule, findings) {
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  let match;
  const seenLines = new Set();
  while ((match = re.exec(css)) !== null) {
    if (match[0].length === 0) { re.lastIndex += 1; continue; }
    const line = lineOf(css, match.index);
    // 同一行同一条规则只报一次：一行里连写三个远程 url 是同一个问题。
    if (seenLines.has(line)) continue;
    seenLines.add(line);
    findings.push({
      rule: rule.id,
      severity: rule.severity,
      message: rule.message,
      why: rule.why,
      line,
      snippet: snippet(css, match.index),
    });
  }
}

/** `__SKIN__/foo/bar.png` 里被引用到的相对路径。 */
function referencedAssets(css) {
  const out = [];
  const re = new RegExp(`${ASSET_TOKEN}\\/([^"')\\s]+)`, "g");
  let match;
  while ((match = re.exec(css)) !== null) {
    out.push({ ref: match[1], index: match.index });
  }
  return out;
}

/**
 * @param {string} css                 皮肤 CSS 原文
 * @param {object} [options]
 * @param {string} [options.dir]       皮肤目录；给了才会核对素材是否存在
 * @param {string} [options.assetsDir] 素材子目录名，默认 "assets"
 * @returns {{ok:boolean, errors:number, warnings:number, findings:Array}}
 */
function validateCss(css, options = {}) {
  const { dir = null, assetsDir = "assets" } = options;
  const scan = stripComments(String(css));
  const findings = [];

  for (const rule of SECURITY_RULES) collect(scan, rule, findings);
  for (const rule of QUALITY_RULES) collect(scan, rule, findings);

  // 编译产物类名：逐个类名过谓词，同一行同一个名字只报一次。
  const hashSeen = new Set();
  const classRe = new RegExp(CLASS_TOKEN.source, CLASS_TOKEN.flags);
  let hit;
  while ((hit = classRe.exec(scan)) !== null) {
    if (!looksHashedClass(hit[1])) continue;
    const line = lineOf(scan, hit.index);
    const key = `${line}:${hit[1]}`;
    if (hashSeen.has(key)) continue;
    hashSeen.add(key);
    findings.push({
      rule: "hashed-class-selector",
      severity: "warn",
      message: `钩住了编译产物类名 .${hit[1]}`,
      why: "这类名字每次构建都变，宿主一升级皮肤就失效。请改用 CSS 变量、#app / #root 这样的 id，或 [role=dialog] 这样的语义属性。",
      line,
      snippet: snippet(scan, hit.index),
    });
  }

  // 必需变量：缺了不代表坏，但多半意味着这套皮肤只改了背景没改配色，
  // 换到深色宿主上会出现"白字白底"。
  const missing = REQUIRED_VARIABLES.filter((v) => !scan.includes(v));
  if (missing.length) {
    findings.push({
      rule: "missing-variable",
      severity: "warn",
      message: `未定义 ${missing.join(" / ")}`,
      why: "宿主用这几个变量决定正文颜色。只铺背景不定义它们，换到另一种明暗模式下会出现看不清的文字。",
      line: 1,
      snippet: "",
    });
  }

  // 素材存在性：只有拿到目录才能查，查不了就不报（CLI 传目录，实时预览不传）。
  if (dir) {
    // 按需 require：不给 dir 就永远不会走到这里，也就不会碰 node 内置模块。
    const fs = require("node:fs");
    const path = require("node:path");
    const seen = new Set();
    for (const { ref, index } of referencedAssets(scan)) {
      const clean = ref.split("?")[0].split("#")[0];
      if (seen.has(clean)) continue;
      seen.add(clean);
      const line = lineOf(scan, index);
      if (clean.split(/[\\/]/).includes("..")) {
        findings.push({
          rule: "escape-assets",
          severity: "error",
          message: `素材路径越出皮肤目录：${clean}`,
          why: "__SKIN__ 之后只能是皮肤目录内的相对路径，.. 会让皮肤读到它不该读的文件。",
          line, snippet: snippet(scan, index),
        });
        continue;
      }
      const candidates = [path.join(dir, assetsDir, clean), path.join(dir, clean)];
      if (!candidates.some((p) => fs.existsSync(p))) {
        findings.push({
          rule: "missing-asset",
          severity: "error",
          message: `引用了不存在的素材：${clean}`,
          why: `在 ${assetsDir}/ 和皮肤根目录下都没找到。装到别人机器上就是一块空白，不是"少一张图"那么轻。`,
          line, snippet: snippet(scan, index),
        });
      }
    }
  }

  findings.sort((a, b) => (a.line - b.line) || a.rule.localeCompare(b.rule));
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  return { ok: errors === 0, errors, warnings, findings };
}

module.exports = { validateCss, ASSET_TOKEN, stripComments };
