"use strict";
/**
 * 还原点。
 *
 * 要防的场景很具体：一个非技术用户 100% 靠 agent 操作这个程序，agent 在某一步
 * 把事情做坏了 —— 覆盖了他的皮肤、写乱了设置、装上一套让界面读不了的皮肤 ——
 * 然后 agent 自己也崩了。这时候他手上没有终端知识，也没有一个能问的人。
 *
 * 所以：
 *   · 每一次会改变现状的操作**之前**自动存一个还原点，不需要谁记得去存。
 *   · 还原点里带一句人话的说明，让他能认出"要回到哪一次"，而不是面对一串时间戳。
 *   · **恢复只写回、只补建，永远不删任何东西。** 如果恢复自己也会删文件，那它
 *     就是第二次事故，而这次连回退的余地都没有了。快照之后新增的皮肤会被原样留下，
 *     只在报告里列出来。
 *   · 只存文本（skin.json / skin.css / palette.json）。素材图不进快照：一张背景图
 *     可能几 MB，存三十个还原点就是几百 MB，而删素材这条路上有确认弹窗挡着。
 */

const fs = require("node:fs");
const path = require("node:path");
const home = require("./home");

const TEXT_FILES = ["skin.json", "skin.css", "palette.json"];
const MAX_TEXT_BYTES = 512 * 1024;      // 单个文件
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const KEEP = 30;

const stamp = (at) => new Date(at).toISOString().replace(/[:.]/g, "-");
const slug = (reason) => String(reason || "snapshot").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "snapshot";

/** 用户目录下所有皮肤的文本内容。内置皮肤不进快照 —— 它们跟着程序走，改不动也丢不了。 */
function captureSkins(env) {
  const p = home.paths(env);
  const out = {};
  let total = 0;
  let truncated = [];
  let dirs = [];
  try { dirs = fs.readdirSync(p.skins, { withFileTypes: true }); } catch { return { skins: out, truncated }; }
  for (const entry of dirs) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(p.skins, entry.name);
    const files = {};
    const assets = [];
    for (const name of TEXT_FILES) {
      const file = path.join(dir, name);
      try {
        const size = fs.statSync(file).size;
        if (size > MAX_TEXT_BYTES || total + size > MAX_SNAPSHOT_BYTES) { truncated.push(`${entry.name}/${name}`); continue; }
        files[name] = fs.readFileSync(file, "utf8");
        total += size;
      } catch { /* 没有这个文件是正常的 */ }
    }
    // 素材只记名字和大小 —— 用来在恢复时告诉用户"这些图当时还在，现在不在了"。
    try {
      for (const a of fs.readdirSync(path.join(dir, "assets"), { withFileTypes: true })) {
        if (!a.isFile() || a.name.startsWith(".")) continue;
        assets.push({ name: a.name, size: fs.statSync(path.join(dir, "assets", a.name)).size });
      }
    } catch { /* 没有 assets 目录是正常的 */ }
    if (Object.keys(files).length || assets.length) out[entry.name] = { files, assets };
  }
  return { skins: out, truncated };
}

/**
 * 存一个还原点。
 * @param {string} reason  机器读的原因，如 "apply-skin"
 * @param {string} label   给人看的一句话，如 "套用皮肤：午夜港湾"
 */
function snapshot(reason, label, env) {
  const p = home.ensureDirs(env);
  const at = Date.now();
  const { state } = home.readStateDetailed(env);
  const { skins, truncated } = captureSkins(env);
  const record = {
    version: 1,
    id: `${stamp(at)}-${slug(reason)}`,
    at: new Date(at).toISOString(),
    reason: String(reason || "snapshot"),
    label: String(label || reason || "还原点"),
    state,
    skins,
    truncated,
  };
  fs.writeFileSync(path.join(p.history, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  prune(KEEP, env);
  return record;
}

function list(env) {
  const p = home.paths(env);
  let files = [];
  try { files = fs.readdirSync(p.history).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(p.history, file), "utf8"));
      out.push({ id: record.id, at: record.at, reason: record.reason, label: record.label,
                 skins: Object.keys(record.skins || {}).length, skin: record.state?.skin });
    } catch {
      // 坏掉的还原点只作废自己。一个写坏的文件不该让"恢复"这条路整个不可用 ——
      // 那正好是最需要它的时候。
      out.push({ id: file.replace(/\.json$/, ""), at: null, reason: "unreadable", label: "（这个还原点读不出来）", skins: 0, broken: true });
    }
  }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

function read(id, env) {
  const p = home.paths(env);
  const file = path.join(p.history, `${path.basename(String(id))}.json`);
  if (!file.startsWith(p.history + path.sep)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function prune(keep = KEEP, env) {
  const p = home.paths(env);
  let files = [];
  try { files = fs.readdirSync(p.history).filter((f) => f.endsWith(".json")).sort(); } catch { return 0; }
  const drop = files.slice(0, Math.max(0, files.length - keep));
  for (const file of drop) { try { fs.rmSync(path.join(p.history, file)); } catch { /* 已经没了 */ } }
  return drop.length;
}

/**
 * 恢复到一个还原点。
 *
 * 只做三件事，一件都不涉及删除：
 *   写回设置 · 把快照里的文本文件写回去 · 把快照里有、现在没有的皮肤目录补建出来
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] 只报告不动手 —— agent 应该先跑这一次给用户看
 * @returns {{ok:boolean, error?:string, changes:Array, kept:Array, missingAssets:Array}}
 */
function restore(id, options = {}, env) {
  const { dryRun = false } = options;
  const record = read(id, env);
  if (!record) return { ok: false, error: `找不到还原点 ${id}`, changes: [], kept: [], missingAssets: [] };

  const p = home.paths(env);
  const changes = [];
  const missingAssets = [];

  for (const [skinId, entry] of Object.entries(record.skins || {})) {
    const dir = path.join(p.skins, skinId);
    const existed = fs.existsSync(dir);
    for (const [name, content] of Object.entries(entry.files || {})) {
      const file = path.join(dir, name);
      let current = null;
      try { current = fs.readFileSync(file, "utf8"); } catch { /* 不存在 */ }
      if (current === content) continue;
      changes.push({ action: current === null ? (existed ? "补回文件" : "补建皮肤") : "写回内容",
                     skin: skinId, file: name });
      if (dryRun) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, content);
    }
    for (const asset of entry.assets || []) {
      if (!fs.existsSync(path.join(dir, "assets", asset.name))) {
        missingAssets.push({ skin: skinId, name: asset.name, size: asset.size });
      }
    }
  }

  // 快照之后新增的皮肤：**留着**，只报告。恢复不该反过来变成第二次删除事故。
  const kept = [];
  try {
    for (const entry of fs.readdirSync(p.skins, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !(entry.name in (record.skins || {}))) {
        kept.push(entry.name);
      }
    }
  } catch { /* 目录还不存在 */ }

  if (!dryRun) {
    home.writeState(record.state, env);
    changes.push({ action: "写回设置", skin: null, file: "state.json" });
  } else {
    changes.push({ action: "写回设置（预演）", skin: null, file: "state.json" });
  }

  return { ok: true, id: record.id, label: record.label, at: record.at, changes, kept, missingAssets };
}

module.exports = { snapshot, list, read, restore, prune, KEEP, TEXT_FILES };
