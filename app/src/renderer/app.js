"use strict";
/* 工作室的渲染进程。能碰到的主进程能力全在 window.dshSkin 里（见 preload）。 */

const api = window.dshSkin;
const $ = (id) => document.getElementById(id);

const ui = {
  skins: [],
  current: null,
  scheme: "system",   // system | light | dark
};

/* ── 小工具 ─────────────────────────────────────────────────────────── */

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.dataset.show = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.dataset.show = "0"; }, 2600);
}

/** 全部文本都走 textContent，绝不拼 innerHTML。
 *  皮肤的 name / tagline 来自磁盘上任何一个目录，当成不可信输入处理。 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k === "style") node.setAttribute("style", v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

/* ── 皮肤列表 ───────────────────────────────────────────────────────── */

function swatchStyle(skin) {
  if (skin.preview) {
    // preview 是文件名，可能含空格；encodeURIComponent 之后放进 url()。
    return `background-image:url("dshskin://skin/${skin.id}/${encodeURIComponent(skin.preview)}")`;
  }
  // 没有缩略图就画色卡：左浅右深，斜切一刀，强调色描边。
  // 一眼看出这套皮肤两种模式各是什么样，比一块纯色有用得多。
  const [light, dark, accent] = skin.swatch || [];
  if (light && dark) {
    return `background:linear-gradient(118deg, ${light} 0 47%, ${accent || dark} 47% 53%, ${dark} 53% 100%)`;
  }
  return `background:${skin.accent || "#4c6ef5"}`;
}

function renderList() {
  const list = $("list");
  list.replaceChildren();
  if (!ui.skins.length) {
    list.appendChild(el("div", { class: "empty", text: "皮肤库是空的。点「新建皮肤」或「导入素材」。" }));
  }
  for (const skin of ui.skins) {
    const badges = [];
    if (skin.broken) badges.push(el("span", { class: "badge err", text: "读不出来" }));
    if (skin.mine) badges.push(el("span", { class: "badge mine", text: "我的" }));
    const title = el("b", {}, [document.createTextNode(skin.name), ...badges]);
    const row = el("button", {
      class: "skin", "aria-current": String(ui.current === skin.id),
      title: skin.dir,
    }, [
      el("span", { class: "swatch", style: swatchStyle(skin) }),
      el("span", {}, [title, el("small", { text: skin.broken ? skin.error : (skin.tagline || skin.id) })]),
    ]);
    row.addEventListener("click", () => select(skin.id));
    list.appendChild(row);
  }
  $("count").textContent = `${ui.skins.length} 套`;
}

/* ── 预览 ───────────────────────────────────────────────────────────── */

function frameDoc() {
  const frame = $("frame");
  try { return frame.contentDocument || null; } catch { return null; }
}

/** 把皮肤 CSS 塞进沙盒。换的是同一个 <style> 的内容，不是删了再插 ——
 *  删插会让 iframe 闪一帧白。 */
function injectPreview(css) {
  const doc = frameDoc();
  if (!doc) return false;
  let style = doc.getElementById("dsh-skin-preview");
  if (!style) {
    style = doc.createElement("style");
    style.id = "dsh-skin-preview";
    doc.head.appendChild(style);
  }
  style.textContent = css || "";
  applyScheme();
  return true;
}

/** 明暗由沙盒的 html 属性决定。三种写法都给，因为不同宿主认的不一样，
 *  皮肤多半也只写了其中一两种。 */
