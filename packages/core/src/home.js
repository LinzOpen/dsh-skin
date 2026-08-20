"use strict";
/**
 * 用户目录 + 设置的读写。
 *
 * 这一层刻意放在 core 而不是 app 里，因为**救援必须能在 GUI 打不开的时候进行**。
 * 如果只有 Electron 主进程知道设置长什么样，那么程序一旦起不来，用户和他的 agent
 * 就同时失去了唯一的入口 —— 这正是要防的场景。放在这里，命令行和程序读的是同一份
 * 实现，agent 用 `dsh-skin doctor --json` 看到的就是程序看到的。
 *
 * 三条硬规矩：
 *   1. 读永远不抛。设置文件坏了就退回默认值，而不是让调用方崩。
 *   2. 坏掉的设置文件先备份再覆盖。原来的写法是"读不出来就当默认值"，
 *      然后下一次 patch 就把用户攒了几个月的配置**静默写没了** —— 出问题的那一刻
 *      没有任何提示，等发现时已经无法还原。
 *   3. 写永远是原子的（写 .tmp 再改名）。多个窗口和命令行会同时读这个文件，
 *      读到半个 JSON 会退回默认值，表现是"皮肤莫名其妙跳回第一套"。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_DIRNAME = ".dsh-skin";

/** 设置的形状与取值范围。**range 不是洁癖，是防止一次坏写入把程序卡死** ——
 *  rotateMinutes 被写成 0 会让轮播每分钟都触发；写成字符串会让比较永远为假。 */
const SCHEMA = {
  skin: { type: "string", default: "midnight-harbor" },
  appearance: { type: "enum", values: ["system", "light", "dark"], default: "system" },
  shells: { type: "stringArray", default: [], max: 32 },
  rotate: { type: "boolean", default: false },
  rotateMinutes: { type: "number", default: 60, min: 1, max: 10080 },
  cycle: { type: "stringArray", default: [], max: 4096 },
  cursor: { type: "number", default: 0, min: 0, max: 4096 },
  lastRotate: { type: "number", default: 0, min: 0 },
  updated: { type: "number", default: 0, min: 0 },
};

const DEFAULTS = Object.fromEntries(
  Object.entries(SCHEMA).map(([key, spec]) => [key, Array.isArray(spec.default) ? [...spec.default] : spec.default]));

/**
 * 把任意一个值收进它该在的范围。收不进去就用默认值 ——
 * 返回 `{ value, repaired }`，调用方能知道哪几项被动过，好告诉用户。
 */
function coerce(key, raw) {
  const spec = SCHEMA[key];
  if (!spec) return { value: raw, repaired: false };
  const fallback = () => ({ value: Array.isArray(spec.default) ? [...spec.default] : spec.default, repaired: true });
  switch (spec.type) {
    case "string":
      return typeof raw === "string" ? { value: raw, repaired: false } : fallback();
    case "enum":
      return spec.values.includes(raw) ? { value: raw, repaired: false } : fallback();
    case "boolean":
      return typeof raw === "boolean" ? { value: raw, repaired: false } : fallback();
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback();
      const min = spec.min ?? -Infinity;
      const max = spec.max ?? Infinity;
      const clamped = Math.min(Math.max(raw, min), max);
      return { value: clamped, repaired: clamped !== raw };
    }
    case "stringArray": {
      if (!Array.isArray(raw)) return fallback();
      const clean = raw.filter((v) => typeof v === "string").slice(0, spec.max ?? 1024);
      return { value: clean, repaired: clean.length !== raw.length };
    }
    default:
      return { value: raw, repaired: false };
  }
}

function paths(env = process.env) {
  const root = env.DSH_SKIN_HOME || path.join(os.homedir(), DEFAULT_DIRNAME);
  return {
    root,
    skins: path.join(root, "skins"),
    state: path.join(root, "state.json"),
    history: path.join(root, "history"),
    safeMode: path.join(root, "SAFE_MODE"),
    bootLock: path.join(root, "boot.lock"),
    quarantine: path.join(root, "quarantine"),
  };
}

function ensureDirs(env) {
  const p = paths(env);
  fs.mkdirSync(p.skins, { recursive: true });
  fs.mkdirSync(p.history, { recursive: true });
  return p;
}

