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
