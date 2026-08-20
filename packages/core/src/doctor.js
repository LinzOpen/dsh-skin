"use strict";
/**
 * 体检：把"现在到底什么状况"变成一份既能给人读、也能给 agent 读的结构化结果。
 *
 * 为什么它必须是命令行能跑的：出事的时候程序可能打不开，而这时候用户手上唯一
 * 还能动的东西就是他的下一个 agent。如果"现状"只能从 GUI 里看，那么 GUI 一坏，
 * 人和 agent 就同时失明了。
 *
 * 每一条结论都带 `fix` —— 一条能直接执行的命令。不带修复建议的诊断对一个
 * 非技术用户等于没有：他知道"坏了"，但下一步还是只能去问人。
 */

const fs = require("node:fs");
const path = require("node:path");
const home = require("./home");
const history = require("./history");
const { scanLibrary, isSkinDir, readSkin } = require("./library");
const { validateCss } = require("./validate");

const check = (id, level, title, detail, fix = null) => ({ id, level, title, detail, fix });

/**
 * @param {object} [options]
 * @param {string[]} [options.builtinRoots] 内置皮肤目录（程序传进来；命令行没有）
 * @returns {{ok:boolean, level:string, checks:Array, summary:object}}
 */
function diagnose(options = {}, env) {
  const p = home.paths(env);
  const checks = [];
  // 程序启动时会把内置皮肤目录记在 install.json 里。命令行读得到它，就能看到
  // 和程序一样的皮肤库；读不到就得**说出来**，而不是假装内置皮肤不存在。
  const install = home.readInstall(env);
  const builtinRoots = options.builtinRoots
    || (install && install.builtinSkins ? [install.builtinSkins] : []);
  const knowsBuiltin = builtinRoots.length > 0 && builtinRoots.some((r) => { try { return fs.existsSync(r); } catch { return false; } });

  /* 1 · 目录在不在、写不写得进去 */
  let writable = false;
  try {
    fs.mkdirSync(p.skins, { recursive: true });
    const probe = path.join(p.root, ".write-probe");
    fs.writeFileSync(probe, "x");
    fs.rmSync(probe);
    writable = true;
    checks.push(check("home", "ok", "用户目录可读写", p.root));
  } catch (error) {
    checks.push(check("home", "error", "用户目录写不进去", `${p.root}：${error.message}`,
      { command: null, description: "这通常是权限或磁盘满了。程序本身修不了，需要在系统里处理。" }));
  }

  /* 2 · 设置 */
  const detailed = home.readStateDetailed(env);
  if (detailed.corrupt) {
    checks.push(check("state", "warn", "设置文件坏了，已隔离", 
      `坏掉的那份备份在 ${detailed.corrupt}；当前用的是默认设置。`,
      { command: "css-guard undo", description: "想找回之前的设置，用还原点恢复。" }));
  } else if (detailed.repaired.length) {
    checks.push(check("state", "warn", "设置里有几项超出范围，已收拢",
      `被改回合法值的字段：${detailed.repaired.join("、")}`, null));
  } else {
    checks.push(check("state", "ok", "设置正常", `当前皮肤：${detailed.state.skin}`));
  }

  /* 3 · 安全模式 */
  const safe = home.safeModeInfo(env);
  if (safe) {
    checks.push(check("safe-mode", "warn", "正处在安全模式", 
      `原因：${safe.reason}${safe.at ? `（${safe.at}）` : ""}。程序会以不套任何皮肤的状态启动。`,
      { command: "css-guard safe-mode off", description: "确认问题解决后关掉它。" }));
  } else {
    checks.push(check("safe-mode", "ok", "不在安全模式", ""));
  }

  /* 4 · 连续启动失败 */
  let bootFails = 0;
  try { bootFails = JSON.parse(fs.readFileSync(p.bootLock, "utf8")).fails || 0; } catch { /* 没有就是没有 */ }
  if (bootFails > 0) {
    checks.push(check("boot", "warn", `上一次启动没走完（累计 ${bootFails} 次）`,
      "程序启动到界面出来之前就退出了。连续两次就会自动进安全模式。",
      { command: "css-guard safe-mode on", description: "先进安全模式，排除是某套皮肤引起的。" }));
  } else {
    checks.push(check("boot", "ok", "上一次启动是正常结束的", ""));
  }

  /* 5 · 皮肤库 */
  const roots = [...builtinRoots, p.skins];
  const skins = scanLibrary(roots);
  const broken = skins.filter((s) => s.broken);
  if (!knowsBuiltin) {
    checks.push(check("install", "warn", "还没见过程序启动",
      "内置皮肤在程序包里，命令行看不到。下面关于皮肤的结论只覆盖你自己目录里的那些。",
      { command: null, description: "把程序打开一次，它会记下自己装在哪，之后 doctor 就完整了。" }));
  } else {
    checks.push(check("install", "ok", "找得到程序的内置皮肤",
      `${install ? install.builtinSkins : builtinRoots[0]}`));
  }

  if (broken.length) {
    checks.push(check("skins-broken", "warn", `${broken.length} 套皮肤读不出来`,
      broken.map((s) => `${s.id}：${s.error}`).join("；"),
      { command: "css-guard validate ~/.css-guard/skins", description: "逐套看具体是哪里坏了。" }));
  } else {
    checks.push(check("skins-broken", "ok", `${skins.length} 套皮肤都读得出来`, ""));
  }

  /* 6 · 每套皮肤的检查器结论 */
  const blocked = [];
  for (const skin of skins) {
    if (skin.broken) continue;
    try {
      const report = validateCss(fs.readFileSync(skin.cssFile, "utf8"), { dir: skin.dir, assetsDir: skin.assets });
      if (!report.ok) blocked.push({ id: skin.id, why: report.findings.filter((f) => f.severity === "error").map((f) => f.message) });
    } catch (error) { blocked.push({ id: skin.id, why: [error.message] }); }
  }
  if (blocked.length) {
    checks.push(check("skins-blocked", "warn", `${blocked.length} 套皮肤被检查器拦住，套不上`,
      blocked.map((b) => `${b.id}：${b.why.join("、")}`).join("；"),
      { command: "css-guard validate ~/.css-guard/skins", description: "拦住是对的 —— 这些皮肤会访问网络或引用了不存在的素材。" }));
  } else {
    checks.push(check("skins-blocked", "ok", "所有皮肤都通过了检查", ""));
  }

  /* 7 · 当前选中的皮肤到底能不能用 —— 这是"点了没反应"最常见的真因 */
  const current = detailed.state.skin;
  if (current && current !== "none") {
    const found = skins.find((s) => s.id === current);
    if (!found && !knowsBuiltin) {
      // 从终端跑、而程序还没启动过一次的情况。别断言皮肤不见了 ——
      // 它多半是程序包里的内置皮肤，只是这里看不到。
      checks.push(check("current-skin", "warn", `看不到选中的皮肤 ${current}，但这不一定是问题`,
        "找不到内置皮肤目录（程序还没启动过，或者是从终端单独跑的命令行）。"
        + `${current} 很可能是内置皮肤，程序自己看得到。`,
        { command: null, description: "先把程序打开一次，再跑一次 doctor 就准了。" }));
    } else if (!found) {
      checks.push(check("current-skin", "error", `选中的皮肤 ${current} 不存在`,
        "程序会显示成没有皮肤。多半是这套皮肤被删了或改了名字。",
        { command: "css-guard undo", description: "回到删掉它之前的那个还原点。" }));
    } else if (blocked.some((b) => b.id === current)) {
      checks.push(check("current-skin", "error", `选中的皮肤 ${current} 被检查器拦着`,
        "它不会被注入任何窗口 —— 表现就是「换了皮肤但界面没变」。",
        { command: "css-guard validate ~/.css-guard/skins/" + current, description: "看拦它的是哪一条。" }));
    } else {
      checks.push(check("current-skin", "ok", `选中的皮肤 ${current} 可以套用`, ""));
    }
  } else {
    checks.push(check("current-skin", "ok", "当前没有套皮肤", ""));
  }

  /* 8 · 还原点 */
  const points = history.list(env);
  const usable = points.filter((r) => !r.broken);
  if (!usable.length) {
    checks.push(check("history", "warn", "一个还原点都没有",
      "还没有做过任何会改变现状的操作，或者还原点被清掉了。出事时没得回退。",
      { command: "css-guard snapshot -m \"手动存档\"", description: "现在存一个，作为已知可用的基线。" }));
  } else {
    checks.push(check("history", "ok", `有 ${usable.length} 个还原点`,
      `最近的一个：${usable[0].label}（${usable[0].at}）`));
  }

  const level = checks.some((c) => c.level === "error") ? "error"
    : checks.some((c) => c.level === "warn") ? "warn" : "ok";

  return {
    ok: level !== "error",
    level,
    checks,
    summary: {
      root: p.root, writable, safeMode: Boolean(safe), bootFails,
      skins: skins.length, brokenSkins: broken.length, blockedSkins: blocked.length,
      currentSkin: current, restorePoints: usable.length,
    },
  };
}

/**
 * 只做**安全**的自动修复。安全的定义：不删任何用户数据，且每一步都说得出改了什么。
 * 真正有损的动作（删皮肤、清历史）永远留给人和 agent 显式去做。
 */
function repair(options = {}, env) {
  const report = diagnose(options, env);
  const done = [];

  const current = report.summary.currentSkin;
  const bad = report.checks.find((c) => c.id === "current-skin" && c.level === "error");
  if (bad) {
    // 换成"不套皮肤"而不是随便挑一套：随便挑会让用户以为自己的皮肤还在，
    // 只是长得不一样了 —— 那比明摆着没有皮肤更难查。
    home.patchState({ skin: "none" }, env);
    done.push({ action: "把当前皮肤切成「不套皮肤」", detail: `原来选的是 ${current}，它现在用不了。` });
  }

  const stateCheck = report.checks.find((c) => c.id === "state");
  if (stateCheck && stateCheck.level === "warn" && stateCheck.title.includes("超出范围")) {
    home.patchState({}, env);   // 读→收拢→写回
    done.push({ action: "把设置里越界的字段写回合法值", detail: stateCheck.detail });
  }

  return { done, after: diagnose(options, env) };
}

module.exports = { diagnose, repair };
