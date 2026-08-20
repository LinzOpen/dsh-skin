"use strict";
/**
 * dsh-skin —— 主进程。
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
const core = require("@dsh-skin/core");

const paths = require("./paths");
const state = require("./state");
const skins = require("./skins");
const proto = require("./protocol");
const shellMode = require("./shell");
const { importImages } = require("./importer");

// 必须在 ready 之前。放到 whenReady 里注册会静默不生效，表现是所有素材 404。
proto.registerScheme();

let studio = null;
let rotateTimer = null;

/* ── 窗口 ───────────────────────────────────────────────────────────── */

function openStudio() {
  if (studio && !studio.isDestroyed()) { studio.show(); studio.focus(); return studio; }
  studio = new BrowserWindow({
    width: 1240, height: 840, minWidth: 900, minHeight: 620,
    title: "dsh-skin", backgroundColor: "#10131c",
    // 冒烟测试要在不弹窗的情况下把整条启动路径跑一遍。除此之外它永远是可见的。
    show: !process.env.DSH_SKIN_HEADLESS,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  studio.loadURL("dshskin://app/index.html");
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
        { label: "皮肤格式说明", click: () => electronShell.openExternal("https://github.com/LinzOpen/dsh-skin/blob/main/docs/skin-format.md") },
        { label: "项目主页", click: () => electronShell.openExternal("https://github.com/LinzOpen/dsh-skin") },
      ],
    },
  ]));
}

function refreshLibrary() {
  skins.invalidate();
  buildMenu();
  notify("library:changed", skins.list());
}

async function selectSkin(id) {
  state.patch({ skin: id, cycle: [], cursor: 0 });
  await shellMode.applyAll(id);
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
    if (backdrop) css += `\n:root { --dsh-backdrop: url("${skins.assetBase(id)}/${backdrop}"); }\n`;
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
    const result = importImages(filePaths, { name });
    if (result.ok) refreshLibrary();
    return result;
  });

  ipcMain.handle("skins:delete", async (_e, id) => {
    const skin = skins.find(id);
    if (!skin) return { ok: false, error: "找不到这套皮肤" };
    // 内置皮肤在程序包里，删了下次升级又回来，而且用户会以为删失败了。
    if (!skin.dir.startsWith(paths.USER_SKINS)) {
      return { ok: false, error: "这是内置皮肤，删不掉。想改它就在自己的皮肤目录里放一套同 id 的，它会覆盖内置那套。" };
    }
    const { response } = await dialog.showMessageBox({
      type: "warning", buttons: ["删除", "取消"], defaultId: 1, cancelId: 1,
      message: `删除「${skin.name}」？`,
      detail: `会删掉整个目录：${skin.dir}\n这一步不能撤销。`,
    });
    if (response !== 0) return { ok: false, cancelled: true };
    fs.rmSync(skin.dir, { recursive: true, force: true });
    if (state.read().skin === id) state.patch({ skin: "none" });
    refreshLibrary();
    return { ok: true };
  });

  ipcMain.handle("shell:open", (_e, url) => {
    const clean = String(url || "").trim();
    if (!/^https?:\/\//i.test(clean)) return { ok: false, error: "网址要以 http:// 或 https:// 开头" };
    const s = state.read();
    shellMode.open(clean, s.skin, () => notify("shell:changed", shellMode.all().map(([u]) => u)));
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
  registerIpc();
  buildMenu();
  scheduleRotation();
  openStudio();
});

app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) openStudio(); });

// macOS 的约定是关窗 ≠ 退出，其他平台反过来。少了 activate 那一半，
// 关掉窗口后进程还在但永远叫不回来 —— dock 点了也没反应。
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