function applyScheme() {
  const doc = frameDoc();
  if (!doc) return;
  const root = doc.documentElement;
  const dark = ui.scheme === "dark"
    || (ui.scheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-color-scheme", dark ? "dark" : "light");
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.classList.toggle("dark", dark);
}

/* ── 检查报告 ───────────────────────────────────────────────────────── */

function renderReport(skin, report) {
  const box = $("report");
  box.replaceChildren();
  if (!skin) { box.appendChild(el("div", { class: "empty", text: "左边选一套皮肤" })); return; }

  if (skin.broken) {
    box.appendChild(el("div", { class: "verdict err" }, [
      el("div", { class: "line" }, [el("strong", { text: "读不出来" })]),
      el("p", { text: skin.error }),
    ]));
    return;
  }

  const errors = report ? report.errors : 0;
  const warns = report ? report.warnings : 0;
  const tone = errors ? "err" : warns ? "warn" : "ok";
  const headline = errors ? `${errors} 个问题拦住了套用` : warns ? `${warns} 条提示` : "干净";
  const detail = errors
    ? "有 error 的皮肤不会被注入任何窗口。这不是提醒，是拦截。"
    : warns ? "能用。下面每一条都是「现在没事，某个条件下会出事」。"
            : "安全规则和稳定性规则都通过了。";
  box.appendChild(el("div", { class: `verdict ${tone}` }, [
    el("div", { class: "line" }, [el("strong", { text: headline })]),
    el("p", { text: detail }),
  ]));

  for (const f of (report ? report.findings : [])) {
    box.appendChild(el("div", { class: `finding ${f.severity}` }, [
      el("div", { class: "head" }, [
        el("span", { class: "sev", text: f.severity === "error" ? "拦截" : "提示" }),
        el("span", { text: f.message }),
        el("span", { class: "rule", text: `${f.rule} · L${f.line}` }),
      ]),
      el("div", { class: "why", text: f.why }),
      f.snippet ? el("pre", { text: f.snippet }) : null,
    ]));
  }

  const dl = el("dl", {}, [
    el("dt", { text: "id" }), el("dd", { text: skin.id }),
    el("dt", { text: "版本" }), el("dd", { text: skin.version || "—" }),
    el("dt", { text: "作者" }), el("dd", { text: skin.author || "—" }),
    el("dt", { text: "许可" }), el("dd", { text: skin.license || "—" }),
    el("dt", { text: "背景" }), el("dd", { text: skin.backdrops?.length ? `${skin.backdrops.length} 张` : "纯 CSS" }),
    el("dt", { text: "位置" }), el("dd", { text: skin.dir }),
  ]);
  box.appendChild(el("div", { class: "meta" }, [dl]));
}

/* ── 动作 ───────────────────────────────────────────────────────────── */

async function select(id) {
  ui.current = id;
  renderList();
  const skin = ui.skins.find((s) => s.id === id) || null;
  $("next").hidden = !(skin && skin.backdrops && skin.backdrops.length > 1);
  if (!skin || skin.broken) { injectPreview(""); renderReport(skin, null); return; }
  const { css, report } = await api.skins.preview(id);
  injectPreview(css);
  renderReport(skin, report);
  await api.state.patch({ skin: id });
}

async function reload(keepSelection = true) {
  const [skins, paths] = await Promise.all([api.skins.list(), api.app.paths()]);
  ui.skins = skins.map((s) => ({ ...s, mine: s.dir.startsWith(paths.userSkins) }));
  const state = await api.state.read();
  const want = keepSelection && ui.current ? ui.current : state.skin;
  ui.current = ui.skins.some((s) => s.id === want) ? want : (ui.skins[0]?.id ?? null);
  renderList();
  if (ui.current) await select(ui.current);
  else renderReport(null, null);
}

/* ── 外壳视图 ───────────────────────────────────────────────────────── */

async function renderShells() {
  const { open, recent } = await api.shell.list();
  const openBox = $("open-list");
  openBox.replaceChildren();
  if (!open.length) openBox.appendChild(el("div", { class: "hint", text: "还没有打开的外壳窗口。" }));
  for (const url of open) {
    openBox.appendChild(el("div", { class: "item" }, [
      el("span", { class: "dot" }), el("span", { text: url }),
    ]));
  }
  const recentBox = $("recent-list");
  recentBox.replaceChildren();
  if (!recent.length) recentBox.appendChild(el("div", { class: "hint", text: "打开过的网址会记在这里。" }));
  for (const url of recent) {
    const again = el("button", { class: "ghost", text: "打开" });
    again.addEventListener("click", () => openShell(url));
    const forget = el("button", { class: "ghost", text: "忘掉" });
    forget.addEventListener("click", async () => { await api.shell.forget(url); renderShells(); });
    recentBox.appendChild(el("div", { class: "item" }, [el("span", { text: url }), again, forget]));
  }
}

async function openShell(url) {
  const result = await api.shell.open(url);
  if (!result.ok) { toast(result.error); return; }
  $("url").value = "";
  toast(`已打开 ${result.url}`);
  renderShells();
}

/* ── 接线 ───────────────────────────────────────────────────────────── */

function wire() {
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => {
      for (const other of document.querySelectorAll("[role=tab]")) {
        const on = other === tab;
        other.setAttribute("aria-selected", String(on));
        $(other.dataset.view).dataset.active = on ? "1" : "0";
      }
      if (tab.dataset.view === "shellview") renderShells();
    });
  }

  $("scheme").addEventListener("click", () => {
    ui.scheme = { system: "light", light: "dark", dark: "system" }[ui.scheme];
    $("scheme").textContent = `预览：${{ system: "跟随系统", light: "浅色", dark: "深色" }[ui.scheme]}`;
    $("scheme").setAttribute("aria-pressed", String(ui.scheme !== "system"));
    applyScheme();
  });

  $("refresh").addEventListener("click", async () => { await api.skins.refresh(); await reload(); toast("已重新扫描"); });
  $("reveal").addEventListener("click", () => ui.current && api.skins.reveal(ui.current));
  $("apply").addEventListener("click", async () => {
    if (!ui.current) return;
    await api.skins.select(ui.current);
    toast("已套用到全部外壳窗口");
  });
  $("new").addEventListener("click", async () => {
    const name = window.prompt("新皮肤叫什么？", "我的皮肤");
    if (!name) return;
    const result = await api.skins.create(name);
    if (!result.ok) { toast(result.error); return; }
    await reload(false);
    await select(result.id);
    toast(`已生成 ${result.dir}`);
  });
  $("import").addEventListener("click", async () => {
    const name = window.prompt("这套皮肤叫什么？", "我的背景");
    if (!name) return;
    const result = await api.skins.import(name);
    if (result.cancelled) return;
    if (!result.ok) { toast(result.error); return; }
    await reload(false);
    await select(result.id);
    toast(`已导入 ${result.count} 张${result.skipped?.length ? `，跳过 ${result.skipped.length} 个` : ""}`);
  });
  $("next").addEventListener("click", async () => {
    const moved = await api.skins.next(ui.current);
    if (!moved) { toast("这套皮肤只有一张背景"); return; }
    await select(ui.current);
  });

  $("open").addEventListener("click", () => openShell($("url").value));
  $("url").addEventListener("keydown", (e) => { if (e.key === "Enter") openShell($("url").value); });

  api.on("library:changed", () => reload());
  api.on("skin:changed", ({ id }) => { if (id !== ui.current) select(id); });
  api.on("shell:changed", () => renderShells());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyScheme);
}

$("frame").addEventListener("load", () => { if (ui.current) select(ui.current); else applyScheme(); });
wire();
reload();
