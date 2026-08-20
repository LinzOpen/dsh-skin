"use strict";
/**
 * @dsh-skin/core —— 皮肤引擎。
 *
 * 刻意不依赖 Electron、不依赖 DOM、零第三方依赖：这样同一份规则能同时跑在
 * CI（node --test）、命令行、Electron 主进程和任何别的宿主里。
 * 一旦这里 require 了 electron，CI 就得装一个完整的 Electron 才能跑校验 —— 不值得。
 */

const { normalizeManifest, ManifestError, ID_RE } = require("./manifest");
const { validateCss, ASSET_TOKEN, stripComments } = require("./validate");
const { scanLibrary, scanDir, readSkin, isSkinDir, SKIN_CSS, SKIN_JSON } = require("./library");
const rules = require("./rules");
const home = require("./home");
const history = require("./history");
const doctor = require("./doctor");

/**
 * 把皮肤 CSS 里的 __SKIN__ 换成宿主能取到素材的前缀。
 * 每个宿主的取图方式都不一样（自定义协议 / 本地 http / file://），
 * 引擎不替宿主选，只负责换这个占位符。
 */
function resolveCss(css, assetBase) {
  return String(css).split(ASSET_TOKEN).join(String(assetBase).replace(/\/+$/, ""));
}

module.exports = {
  // 清单
  normalizeManifest, ManifestError, ID_RE,
  // 检查
  validateCss, stripComments, rules,
  // 皮肤库
  scanLibrary, scanDir, readSkin, isSkinDir,
  // 套用
  resolveCss, ASSET_TOKEN,
  // 常量
  SKIN_CSS, SKIN_JSON,
  // 用户目录 / 还原点 / 体检 —— 程序和命令行共用同一份实现，
  // 因为救援发生在程序打不开的时候，那时候只剩命令行。
  home, history, doctor,
};
