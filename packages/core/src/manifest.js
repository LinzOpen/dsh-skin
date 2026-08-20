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
function normalizeManifest(raw, dirName, file) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("skin.json 必须是一个 JSON 对象", file);
  }
  const id = String(raw.id || dirName || "").trim().toLowerCase();
  if (!ID_RE.test(id)) {
    throw new ManifestError(
      `皮肤 id "${id}" 不合法：只允许小写字母、数字和连字符，且以字母或数字开头`, file);
  }
  const name = String(raw.name || "").trim() || id;

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
    backdrops: asArrayOfStrings(raw.backdrops)
      .filter((b) => !path.isAbsolute(b) && !b.split(/[\\/]/).includes("..")),
  };
}

module.exports = { normalizeManifest, ManifestError, ID_RE, DEFAULTS };
