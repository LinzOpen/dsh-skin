# Making an app skinnable · 让一个应用能换皮肤

Three integration paths, in order of how much control you have over the host.

三条接入路线，按你对宿主的控制力排序。

---

## 1 · You own the Electron app · 你自己的 Electron 应用

```bash
npm install @css-guard/electron
```

```js
// main.js
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { registerSkinScheme, createSkinHost } = require("@css-guard/electron");

// 必须在 app ready 之前。晚一步不会报错，只会所有素材 404 —— 这个 bug 很难查。
registerSkinScheme();

let skins;

app.whenReady().then(async () => {
  skins = createSkinHost({
    roots: [
      path.join(__dirname, "skins"),                              // 跟着程序走的
      path.join(require("node:os").homedir(), ".myapp", "skins"),  // 用户自己的，覆盖前者
    ],
  });
  skins.install();                       // 装协议处理器

  const win = new BrowserWindow({ /* … */ });
  skins.attach(win);                     // 这个窗口跟着皮肤走，刷新后自动重注
  await skins.apply("midnight-harbor");
});
```

### API

| | |
|---|---|
| `registerSkinScheme(scheme?)` | 注册自定义协议。**ready 之前**调用 |
| `createSkinHost({ roots, scheme?, enforce? })` | 建一个宿主。`enforce: false` 关掉拦截（不建议） |
| `.install()` | 装协议处理器。ready 之后调用 |
| `.attach(win)` | 让一个窗口跟着皮肤走；窗口刷新/跳转后会自动重注 |
| `.apply(id)` | 套用到全部 attach 过的窗口，并记住选择 |
| `.list()` / `.refresh()` / `.find(id)` | 皮肤库 |
| `.compile(id)` | 拿到可注入的 CSS 和检查报告，自己决定怎么用 |

### What it does for you · 它替你做掉的三件事

Each is small on its own; missing any one shows up as "the skin doesn't seem to work" and is
painful to debug.

1. **Registers the protocol at the right moment.** Too late is silent — assets just 404.
2. **Serialises `insertCSS`.** Concurrent switches leave the previous skin's CSS in the page
   permanently. Observed symptom: the new palette applied but the old backdrop still showing.
3. **Runs the linter before injecting.** See [security.md](security.md).

### The renderer side · 渲染进程那边

Nothing to do — but give skins something stable to hook. A skin cannot depend on your compiled class
names, so expose:

- a mount point with a **stable id**: `#app` or `#root`
- your colours as **CSS custom properties on `:root`**
- semantic attributes on overlays: `[role=dialog]`, `[role=menu]`, `[role=listbox]`

That is the entire contract. See the vocabulary list in [skin-format.md](skin-format.md).

---

## 2 · DSH (DeepSeek Harness) · 适配器

`adapters/dsh` serves a `css-guard` library to a DSH renderer.

DSH's plugin route serves exactly one file per plugin (`/plugins/<pkg>/client.js`); every other path
under a mounted plugin returns 404, and the renderer refuses `file://`. So the browser half can only
reach artwork over http, and the adapter starts a loopback asset server inside the plugin — installing
the plugin is the whole install, and the server dies with the host instead of outliving it.

DSH 的插件路由每个插件只开一条静态路由（`client.js`），挂载目录下的其它路径一律 404，
而渲染进程又拒绝 `file://`。所以浏览器那半只能通过 http 拿图 —— 适配器把服务放进插件里，
装插件就是全部安装步骤，而且它跟着宿主一起死。

```
GET /catalog.json      皮肤目录
GET /css/<id>          可注入的 CSS，__SKIN__ 已替换；带 error 的皮肤返回 409 并在响应体里说明原因
GET /skin/<id>/<path>  素材，长缓存
```

> **Verification status.** The asset server has automated tests (`adapters/dsh/test/`) —
> catalogue, CSS compilation, the 409 refusal, path-traversal guards, method allowlist. **Mounting it
> into a live DSH has not been verified.** Treat the client half as unverified until you have run it
> against your own DSH.
>
> **验证边界。** 素材服务有自动化测试（目录、CSS 编译、409 拒绝、路径穿越、方法白名单）。
> **把它挂进真实 DSH 那一步没有验证过。** 在你自己的 DSH 上跑通之前，把浏览器那半当作未验证的。

---

## 3 · An app you don't control · 你控制不了的应用

Use shell mode: open `css-guard`, go to **外壳 / Shell**, type the URL. The skin is injected into that
window with `insertCSS`. Only CSS — never scripts.

This works for anything that is a web UI you can reach by URL. It does not work for a native app, and
it does not modify the target application in any way; close the shell window and nothing is left
behind.

用外壳模式：填网址，皮肤用 `insertCSS` 注入进那个窗口，只注入 CSS，从不注入脚本。
它不修改目标应用的任何文件 —— 关掉窗口就什么都不剩。
