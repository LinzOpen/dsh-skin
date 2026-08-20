"use strict";
/* 工作室的渲染进程。能碰到的主进程能力全在 window.cssGuard 里（见 preload）。 */

const api = window.cssGuard;
const $ = (id) => document.getElementById(id);

const ui = {
  skins: [],
  current: null,
  scheme: "system",   // system | light | dark
  query: "",          // 搜索词
  tag: "",            // 标签筛选
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
    return `background-image:url("cssguard://skin/${skin.id}/${encodeURIComponent(skin.preview)}")`;
  }
  // 没有缩略图就画色卡：左浅右深，斜切一刀，强调色描边。
  // 一眼看出这套皮肤两种模式各是什么样，比一块纯色有用得多。
  const [light, dark, accent] = skin.swatch || [];
  if (light && dark) {
    return `background:linear-gradient(118deg, ${light} 0 47%, ${accent || dark} 47% 53%, ${dark} 53% 100%)`;
  }
  return `background:${skin.accent || "#4c6ef5"}`;
}

/** 一套皮肤是否命中当前搜索 + 标签筛选。搜名字、标签、作者、tagline、id。 */
function matches(skin) {
  if (ui.tag && !(skin.tags || []).includes(ui.tag)) return false;
  const kw = ui.query.trim().toLowerCase();
  if (!kw) return true;
  const hay = [skin.name, skin.id, skin.author, skin.tagline, ...(skin.tags || [])]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(kw);
}

function renderList() {
  const list = $("list");
  list.replaceChildren();
  if (!ui.skins.length) {
    list.appendChild(el("div", { class: "empty", text: "皮肤库是空的。点「新建皮肤」或「导入素材」。" }));
    $("count").textContent = "0 套";
    return;
  }
  const rows = ui.skins.filter(matches);
  if (!rows.length) {
    list.appendChild(el("div", { class: "empty-filtered", text: "没有匹配的皮肤。换个词，或清空筛选。" }));
  }
  for (const skin of rows) {
    const badges = [];
    if (skin.broken) badges.push(el("span", { class: "badge err", text: "读不出来" }));
    if (skin.mine) badges.push(el("span", { class: "badge mine", text: "我的" }));
    const title = el("b", {}, [document.createTextNode(skin.name), ...badges]);

    // 悬停操作：在访达里显示、删除（删除只对"我的"皮肤开放，内置的删了也会回来）
    const acts = el("span", { class: "hover-acts" });
    const revealBtn = el("button", { title: "在文件夹里显示", text: "打开" });
    revealBtn.addEventListener("click", (e) => { e.stopPropagation(); api.skins.reveal(skin.id); });
    acts.appendChild(revealBtn);
    if (skin.mine) {
      const delBtn = el("button", { class: "danger", title: "删除这套皮肤", text: "删除" });
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const result = await api.skins.remove(skin.id);
        if (result.ok) { await reload(false); toast(`已删除「${skin.name}」`); }
        else if (result.error) toast(result.error);
      });
      acts.appendChild(delBtn);
    }

    const head = el("span", { class: "skin-main" }, [title, el("small", { text: skin.broken ? skin.error : (skin.tagline || skin.id) })]);
    const row = el("button", {
      class: "skin", "aria-current": String(ui.current === skin.id),
      title: skin.dir,
    }, [
      el("span", { class: "swatch", style: swatchStyle(skin) }),
      head,
      acts,
    ]);
    row.addEventListener("click", () => select(skin.id));
    list.appendChild(row);
  }

  const shown = rows.length;
  const total = ui.skins.length;
  $("count").textContent = shown === total ? `${total} 套` : `${shown} / ${total} 套`;
}

