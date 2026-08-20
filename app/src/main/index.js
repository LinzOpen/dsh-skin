"use strict";
/**
 * css-guard —— 主进程。
 *
 * 一个窗口装两件事：
 *   工作室 —— 挑皮肤、实时预览、跑检查、导入素材、新建皮肤。
 *             预览用的是内置的假界面，所以**不需要装任何别的软件**就能看到皮肤生效。
 *   外壳   —— 填一个网址，把那个界面装进一个带皮肤的窗口。
 *
 * 这两件事共用同一个皮肤库和同一个检查器；分开的只有"皮肤铺在谁身上"。
 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell: electronShell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const core = require("css-guard");

const paths = require("./paths");
const state = require("./state");
const skins = require("./skins");
const proto = require("./protocol");
const shellMode = require("./shell");
const { importImages } = require("./importer");
const recovery = require("./recovery");
const rescueScripts = require("./rescue-scripts");

// 必须在 ready 之前。放到 whenReady 里注册会静默不生效，表现是所有素材 404。
proto.registerScheme();

/* ── 急救模式 ──────────────────────────────────────────────────────────
   用户从 ~/.css-guard/急救/ 里双击进来的。做完打印、立刻退出，不开任何窗口。
   为什么要在程序里做而不是让脚本去调命令行：一个不写代码的用户机器上多半没有
   Node，`npx css-guard-cli` 跑不起来。而这个程序本身就是他已经装好的运行时。 */
const RECOVERY_FLAG = "--recovery=";
const recoveryArg = process.argv.find((a) => a.startsWith(RECOVERY_FLAG));
if (recoveryArg) {
  runRescue(recoveryArg.slice(RECOVERY_FLAG.length));
}

function runRescue(action) {
  const say = (line = "") => process.stdout.write(`${line}\n`);
  const mark = { ok: "✓", warn: "!", error: "✗" };
  try {
    if (action === "doctor") {
      const report = core.doctor.diagnose({ builtinRoots: [paths.builtinSkins()] });
      say("css-guard 体检\n");
      for (const c of report.checks) {
        say(`  ${mark[c.level]} ${c.title}`);
        if (c.detail) say(`      ${c.detail}`);
        if (c.fix && c.fix.description) say(`      → ${c.fix.description}`);
      }
      const bad = report.checks.filter((c) => c.level !== "ok").length;
      say(`\n${bad ? `${bad} 处需要处理。下一步：双击「2 回到上一个正常状态」看看它打算改什么。`
                    : "一切正常，不需要做任何事。"}`);
    } else if (action === "undo" || action === "undo-yes") {
      const points = core.history.list().filter((r) => !r.broken);
      if (!points.length) { say("还没有还原点 —— 没得退。"); process.exit(0); }
      const target = points[0].id;
      if (action === "undo") {
        const dry = core.history.restore(target, { dryRun: true });
        say(`打算回到：${dry.label}（${dry.at}）\n`);
        for (const c of dry.changes) say(`  · ${c.action} ${c.skin ? `${c.skin}/` : ""}${c.file}`);
        if (dry.missingAssets.length) say(`\n  注意：有 ${dry.missingAssets.length} 张背景图当时在、现在不在了，找不回来。`);
        if (dry.kept.length) say(`\n  那之后新增的会原样保留（回退不删东西）：${dry.kept.join("、")}`);
        say("\n以上还没有真的执行。觉得没问题就双击「3 确认回退」。");
      } else {
        recovery.checkpoint("before-undo", "回退之前的状态");
        const result = core.history.restore(target);
        say(result.ok ? `已回到「${result.label}」，改了 ${result.changes.length} 处。\n现在可以打开 css-guard 了。`
                      : `没成功：${result.error}`);
      }
    } else if (action === "safe-on" || action === "safe-off") {
      core.home.setSafeMode(action === "safe-on", "从急救文件里点的");
      say(action === "safe-on"
        ? "已设置：下次启动不套任何皮肤。\n你的皮肤一套都没丢，只是暂时不生效。现在去打开 css-guard。"
        : "已恢复正常启动，皮肤会重新生效。");
    } else {
      say(`不认识的急救动作：${action}`);
    }
  } catch (error) {
    say(`急救本身出错了：${error.message}`);
    say("把这段文字整个发给任何一个 AI 助手，它能看懂。");
  }
  process.exit(0);
}

