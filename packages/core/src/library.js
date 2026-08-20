"use strict";
/**
 * 皮肤库：把若干个"装皮肤的目录"扫成一张表。
 *
 * 为什么是多个根而不是一个：内置皮肤跟着程序走（升级会被覆盖），用户自己的
 * 皮肤必须在用户目录里（升级不能动它）。两处合成一张表、后面的根覆盖前面的
 * 同名皮肤 —— 这样用户想改内置皮肤，只要在自己目录里放一个同 id 的就行，
 * 不用去动程序包，也不会在下次升级时丢掉。
 */

const fs = require("node:fs");
const path = require("node:path");
const { normalizeManifest, ManifestError } = require("./manifest");

const SKIN_CSS = "skin.css";
const SKIN_JSON = "skin.json";
/** 缩略图按这个顺序找第一个存在的。名字都是社区里已经在用的。 */
const PREVIEW_CANDIDATES = ["thumb.png", "thumb.webp", "preview.png", "preview-dark.png", "preview-light.png", "preview.webp"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** 一个目录是不是皮肤：有 skin.css 就算。skin.json 可以缺（用目录名当 id）。 */
function isSkinDir(dir) {
  try { return fs.statSync(path.join(dir, SKIN_CSS)).isFile(); } catch { return false; }
}

/**
 * 读一个皮肤目录。读不出来返回一个 broken 记录而不是抛异常 ——
 * 一套皮肤写坏了不该让整个皮肤库打不开，那是本机踩过的坑：
 * 一个装不上的皮肤把其余全部关掉了。
 */
function readSkin(dir, { source = "" } = {}) {
  const dirName = path.basename(dir);
  const cssFile = path.join(dir, SKIN_CSS);
  const jsonFile = path.join(dir, SKIN_JSON);
  let raw = {};
  if (fs.existsSync(jsonFile)) {
    try { raw = readJson(jsonFile); }
    catch (error) {
      return { id: dirName, dir, source, broken: true,
               error: `skin.json 解析失败：${error.message}` };
    }
  }
  let manifest;
  try { manifest = normalizeManifest(raw, dirName, jsonFile); }
  catch (error) {
    return { id: dirName, dir, source, broken: true,
             error: error instanceof ManifestError ? error.message : String(error) };
  }
  if (!fs.existsSync(cssFile)) {
    return { ...manifest, dir, source, broken: true, error: `缺少 ${SKIN_CSS}` };
  }
  const preview = manifest.preview && fs.existsSync(path.join(dir, manifest.preview))
    ? manifest.preview
    : PREVIEW_CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) || "";
  return { ...manifest, dir, source, broken: false, error: "", cssFile, preview };
}

/** 扫一个根目录下的所有皮肤。根不存在返回空数组，不抛。 */
function scanDir(root, { source = "" } = {}) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return names
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
    .map((e) => path.join(root, e.name))
    .filter(isSkinDir)
    .map((dir) => readSkin(dir, { source: source || root }));
}

/**
 * 扫多个根，后面的根覆盖前面的同 id 皮肤。
 * @param {string[]} roots
 * @returns {Array} 按显示名排序的皮肤表
 */
function scanLibrary(roots) {
  const byId = new Map();
  for (const root of roots) {
    for (const skin of scanDir(root)) byId.set(skin.id, skin);
  }
  return [...byId.values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
}

module.exports = { scanLibrary, scanDir, readSkin, isSkinDir, SKIN_CSS, SKIN_JSON, PREVIEW_CANDIDATES };
