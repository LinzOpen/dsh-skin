"use strict";
/**
 * 崩溃循环断路器 + 还原点的接线。
 *
 * 要防的是这个链条：agent 把某个东西改坏 → 程序一启动就死在界面出来之前 →
 * 用户看到的是"双击图标没反应" → 他没有终端知识，也没有能问的人，
 * 而他唯一会用的 agent 也已经不在了。
 *
 * 断路器的做法是最土也最可靠的一种：启动时先落一个标记，界面真的出来了才清掉。
 * 下一次启动如果发现标记还在，就说明上一次没走到界面。连续两次 —— 自动进安全模式，
 * 不套任何皮肤、不轮播。用户不需要做任何事，双击第三次就能进去。
 *
 * 为什么阈值是 2 而不是 1：机器休眠、强制退出、装系统更新的时候杀进程，都会留下
 * 一个假阳性的标记。一次就进安全模式会把正常使用的人也吓到。
 */

const fs = require("node:fs");
const { home, history } = require("@dsh-skin/core");

const FAIL_THRESHOLD = 2;

/**
 * 在 app ready 之前调用。返回这次是不是要以安全模式启动。
 */
function beginBoot() {
  const p = home.ensureDirs();
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(p.bootLock, "utf8")); } catch { /* 没有标记 = 上次是好的 */ }

  const fails = previous ? (previous.fails || 0) + 1 : 0;
  let tripped = false;
  if (fails >= FAIL_THRESHOLD && !home.safeModeOn()) {
    home.setSafeMode(true, `连续 ${fails} 次启动没走到界面就退出了`);
    tripped = true;
  }
  try {
    fs.writeFileSync(p.bootLock, `${JSON.stringify({ at: new Date().toISOString(), fails }, null, 2)}\n`);
  } catch { /* 写不进去就算了，不能因为写不了标记而起不来 */ }

  return { safeMode: home.safeModeOn(), tripped, fails };
}

/** 界面真的出来了。清掉标记，这次启动算成功。 */
function bootSucceeded() {
  try { fs.rmSync(home.paths().bootLock, { force: true }); } catch { /* 本来就没有 */ }
}

/**
 * 改动之前存一个还原点。
 * 存不下来**不能**阻止操作本身 —— 那会让"磁盘满了"变成"程序什么都干不了"。
 * 但要把失败说出来，否则用户会以为自己有后路，其实没有。
 */
function checkpoint(reason, label) {
  try { return { ok: true, record: history.snapshot(reason, label) }; }
  catch (error) { return { ok: false, error: error.message }; }
}

module.exports = { beginBoot, bootSucceeded, checkpoint, FAIL_THRESHOLD };
