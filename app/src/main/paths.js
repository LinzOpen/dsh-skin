"use strict";
/**
 * 三个目录，各有各的不可替代：
 *   builtin —— 跟着程序走。升级会整个覆盖，所以用户绝不能往里写。
 *   user    —— 用户自己的皮肤。升级永远不碰，所以是唯一可写的地方。
 *   state   —— 一个 JSON。跟皮肤分开放，删皮肤不会连设置一起删掉。
 *
 * 用 ~/.dsh-skin 而不是 app.getPath("userData")：后者在三个平台上是三个又长又
 * 藏得很深的路径，而这个目录是要写进文档、要用户自己去放图的。可发现性优先。
 */
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const HOME = os.homedir();
const USER_ROOT = process.env.DSH_SKIN_HOME || path.join(HOME, ".dsh-skin");
const USER_SKINS = path.join(USER_ROOT, "skins");
const STATE_FILE = path.join(USER_ROOT, "state.json");
// 打包后 __dirname 在 app.asar 里，skins/ 用 extraResources 放在 asar 外面；
// 开发时它在仓库根。两个都试，先命中哪个用哪个。
const REPO_SKINS = path.join(__dirname, "..", "..", "..", "skins");
// process.resourcesPath 只有在 Electron 里才有。空字符串 join 出来是相对路径 "skins"，
// 而 existsSync("skins") 会跟着 cwd 走 —— 在别人仓库里跑就会误命中。所以显式判空。
const BUILTIN_CANDIDATES = process.resourcesPath
  ? [path.join(process.resourcesPath, "skins"), REPO_SKINS]
  : [REPO_SKINS];

function builtinSkins() {
  return BUILTIN_CANDIDATES.find((p) => fs.existsSync(p)) || REPO_SKINS;
}

function ensureUserDirs() {
  fs.mkdirSync(USER_SKINS, { recursive: true });
  return USER_SKINS;
}

/** 皮肤根，顺序即优先级：后面的同 id 皮肤覆盖前面的。 */
function skinRoots() {
  return [builtinSkins(), USER_SKINS];
}

module.exports = { HOME, USER_ROOT, USER_SKINS, STATE_FILE, builtinSkins, ensureUserDirs, skinRoots };
