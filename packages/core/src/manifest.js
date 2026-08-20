"use strict";
/**
 * skin.json 的读取与归一化。
 *
 * 为什么要"归一化"而不是直接把 JSON 递给调用方：真实皮肤库里三分之二的
 * skin.json 只写了一个 name（本机 kimi 外壳的四套皮肤全是这样）。让每个消费方
 * 各自 `meta.tags || []` 兜底，兜漏一处就是一次崩溃；在入口补齐一次，后面所有
 * 代码都可以当字段一定存在。
 */

const path = require("node:path");
const crypto = require("node:crypto");

/** 皮肤 id：只允许小写字母、数字和连字符。
 *  它会被拼进 URL（`dshskin://<id>/...`）和文件路径，放开就等于放开路径穿越。 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const APPEARANCES = new Set(["light", "dark", "both"]);

const DEFAULTS = {
  version: "0.0.0",
  tagline: "",
  author: "",
  license: "",
  homepage: "",
  tags: [],
  accent: "",
  appearance: "both",
  assets: "assets",
  preview: "",
  requires: [],
  backdrops: [],
  derivedId: false,
};

class ManifestError extends Error {
  constructor(message, file) {
    super(file ? `${message} (${file})` : message);
    this.name = "ManifestError";
    this.file = file;
  }
}

function asArrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

/**
 * @param {object} raw   解析后的 skin.json
 * @param {string} dirName  皮肤目录名，raw.id 缺省时用它
 * @param {string} [file]   出错信息里带上的路径
 */
/**
 * 目录名推出一个合法 id。
 *
 * 为什么要推而不是直接报错：id 必须是 URL 和路径安全的（它会被拼进
 * `dshskin://skin/<id>/...`），但用户新建目录时几乎一定用自己的语言 ——
 * 中文、日文、带空格的短语。直接判"不合法"的后果是：一套完全正常的皮肤
 * 被报成「读不出来」，报错还看不懂，而用户根本不知道自己做错了什么。
 *
 * 哈希取自原始目录名，所以同一个目录每次算出来都一样（id 必须跨次启动稳定，
 * 否则记在设置里的"当前皮肤"下次就对不上了）；两个不同的中文名也不会撞到一起。
 */
function deriveId(dirName) {
  const ascii = String(dirName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = crypto.createHash("sha1").update(String(dirName)).digest("hex").slice(0, 8);
  return ID_RE.test(ascii) ? `${ascii}-${hash}` : `skin-${hash}`;
}

function normalizeManifest(raw, dirName, file) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("skin.json 必须是一个 JSON 对象", file);
  }
  const explicit = String(raw.id || "").trim().toLowerCase();
  // 显式写在 skin.json 里的 id 必须合法 —— 那是作者的声明，写错了要当场知道。
  if (explicit && !ID_RE.test(explicit)) {
    throw new ManifestError(
      `皮肤 id "${explicit}" 不合法：只允许小写字母、数字和连字符，且以字母或数字开头`, file);
  }
  const fromDir = String(dirName || "").trim().toLowerCase();
  const derived = !explicit && !ID_RE.test(fromDir);
  const id = explicit || (derived ? deriveId(dirName) : fromDir);
  if (!ID_RE.test(id)) {
    throw new ManifestError(`推不出合法的皮肤 id（目录名 "${dirName}"）`, file);
  }
  // 目录名是中文时，它就是用户心里这套皮肤的名字 —— 别把推出来的哈希 id 显示给他看。
  const name = String(raw.name || "").trim() || String(dirName || "").trim() || id;

  const appearance = APPEARANCES.has(raw.appearance) ? raw.appearance : DEFAULTS.appearance;
  // assets 目录必须留在皮肤目录内。写成 "../../.." 就能让宿主把任意目录当素材根，
  // 这是最便宜的一种越权，所以在解析阶段直接拒绝，不留给下游判断。
  const assets = String(raw.assets || DEFAULTS.assets).trim() || DEFAULTS.assets;
  if (path.isAbsolute(assets) || assets.split(/[\\/]/).includes("..")) {
    throw new ManifestError(`assets "${assets}" 必须是皮肤目录内的相对路径`, file);
  }

  return {
    ...DEFAULTS,
    ...raw,
    id,
    name,
    version: String(raw.version || DEFAULTS.version),
    tagline: String(raw.tagline || ""),
    author: String(raw.author || ""),
    license: String(raw.license || ""),
    homepage: String(raw.homepage || ""),
    tags: asArrayOfStrings(raw.tags),
    accent: String(raw.accent || ""),
    appearance,
    assets,
    preview: String(raw.preview || ""),
    requires: asArrayOfStrings(raw.requires),
    // 多背景：宿主把当前这张塞进 --dsh-backdrop，皮肤的 CSS 只认这个变量。
    // 这样"换一张图"不用重注整段样式 —— 重注会闪，改一个变量不会。
    // 调用方（界面 / 文档）可以据此提示"这套皮肤的 id 是从目录名推出来的"。
    derivedId: derived,
    backdrops: asArrayOfStrings(raw.backdrops)
      .filter((b) => !path.isAbsolute(b) && !b.split(/[\\/]/).includes("..")),
  };
}

module.exports = { normalizeManifest, deriveId, ManifestError, ID_RE, DEFAULTS };
