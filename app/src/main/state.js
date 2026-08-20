"use strict";
/**
 * 设置。实现在 css-guard 的 home 里 —— 这里只是个薄壳，
 * 让主进程的调用点不用改，同时保证程序和命令行看到的是同一份状态、
 * 同一套取值范围校正、同一套坏文件隔离逻辑。
 */
const { home } = require("css-guard");

module.exports = {
  read: () => home.readState(),
  readDetailed: () => home.readStateDetailed(),
  write: (next) => home.writeState(next),
  patch: (delta) => home.patchState(delta),
  DEFAULTS: home.DEFAULTS,
};