/** 用全部皮肤的标签填充筛选下拉。 */
function renderTagFilter() {
  const select = $("tag");
  const tags = [...new Set(ui.skins.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b, "zh"));
  const current = ui.tag;
  select.replaceChildren(el("option", { value: "", text: "全部标签" }));
  for (const t of tags) {
    const opt = el("option", { value: t, text: t });
    if (t === current) opt.selected = true;
    select.appendChild(opt);
  }
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
  let style = doc.getElementById("css-guard-preview");
  if (!style) {
    style = doc.createElement("style");
    style.id = "css-guard-preview";
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

/** 轮播控制条：只在当前皮肤有超过一张背景时出现，并反映 rotate 开关和间隔。 */
async function paintRotateBar(skin) {
  const multi = !!(skin && skin.backdrops && skin.backdrops.length > 1);
  $("rotate-bar").hidden = !multi;
  if (!multi) return;
  const st = await api.state.read();
  $("mode-single").setAttribute("aria-pressed", String(!st.rotate));
  $("mode-rotate").setAttribute("aria-pressed", String(st.rotate));
  const sel = $("interval");
  if (st.rotateMinutes) sel.value = String(st.rotateMinutes);
}

/* ── 动作 ───────────────────────────────────────────────────────────── */

async function select(id) {
  ui.current = id;
  renderList();
  const skin = ui.skins.find((s) => s.id === id) || null;
  await paintRotateBar(skin);
  if (!skin || skin.broken) { injectPreview(""); renderReport(skin, null); return; }
  const { css, report } = await api.skins.preview(id);
  injectPreview(css);
  renderReport(skin, report);
  await api.state.patch({ skin: id });
}

async function reload(keepSelection = true) {
  const [skins, paths] = await Promise.all([api.skins.list(), api.app.paths()]);
  // 用分隔符做前缀比对；否则 ~/.css-guard/skinsXXX 里的皮肤会被标成「我的」。
  const sep = paths.userSkins.includes("\\") ? "\\" : "/";
  const underUser = (dir) => dir === paths.userSkins || dir.startsWith(paths.userSkins + sep);
  ui.skins = skins.map((s) => ({ ...s, mine: underUser(s.dir) }));
  const state = await api.state.read();
  const want = keepSelection && ui.current ? ui.current : state.skin;
  ui.current = ui.skins.some((s) => s.id === want) ? want : (ui.skins[0]?.id ?? null);
  renderTagFilter();
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
      if (tab.dataset.view === "recovery") refreshRecovery();
    });
  }

  $("scheme").addEventListener("click", () => {
    ui.scheme = { system: "light", light: "dark", dark: "system" }[ui.scheme];
    $("scheme").textContent = `预览：${{ system: "跟随系统", light: "浅色", dark: "深色" }[ui.scheme]}`;
    $("scheme").setAttribute("aria-pressed", String(ui.scheme !== "system"));
    applyScheme();
  });

  $("q").addEventListener("input", (e) => { ui.query = e.target.value; renderList(); });
  $("tag").addEventListener("change", (e) => { ui.tag = e.target.value; renderList(); });
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
  $("mode-single").addEventListener("click", async () => {
    await api.state.patch({ rotate: false });
    await paintRotateBar(ui.skins.find((s) => s.id === ui.current));
    toast("已切到单张");
  });
  $("mode-rotate").addEventListener("click", async () => {
    await api.state.patch({ rotate: true });
    await paintRotateBar(ui.skins.find((s) => s.id === ui.current));
    toast("已开启全库轮播");
  });
  $("interval").addEventListener("change", async (e) => {
    await api.state.patch({ rotateMinutes: Number(e.target.value) });
    toast(`轮播间隔改为 ${e.target.options[e.target.selectedIndex].text}`);
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

/* ── 恢复 ─────────────────────────────────────────────────────────────
   这一页是给"程序还打得开、但有东西不对"的情况用的。程序打不开时，
   同样的能力在命令行里（页面底部写了三条命令）。 */

let health = null;

/** 时间戳 → 人能读的相对时间。非技术用户面对一串 ISO 时间是认不出"哪一次"的。 */
function ago(iso) {
  if (!iso) return "时间未知";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function renderBanner() {
  const bar = $("banner");
  const safe = health && health.safeMode;
  bar.hidden = !safe;
  if (!safe) return;
  $("banner-title").textContent = "正处在安全模式：现在不会套用任何皮肤";
  $("banner-detail").textContent = `${safe.reason || "手动开启"}。你的皮肤都还在，只是暂时没有生效。`;
  const action = $("banner-action");
  action.textContent = "退出安全模式";
  action.onclick = async () => {
    await api.recovery.safeMode(false);
    await refreshRecovery();
    toast("已退出安全模式");
  };
}

function renderHealth() {
  const card = $("health");
  if (!health) return;
  const level = health.level;
  card.dataset.level = level;
  const bad = health.checks.filter((c) => c.level !== "ok");
  $("health-title").textContent =
    level === "ok" ? "一切正常" : level === "warn" ? `${bad.length} 处需要留意` : `${bad.length} 处有问题`;
  $("health-detail").textContent =
    level === "ok"
      ? `${health.summary.skins} 套皮肤，${health.summary.restorePoints} 个还原点。出事时有得退。`
      : bad.map((c) => c.title).join("；");
  $("safe-toggle").textContent = health.safeMode ? "退出安全模式" : "进入安全模式";
}

function renderChecks() {
  const box = $("checks");
  box.replaceChildren();
  for (const c of (health ? health.checks : [])) {
    const row = el("div", { class: "checkrow", "data-level": c.level }, [
      el("div", { class: "head" }, [
        el("span", { class: "lv", text: c.level === "ok" ? "正常" : c.level === "warn" ? "留意" : "问题" }),
        el("span", { text: c.title }),
      ]),
      c.detail ? el("div", { class: "detail", text: c.detail }) : null,
    ]);
    if (c.fix) {
      const fix = el("div", { class: "fix" });
      if (c.fix.command) { fix.appendChild(el("code", { text: c.fix.command })); fix.appendChild(document.createTextNode(" ")); }
      fix.appendChild(document.createTextNode(c.fix.description || ""));
      row.appendChild(fix);
    }
    box.appendChild(row);
  }
}

async function renderPoints() {
  const points = await api.recovery.history();
  const box = $("points");
  box.replaceChildren();
  if (!points.length) {
    box.appendChild(el("div", { class: "hint", text: "还没有还原点。做任何改动时会自动存一个，也可以现在手动存一个。" }));
    return;
  }
  for (const point of points) {
    const restore = el("button", { class: "ghost", text: "恢复到这里" });
    restore.addEventListener("click", () => confirmRestore(point));
    box.appendChild(el("div", { class: `point${point.broken ? " broken" : ""}` }, [
      el("span", { class: "what" }, [
        el("b", { text: point.label }),
        el("small", { text: `${ago(point.at)} · ${point.skins} 套皮肤 · 当时用的是 ${point.skin || "—"}` }),
      ]),
      point.broken ? null : restore,
    ]));
  }
}

/** 先预演给用户看，他点了确认才真的动手。 */
async function confirmRestore(point) {
  const preview = await api.recovery.preview(point.id);
  if (!preview.ok) { toast(preview.error); return; }
  const lines = preview.changes.map((c) => `· ${c.action}${c.skin ? ` ${c.skin}/` : " "}${c.file}`);
  if (preview.missingAssets.length) {
    lines.push("", `注意：有 ${preview.missingAssets.length} 张素材图当时还在、现在不在了。还原点里只存文字，图找不回来。`);
  }
  if (preview.kept.length) {
    lines.push("", `这些是那之后新增的，会原样保留（恢复不删东西）：${preview.kept.join("、")}`);
  }
  const ok = window.confirm(`恢复到「${point.label}」（${ago(point.at)}）\n\n会做这些事：\n${lines.join("\n")}\n\n继续吗？`);
  if (!ok) return;
  const result = await api.recovery.restore(point.id);
  if (!result.ok) { toast(result.error); return; }
  await refreshRecovery();
  await reload(false);
  toast(`已恢复到「${point.label}」`);
}

async function refreshRecovery() {
  health = await api.recovery.status();
  renderBanner();
  renderHealth();
  renderChecks();
  await renderPoints();
}

function wireRecovery() {
  $("rollback").addEventListener("click", async () => {
    const points = (await api.recovery.history()).filter((p) => !p.broken);
    if (!points.length) { toast("还没有还原点，没得退"); return; }
    await confirmRestore(points[0]);
  });
  $("autofix").addEventListener("click", async () => {
    const result = await api.recovery.repair();
    await refreshRecovery();
    await reload(false);
    toast(result.done.length ? `修了 ${result.done.length} 处：${result.done.map((d) => d.action).join("、")}` : "没有能自动修的");
  });
  $("save-point").addEventListener("click", async () => {
    const label = window.prompt("给这个还原点起个名字，方便以后认出来", "已知可用的状态");
    if (!label) return;
    const point = await api.recovery.snapshot(label);
    await refreshRecovery();
    toast(point.ok ? `已存下「${label}」` : `存不下来：${point.error}`);
  });
  $("safe-toggle").addEventListener("click", async () => {
    const on = !(health && health.safeMode);
    await api.recovery.safeMode(on);
    await refreshRecovery();
    toast(on ? "已进入安全模式" : "已退出安全模式");
  });
  $("open-home").addEventListener("click", () => api.recovery.revealHome());
  $("open-rescue").addEventListener("click", () => api.recovery.revealRescue());

  // 菜单里的「恢复中心」会推这个事件过来
  api.on("recovery:open", () => document.querySelector('[data-view="recovery"]').click());
}

wireRecovery();
refreshRecovery();
