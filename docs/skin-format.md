# Skin format · 皮肤格式

A skin is a folder. Nothing is generated, compiled or registered — copy the folder into
`~/.css-guard/skins/` and it shows up.

一套皮肤就是一个目录。没有生成、没有编译、不用注册 —— 把目录拷进 `~/.css-guard/skins/` 就出现了。

```
midnight-harbor/
├── skin.json        元数据（只有 name 是必填的）
├── skin.css         样式本体
├── thumb.png        可选，画廊里的缩略图
└── assets/          可选，图片 / 字体，CSS 里用 __SKIN__/ 引用
```

## `skin.json`

| field | required | what it is |
|---|---|---|
| `name` | ✅ | 显示名 |
| `id` | | 稳定标识，只允许小写字母数字连字符。缺省用目录名。它会进 URL 和文件路径 |
| `version` | | 版本字符串 |
| `tagline` | | 画廊里名字下面那行 |
| `author` | | |
| `license` | | SPDX 标识。**提交到本仓库的皮肤必须填** |
| `homepage` | | |
| `tags` | | 字符串数组 |
| `accent` | | 强调色，没有缩略图时用来画色卡 |
| `swatch` | | `[浅色底, 深色底, 强调色]`，画廊里的斜切色卡 |
| `appearance` | | `light` / `dark` / `both`（默认 `both`） |
| `assets` | | 素材子目录，默认 `assets` |
| `preview` | | 缩略图文件名 |
| `backdrops` | | 背景图路径数组。宿主把当前这张塞进 `--skin-backdrop`；多于一张时可以轮播 |

JSON Schema: [`packages/core/schema/skin.schema.json`](../packages/core/schema/skin.schema.json)

## `skin.css`

### `__SKIN__` — the asset placeholder

写 `url("__SKIN__/bg.png")`。宿主套用时会把 `__SKIN__` 替换成它自己的取图前缀 ——
Electron 宿主换成 `cssguard://skin/<id>`，DSH 适配器换成 `http://127.0.0.1:3099/skin/<id>`。
皮肤作者不需要知道宿主用哪种。

Write `url("__SKIN__/bg.png")`. The host substitutes its own asset prefix at apply time, so the same
skin folder works across hosts that fetch assets in completely different ways.

### The four rules · 四条规矩

These are not style advice. Each one is a lint rule, and the first is enforced — a skin that breaks
it is refused, not warned about.

这四条不是风格建议，每条都对应一条检查规则；第一条是**拦截**，不是警告。

**1 · No network. 不许联网。**
No `url(https://…)`, no remote `@import`, no remote `@font-face`. Bundle what you need.
The reason is not bandwidth — see [security.md](security.md).

**2 · No `infinite` animation. 不许写 `infinite` 动画。**
A single always-running keyframe animation across a full-window backdrop took one host from
2.5% to 111% CPU at idle. Transitions that run once on a state change are fine — they end.
一条铺满窗口的永动动画实测把宿主从 2.5% CPU 拉到 111%。跑一次就结束的 transition 不受影响。

**3 · Never hook compiled class names. 绝不钩编译产物类名。**
`.pI_x6G_frame` is a build artifact; the host's next build renames it and your skin silently dies.
Stable hooks are: CSS variables, id selectors (`#app`, `#root`), and semantic attributes
(`[role=dialog]`, `input`, `pre`).

**4 · Define the three core variables. 定义三个核心变量.**
`--color-bg`, `--color-text`, `--color-accent`. A skin that only paints a background and skips these
turns into unreadable text the moment the host switches light/dark mode.

### The variable vocabulary · 变量清单

Hosts read a wider set. Unknown variables are ignored, so writing extra costs nothing — skipping one
is what shows up as "that one panel didn't follow the skin".

宿主认的是更宽的一套。多写不会出错，少写才会出现「某一块没跟着变」。

```
背景   --color-bg  --bg  --canvas
表面   --color-surface  -raised  -overlay  -sunken  -deep
       --color-sidebar-bg  --color-menu-bg  --color-composer-bg  --color-well
文字   --color-text  -strong  -muted  -faint
强调   --color-accent  -hover  -soft  -bd
线条   --color-line  -strong  --color-composer-line  --color-composer-focus-line
状态   --color-hover  --color-selected  --color-subtle  --p-selection
按钮   --color-send-bg  -hover  --color-send-icon
```

Don't hand-write fifty values. `skins/*/palette.json` in this repo lists ten colours and
`npm run build:skins` derives the rest — copy that approach.
别手填五十个值。本仓库的 `skins/*/palette.json` 只写十个颜色，`npm run build:skins` 推出其余的。

### Light and dark · 明暗

Hosts disagree on how they mark dark mode, so write all of them:

```css
:root, html[data-color-scheme="light"] { /* 浅色 */ }
html[data-color-scheme="dark"], :root[data-theme="dark"], html.dark, body.dark { /* 深色 */ }
```

### Backdrops · 多背景

```json
{ "backdrops": ["assets/bg-01.jpg", "assets/bg-02.jpg"] }
```

```css
#app, #root { background-image: var(--skin-backdrop); background-size: cover; }
```

The host sets `--skin-backdrop` to the current one. Rotation changes **only that variable** —
re-injecting the whole stylesheet makes the window flash.
宿主只改这一个变量。重注整段样式会闪一下。

Full-bleed artwork usually makes body text unreadable, and pasting an opaque layer over it defeats
the point of having a backdrop. The import flow generates a per-column mask instead: veil the sidebar
and the text column, leave the subject band untouched. See the CSS it writes for the exact stops.
整块压一层不透明底会把背景盖没 —— 等于没换皮肤。导入流程生成的是**按列**的遮罩：
侧栏和正文列淡淡压一层，主体那一段一点不遮。

## Checking · 检查

```bash
npx css-guard-cli validate skins/my-skin      # 人看的
npx css-guard-cli validate skins --json       # 机器读的
```

Exit code 1 when anything is an `error`. That is the CI gate.

| rule | severity | |
|---|---|---|
| `remote-url` | error | `url()` 指向网络 |
| `remote-import` | error | 远程 `@import` |
| `remote-font` | error | 远程 `@font-face` |
| `script-injection` | error | `<script` / `javascript:` / `expression()` |
| `legacy-behavior` | error | `-moz-binding` / `behavior:` |
| `missing-asset` | error | `__SKIN__/x` 指向不存在的文件 |
| `escape-assets` | error | 素材路径含 `..` |
| `infinite-animation` | warn | 永不停止的动画 |
| `hashed-class-selector` | warn | 钩住了编译产物类名 |
| `attribute-value-selector` | warn | 按属性值取元素（和远程 URL 组合才是漏洞） |
| `missing-variable` | warn | 三个核心变量没定义齐 |
