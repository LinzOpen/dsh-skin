"use strict";
/**
 * 设置的持久化。
 *
 * 写法是先写 .tmp 再改名 —— 这不是洁癖：状态文件会被多个窗口（工作室、每个外壳
 * 窗口）同时读，读到半个 JSON 会静默退回默认值，表现是"皮肤莫名其妙跳回第一套"，
 * 而且很难查，因为下一次读又正常了。
 */
const fs = require("node:fs");
const path = require("node:path");
const { STATE_FILE, USER_ROOT } = require("./paths");

const DEFAULTS = {
  skin: "midnight-harbor",
  appearance: "system",          // system | light | dark，只影响工作室预览
  shells: [],                    // [{url, title, skin}] 记住开过的外壳
  rotate: false,                 // 多背景皮肤是否轮播
  rotateMinutes: 60,
  cycle: [],                     // 当前这一轮还没用过的背景，走完才重洗
  cursor: 0,
  lastRotate: 0,
};

function read() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

function write(next) {
  const value = { ...DEFAULTS, ...next, updated: Date.now() };
  fs.mkdirSync(USER_ROOT, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return value;
}

function patch(delta) { return write({ ...read(), ...delta }); }

module.exports = { read, write, patch, DEFAULTS };