/**
 * 读设置。永不抛。
 * @returns {{state:object, repaired:string[], corrupt:string|null}}
 *   repaired —— 被收进范围或替换成默认值的字段名
 *   corrupt  —— 原文件读不出来时，它被备份到了哪里（null 表示文件正常）
 */
function readStateDetailed(env) {
  const p = paths(env);
  let raw = null;
  let corrupt = null;
  if (fs.existsSync(p.state)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p.state, "utf8"));
      raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      if (!raw) throw new Error("不是一个 JSON 对象");
    } catch {
      // 先备份再退回默认值。不备份的话，下一次写入就把它彻底盖掉了 ——
      // 而用户往往是在几天后才发现"我的设置没了"，那时候已经没得救。
      try {
        fs.mkdirSync(p.quarantine, { recursive: true });
        corrupt = path.join(p.quarantine, `state-${Date.now()}.json`);
        fs.copyFileSync(p.state, corrupt);
      } catch { corrupt = null; }
      raw = null;
    }
  }
  const state = {};
  const repaired = [];
  for (const key of Object.keys(SCHEMA)) {
    const result = coerce(key, raw ? raw[key] : undefined);
    state[key] = result.value;
    if (raw && key in raw && result.repaired) repaired.push(key);
  }
  return { state, repaired, corrupt };
}

const readState = (env) => readStateDetailed(env).state;

function writeState(next, env) {
  const p = ensureDirs(env);
  const clean = {};
  for (const key of Object.keys(SCHEMA)) clean[key] = coerce(key, next[key]).value;
  clean.updated = Date.now();
  const tmp = `${p.state}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`);
  fs.renameSync(tmp, p.state);
  return clean;
}

const patchState = (delta, env) => writeState({ ...readState(env), ...(delta || {}) }, env);

/* ── 安装信息 ────────────────────────────────────────────────────────────
   程序每次启动把"我装在哪、内置皮肤在哪、什么版本"写下来，命令行才看得见。
   没有这一步，`dsh-skin doctor` 在终端里跑会看不到内置皮肤，于是把
   "当前用的是内置皮肤 midnight-harbor" 误报成"这套皮肤不存在" ——
   一个把人引向错误方向的诊断，比没有诊断更糟。 */

function recordInstall(info, env) {
  const p = ensureDirs(env);
  try {
    fs.writeFileSync(path.join(p.root, "install.json"),
      `${JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2)}\n`);
  } catch { /* 写不进去不该让程序起不来 */ }
}

function readInstall(env) {
  try { return JSON.parse(fs.readFileSync(path.join(paths(env).root, "install.json"), "utf8")); }
  catch { return null; }
}

/* ── 安全模式 ────────────────────────────────────────────────────────────
   一个文件的存在与否就是开关。刻意做成文件而不是设置里的一个字段：
   出问题的时候设置文件本身可能就是坏的，而"有没有这个文件"这件事，
   任何程序、任何脚本、任何 agent，甚至用户在访达里都能判断和改变。 */

const safeModeOn = (env) => fs.existsSync(paths(env).safeMode);

function setSafeMode(on, reason, env) {
  const p = ensureDirs(env);
  if (!on) { try { fs.rmSync(p.safeMode, { force: true }); } catch { /* 本来就没有 */ } return false; }
  fs.writeFileSync(p.safeMode, `${JSON.stringify({ at: new Date().toISOString(), reason: reason || "手动开启" }, null, 2)}\n`);
  return true;
}

function safeModeInfo(env) {
  const p = paths(env);
  if (!fs.existsSync(p.safeMode)) return null;
  try { return JSON.parse(fs.readFileSync(p.safeMode, "utf8")); }
  catch { return { at: null, reason: "未知（标记文件内容读不出来，但安全模式仍然生效）" }; }
}

module.exports = {
  DEFAULT_DIRNAME, SCHEMA, DEFAULTS, coerce,
  paths, ensureDirs,
  readState, readStateDetailed, writeState, patchState,
  safeModeOn, setSafeMode, safeModeInfo,
  recordInstall, readInstall,
};
