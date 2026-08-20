"use strict";
/**
 * 皮肤库 + 套用 + 多背景轮播。
 *
 * 套用这件事被刻意做成"排队执行"（见 applyTo）。原因是本机踩过：
 * 页面加载完成的自动套用和用户手点的切换会并发跑，两边各自读写"当前皮肤"，
 * 谁先读到旧值谁后写入新值是不确定的 —— 实测结果是上一套皮肤的 CSS 永久留在
 * 页面里：亮色拿到了新配色却还铺着旧背景。排队就没有这条缝。
 */
const fs = require("node:fs");
const path = require("node:path");
const core = require("@dsh-skin/core");
const { skinRoots } = require("./paths");

let cache = null;

/** 皮肤表。带缓存，因为渲染进程会频繁问；改了皮肤要 invalidate()。 */
function list() {
  if (!cache) cache = core.scanLibrary(skinRoots());
  return cache;
}
function invalidate() { cache = null; }
function find(id) { return list().find((s) => s.id === id) || null; }

/** 素材前缀。每个宿主自己决定怎么取图，这里用 App 注册的自定义协议。 */
const assetBase = (id) => `dshskin://skin/${id}`;

/**
 * 读一套皮肤的 CSS：换掉 __SKIN__、跑一遍检查。
 * 有 error 就返回 null —— 带远程 URL 的皮肤**不给套用**，用户点"仍然套用"也不给。
 * 这条如果留了后门，整个检查器就只是装饰。
 */
function compile(id) {
  const skin = find(id);
  if (!skin || skin.broken) return { css: null, report: null, skin };
  const raw = fs.readFileSync(skin.cssFile, "utf8");
  const report = core.validateCss(raw, { dir: skin.dir, assetsDir: skin.assets });
  if (!report.ok) return { css: null, report, skin };
  let css = core.resolveCss(raw, assetBase(id));
  // 多背景皮肤：把当前这张塞进变量。皮肤 CSS 里写 var(--dsh-backdrop)。
  const backdrop = currentBackdrop(skin);
  if (backdrop) css += `\n:root { --dsh-backdrop: url("${assetBase(id)}/${backdrop}"); }\n`;
  return { css, report, skin };
}

/* ── 轮播：一轮不重复 ─────────────────────────────────────────────
   洗一副牌，走完整副才重洗。用"每分钟查一次"而不是设一个一小时的 timeout：
   机器睡一觉之后 timeout 未必还在，而错过的那一格下一分钟就补上了。 */

const state = require("./state");

function newCycle(skin) {
  const ids = [...skin.backdrops];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/**
 * 当前该显示哪一张。
 *
 * 只要牌堆里有牌就照着牌堆走，**不管轮播开没开**。原先这里写的是
 * `if (!s.rotate) return backdrops[0]`，结果是：关闭轮播时点「换下一张背景」，
 * advance() 老老实实把游标推进了一格，而这里根本不看游标 —— 按钮点了没反应，
 * 而按钮只要皮肤有超过一张背景就显示。手动换和自动轮播是两回事，
 * 前者不该被后者的开关关掉。
 */
function currentBackdrop(skin) {
  if (!skin.backdrops.length) return "";
  const s = state.read();
  const pick = s.cycle[s.cursor];
  return skin.backdrops.includes(pick) ? pick : skin.backdrops[0];
}

/** 推进一格。force 忽略间隔（用于「换下一张」）。返回是否真的换了。 */
function advance(id, force) {
  const skin = find(id);
  if (!skin || skin.backdrops.length < 2) return false;
  const s = state.read();
  const now = Date.now();
  // 自动推进要看间隔；手动（force）不看 —— 用户点了就得换。
  if (!force && !s.rotate) return false;
  if (!force && now - (s.lastRotate || 0) < s.rotateMinutes * 60000) return false;

  const before = currentBackdrop(skin);
  let cycle = s.cycle;
  let cursor = s.cursor + 1;
  // 洗过的牌里可能有已经被删掉的图 —— 素材增删之后旧周期会留下空号
  const stale = !cycle.length || !cycle.every((b) => skin.backdrops.includes(b));
  if (stale || cursor >= cycle.length) { cycle = newCycle(skin); cursor = 0; }

  // 洗完牌第一张正好就是现在这张，是很常见的情况 —— 只有两张背景时有一半的概率。
  // 不处理的话「换下一张」点了等于没换，而且没有任何报错，用户只会觉得按钮坏了。
  // 这条是在 Linux 容器里跑测试才暴露的：同一份代码在 macOS 上连过十几次，
  // 因为随机数恰好没抽到那一半。
  if (cycle[cursor] === before) {
    cursor += 1;
    if (cursor >= cycle.length) {
      cycle = newCycle(skin);
      cursor = cycle[0] === before ? 1 : 0;
    }
  }

  state.patch({ cycle, cursor, lastRotate: now });
  return true;
}

module.exports = { list, invalidate, find, compile, assetBase, advance, currentBackdrop };