// 也必须在 ready 之前：要在做任何事之前知道上一次启动有没有走完。
const boot = recovery.beginBoot();

let studio = null;
let rotateTimer = null;

/* ── 窗口 ───────────────────────────────────────────────────────────── */

function openStudio() {
  if (studio && !studio.isDestroyed()) { studio.show(); studio.focus(); return studio; }
  studio = new BrowserWindow({
    width: 1240, height: 840, minWidth: 900, minHeight: 620,
    title: "css-guard", backgroundColor: "#10131c",
    // 冒烟测试要在不弹窗的情况下把整条启动路径跑一遍。除此之外它永远是可见的。
    show: !process.env.CSS_GUARD_HEADLESS,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  studio.loadURL("cssguard://app/index.html");
  // 界面出来了 = 这次启动是好的。清掉断路器的标记。
  studio.webContents.once("did-finish-load", () => recovery.bootSucceeded());
  studio.on("closed", () => { studio = null; });
  return studio;
}

const notify = (channel, payload) => {
  if (studio && !studio.isDestroyed()) studio.webContents.send(channel, payload);
};

/* ── 轮播 ───────────────────────────────────────────────────────────────
   每分钟查一次，而不是设一个"一小时后触发"的 timeout：机器睡一觉之后
   timeout 未必还在，而错过的那一格下一分钟就补上了。 */

function scheduleRotation() {
  if (rotateTimer) clearInterval(rotateTimer);
  if (core.home.safeModeOn()) return;      // 安全模式下什么都不自动做
  if (!state.read().rotate) return;
  rotateTimer = setInterval(() => {
    const id = state.read().skin;
    if (!skins.advance(id, false)) return;
    shellMode.applyAll(id);
    notify("skin:changed", { id, reason: "rotate" });
  }, 60 * 1000);
}

/* ── 菜单 ───────────────────────────────────────────────────────────── */

function buildMenu() {
  const current = state.read().skin;
  const list = skins.list().filter((s) => !s.broken);
  const isMac = process.platform === "darwin";

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "皮肤",
      submenu: [
        ...list.map((s) => ({
          label: s.name, type: "radio", checked: current === s.id,
          click: () => selectSkin(s.id),
        })),
        { type: "separator" },
        { label: "不套皮肤", type: "radio", checked: current === "none", click: () => selectSkin("none") },
        { type: "separator" },
        { label: "换下一张背景", accelerator: "CmdOrCtrl+Shift+N", click: () => {
          const id = state.read().skin;
          if (skins.advance(id, true)) { shellMode.applyAll(id); notify("skin:changed", { id, reason: "manual" }); }
        } },
        { label: "重新扫描皮肤库", accelerator: "CmdOrCtrl+R", click: () => refreshLibrary() },
        { label: "打开我的皮肤目录", click: () => electronShell.openPath(paths.ensureUserDirs()) },
      ],
    },
    {
      // 菜单里也要有一份。界面可能因为任何原因不好用，而菜单是 Electron 自己画的，
      // 不依赖渲染进程 —— 渲染进程整个白屏时，这里还点得动。
      label: "恢复",
      submenu: [
        { label: "恢复中心…", accelerator: "CmdOrCtrl+Shift+H", click: () => {
          openStudio();
          notify("recovery:open", null);
        } },
        { label: "现在存一个还原点", click: () => {
          const point = recovery.checkpoint("manual", "手动存档");
          dialog.showMessageBox({ type: point.ok ? "info" : "error",
            message: point.ok ? "已存下还原点" : "存不下来",
            detail: point.ok ? point.record.label : point.error });
        } },
        { type: "separator" },
        { label: "安全模式（不套任何皮肤）", type: "checkbox", checked: core.home.safeModeOn(),
          click: async (item) => {
            core.home.setSafeMode(item.checked, "在菜单里手动开启");
            await shellMode.applyAll(item.checked ? "none" : state.read().skin);
            scheduleRotation();
            buildMenu();
            notify("skin:changed", { id: state.read().skin, reason: "safe-mode" });
          } },
        { label: "打开我的 css-guard 目录", click: () => electronShell.openPath(paths.USER_ROOT) },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "工作室", accelerator: "CmdOrCtrl+1", click: () => openStudio() },
        { type: "separator" },
        ...(isMac ? [{ role: "close" }, { role: "minimize" }] : [{ role: "close" }]),
        { role: "toggleDevTools" },
      ],
    },
    { role: "editMenu" },
    {
      label: "帮助",
      submenu: [
        { label: "皮肤格式说明", click: () => electronShell.openExternal("https://github.com/LinzOpen/css-guard/blob/main/docs/skin-format.md") },
        { label: "项目主页", click: () => electronShell.openExternal("https://github.com/LinzOpen/css-guard") },
      ],
    },
  ]));
}

