"use strict";
/**
 * 目录。用户目录那部分全部委托给 css-guard 的 home ——
 * 命令行的 `css-guard doctor` 读的是同一份实现。两份实现必然漂移，
 * 而漂移的后果是体检报出来的现状不是程序真正用的那一份，
 * 那时候 agent 拿着诊断去修，会越修越远。
 */
const fs = require("node:fs");
const path = require("node:path");
const { home } = require("@linzopen/css-guard");

const REPO_SKINS = path.join(__dirname, "..", "..", "..", "skins");
// process.resourcesPath 只有在 Electron 里才有。空字符串 join 出来是相对路径 "skins"，
// 而 existsSync("skins") 会跟着 cwd 走 —— 在别人仓库里跑就会误命中。所以显式判空。
const BUILTIN_CANDIDATES = process.resourcesPath
  ? [path.join(process.resourcesPath, "skins"), REPO_SKINS]
  : [REPO_SKINS];

const p = () => home.paths();

function builtinSkins() {
  return BUILTIN_CANDIDATES.find((c) => fs.existsSync(c)) || REPO_SKINS;
}

function ensureUserDirs() {
  home.ensureDirs();
  return p().skins;
}

/** 皮肤根，顺序即优先级：后面的同 id 皮肤覆盖前面的。 */
const skinRoots = () => [builtinSkins(), p().skins];

module.exports = {
  get USER_ROOT() { return p().root; },
  get USER_SKINS() { return p().skins; },
  get STATE_FILE() { return p().state; },
  builtinSkins, ensureUserDirs, skinRoots,
};
