#!/usr/bin/env node
"use strict";
/**
 * 把检查器打成一个能直接 <script> 引入的文件，给 demo 页用。
 *
 * 为什么手写而不是上打包器：这个项目的整个卖点是"注入进你界面的东西我全都看得见"。
 * 为了产出一个 12KB 的文件引入一整条打包工具链，和这句话是矛盾的 ——
 * 而且 demo 页上的那份代码，任何人都应该能一眼看完。
 *
 *     node scripts/build-demo.js
 *
 * 产物 demo/css-guard.js 会被提交进仓库，因为 GitHub Pages 直接发静态文件，
 * 没有构建步骤。CI 会检查它和源没有分叉。
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "packages", "core", "src");
const OUT = path.join(__dirname, "..", "demo", "css-guard.js");
// 顺序即依赖顺序。browser.js 是入口，它 require 前两个。
const MODULES = ["rules.js", "validate.js", "browser.js"];

function bundle() {
  const parts = MODULES.map((name) => {
    const code = fs.readFileSync(path.join(SRC, name), "utf8");
    return `  __defs["./${name.replace(/\.js$/, "")}"] = function (module, exports, require) {\n${code}\n  };`;
  });

  return `/* css-guard —— 浏览器版检查器
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
    var key = id.replace(/^\\.\\//, "./");
    if (__cache[key]) return __cache[key].exports;
    var def = __defs[key];
    if (!def) throw new Error("css-guard bundle: 找不到模块 " + id);
    var module = { exports: {} };
    __cache[key] = module;
    def(module, module.exports, require);
    return module.exports;
  }

${parts.join("\n\n")}

  global.cssGuard = require("./browser");
})(typeof globalThis !== "undefined" ? globalThis : window);
`;
}

function main() {
  const check = process.argv.includes("--check");
  const code = bundle();
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current === code) { console.log("demo/css-guard.js 已是最新"); return; }
  if (check) {
    console.error("demo/css-guard.js 落后于 packages/core/src。跑 npm run build:demo 再提交。");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, code);
  console.log(`demo/css-guard.js  ${(code.length / 1024).toFixed(1)} KB`);
}

main();