/** 一个目录是不是真的在用户皮肤目录**之内**（而不是只是名字前缀相同）。 */
function isUnderUserSkins(dir) {
  const root = paths.USER_SKINS;
  return dir === root || dir.startsWith(root + path.sep);
}

function refreshLibrary() {
  skins.invalidate();
  buildMenu();
  notify("library:changed", skins.list());
}

async function selectSkin(id) {
  // 改之前先存还原点。这是整个救援机制的地基：出事之后能回到哪里，
  // 取决于出事之前有没有人替用户存过 —— 不能指望用户或 agent 记得。
  recovery.checkpoint("apply-skin", `套用皮肤：${skins.find(id)?.name || id}`);
  state.patch({ skin: id, cycle: [], cursor: 0 });
  if (!core.home.safeModeOn()) await shellMode.applyAll(id);
  buildMenu();
  notify("skin:changed", { id, reason: "select" });
}

/* ── 渲染进程能调的一切 ───────────────────────────────────────────────── */

function registerIpc() {
  ipcMain.handle("state:read", () => state.read());
  ipcMain.handle("state:patch", (_e, delta) => {
    const next = state.patch(delta || {});
    if ("rotate" in (delta || {}) || "rotateMinutes" in (delta || {})) scheduleRotation();
    return next;
  });

  ipcMain.handle("skins:list", () => skins.list());
  ipcMain.handle("skins:refresh", () => { refreshLibrary(); return skins.list(); });
  ipcMain.handle("skins:select", (_e, id) => selectSkin(id));
  /** 手动推进一格。返回 false 表示这套皮肤只有一张背景，没得换。 */
  ipcMain.handle("skins:next", async (_e, id) => {
    if (!skins.advance(id, true)) return false;
    await shellMode.applyAll(id);
    return true;
  });

  /** 预览拿的是"已经解析好素材前缀、但**没有**被检查拦下"的 CSS。
   *  拦下的皮肤照样要能在工作室里看到它长什么样 —— 否则作者没法边改边看。
   *  拦的是"套用到别人界面上"，不是"看"。 */
  ipcMain.handle("skins:preview", (_e, id) => {
    const skin = skins.find(id);
    if (!skin || skin.broken) return { css: "", report: null, skin };
    const raw = fs.readFileSync(skin.cssFile, "utf8");
    const report = core.validateCss(raw, { dir: skin.dir, assetsDir: skin.assets });
    let css = core.resolveCss(raw, skins.assetBase(id));
    const backdrop = skins.currentBackdrop(skin);
    if (backdrop) css += `\n:root { --skin-backdrop: url("${skins.assetBase(id)}/${backdrop}"); }\n`;
    return { css, report, skin };
  });

  ipcMain.handle("skins:reveal", (_e, id) => {
    const skin = skins.find(id);
    if (skin) electronShell.showItemInFolder(skin.cssFile || skin.dir);
    return Boolean(skin);
  });

  ipcMain.handle("skins:new", (_e, name) => {
    const { slugify } = require("./importer");
    const id = slugify(name);
    const dir = path.join(paths.ensureUserDirs(), id);
    if (fs.existsSync(dir)) return { ok: false, error: `已经有一套叫 ${id} 的皮肤了` };
    recovery.checkpoint("new-skin", `新建皮肤：${name || id}`);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "skin.json"), `${JSON.stringify({
      id, name: name || id, version: "0.1.0", tagline: "", author: "", license: "CC0-1.0",
      tags: [], accent: "#7f9bff", appearance: "both",
    }, null, 2)}\n`);
    fs.copyFileSync(path.join(__dirname, "..", "renderer", "template.css"), path.join(dir, "skin.css"));
    refreshLibrary();
    return { ok: true, id, dir };
  });

  ipcMain.handle("skins:import", async (_e, name) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "选择背景图片（可多选；多选会变成一套可轮播的皮肤）",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (canceled || !filePaths.length) return { ok: false, cancelled: true };
    recovery.checkpoint("import-images", `导入素材：${name || "未命名"}（${filePaths.length} 张）`);
    const result = importImages(filePaths, { name });
    if (result.ok) refreshLibrary();
    return result;
  });

  ipcMain.handle("skins:delete", async (_e, id) => {
    const skin = skins.find(id);
    if (!skin) return { ok: false, error: "找不到这套皮肤" };
    // 内置皮肤在程序包里，删了下次升级又回来，而且用户会以为删失败了。
    // 带上分隔符再比：不带的话 ~/.css-guard/skinsXXX/foo 也会 startsWith 成功，
    // 于是一个不在用户目录里的皮肤被当成可删的。
    if (!isUnderUserSkins(skin.dir)) {
      return { ok: false, error: "这是内置皮肤，删不掉。想改它就在自己的皮肤目录里放一套同 id 的，它会覆盖内置那套。" };
    }
    const { response } = await dialog.showMessageBox({
      type: "warning", buttons: ["删除", "取消"], defaultId: 1, cancelId: 1,
      message: `删除「${skin.name}」？`,
      detail: `会删掉整个目录：${skin.dir}\n这一步不能撤销。`,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    // 删除是唯一一个还原点救不回全部内容的操作（素材图不进快照），
    // 所以快照失败时要直接拦下来，而不是"存不上也照删"。
    const point = recovery.checkpoint("delete-skin", `删除皮肤：${skin.name}`);
    if (!point.ok) {
      return { ok: false, error: `存还原点失败，已取消删除：${point.error}` };
    }
    fs.rmSync(skin.dir, { recursive: true, force: true });
    if (state.read().skin === id) state.patch({ skin: "none" });
    refreshLibrary();
    return { ok: true };
  });

  ipcMain.handle("shell:open", (_e, url) => {
    const clean = String(url || "").trim();
    if (!/^https?:\/\//i.test(clean)) return { ok: false, error: "网址要以 http:// 或 https:// 开头" };
    const s = state.read();
    // 安全模式下外壳照开，但不套皮肤 —— 用户还能用那个界面，
    // 只是没有皮肤。开不开得起来和皮肤有没有问题是两件事。
    const skinForShell = core.home.safeModeOn() ? "none" : s.skin;
    shellMode.open(clean, skinForShell, () => notify("shell:changed", shellMode.all().map(([u]) => u)));
    const shells = [...new Set([clean, ...s.shells])].slice(0, 12);
    state.patch({ shells });
    notify("shell:changed", shellMode.all().map(([u]) => u));
    return { ok: true, url: clean };
  });
  ipcMain.handle("shell:list", () => ({
    open: shellMode.all().map(([u]) => u),
    recent: state.read().shells,
  }));
  ipcMain.handle("shell:forget", (_e, url) => {
    const shells = state.read().shells.filter((u) => u !== url);
    state.patch({ shells });
    return shells;
  });

  /* ── 救援 ────────────────────────────────────────────────────────────
     这一组必须在程序还能打开的时候可用；程序打不开时，同样的能力在
     `css-guard doctor / undo / safe-mode` 里，读写的是同一批文件。 */
  ipcMain.handle("recovery:status", () => ({
    ...core.doctor.diagnose({ builtinRoots: [paths.builtinSkins()] }),
    boot,
    safeMode: core.home.safeModeInfo(),
  }));
  ipcMain.handle("recovery:history", () => core.history.list());
  ipcMain.handle("recovery:preview", (_e, id) => core.history.restore(id, { dryRun: true }));
  ipcMain.handle("recovery:restore", async (_e, id) => {
    // 恢复之前先给"恢复之前的样子"也存一个还原点 —— 万一恢复到的是更早的一个错版本，
    // 用户还能再退回来。没有这一步，恢复本身就成了一条单行道。
    recovery.checkpoint("before-restore", "恢复之前的状态");
    const result = core.history.restore(id);
    if (result.ok) {
      skins.invalidate();
      const current = state.read().skin;
      if (!core.home.safeModeOn()) await shellMode.applyAll(current);
      buildMenu();
      notify("library:changed", skins.list());
      notify("skin:changed", { id: current, reason: "restore" });
    }
    return result;
  });
  ipcMain.handle("recovery:snapshot", (_e, label) =>
    recovery.checkpoint("manual", label || "手动存档"));
  ipcMain.handle("recovery:safe-mode", async (_e, on) => {
    core.home.setSafeMode(Boolean(on), on ? "在程序里手动开启" : undefined);
    const current = state.read().skin;
    await shellMode.applyAll(core.home.safeModeOn() ? "none" : current);
    scheduleRotation();
    buildMenu();
    notify("skin:changed", { id: current, reason: "safe-mode" });
    return core.home.safeModeOn();
  });
  ipcMain.handle("recovery:repair", () => {
    recovery.checkpoint("before-repair", "自动修复之前的状态");
    const result = core.doctor.repair({ builtinRoots: [paths.builtinSkins()] });
    skins.invalidate();
    buildMenu();
    notify("library:changed", skins.list());
    return result;
  });
  ipcMain.handle("recovery:reveal-home", () => electronShell.openPath(paths.USER_ROOT));
  ipcMain.handle("recovery:reveal-rescue", () => {
    // 打开之前先确保它是最新的 —— 用户点开却发现是空的，比没有这个按钮更糟。
    rescueScripts.write(process.execPath, app.isPackaged ? [] : [app.getAppPath()]);
    return electronShell.openPath(require("node:path").join(paths.USER_ROOT, rescueScripts.DIR_NAME));
  });

  ipcMain.handle("app:open-external", (_e, url) =>
    /^https?:\/\//i.test(String(url)) ? electronShell.openExternal(url) : null);
  ipcMain.handle("app:paths", () => ({
    userSkins: paths.USER_SKINS, builtinSkins: paths.builtinSkins(), state: paths.STATE_FILE,
    version: app.getVersion(), electron: process.versions.electron, platform: process.platform,
  }));
}

/* ── 启动 ───────────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  proto.install();
  paths.ensureUserDirs();
  // 让命令行也知道内置皮肤在哪。不记的话，`css-guard doctor` 在终端里看不到
  // 内置皮肤，会把"当前用的是内置皮肤"误报成"这套皮肤不存在"。
  core.home.recordInstall({
    builtinSkins: paths.builtinSkins(),
    executable: process.execPath,
    packaged: app.isPackaged,
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  });
  // 每次启动重写急救文件：程序可能被挪过位置或升级过，写死的路径会失效 ——
  // 而失效的急救文件比没有更糟，用户以为自己有后路。
  // 开发模式下 execPath 是 Electron 自己，得把 app 目录也带上才跑得起来。
  rescueScripts.write(process.execPath, app.isPackaged ? [] : [app.getAppPath()]);
  registerIpc();
  buildMenu();
  scheduleRotation();
  openStudio();
});

app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openStudio(); });

// macOS 的约定是关窗 ≠ 退出，其他平台反过来。少了 activate 那一半，
// 关掉窗口后进程还在但永远叫不回来 —— dock 点了也没反应。
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
