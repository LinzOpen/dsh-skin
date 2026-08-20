# Contributing · 参与

Two kinds of contributions, two different bars.

## Skins · 皮肤

**The hard rule: you must have the right to publish every asset in the skin, and `skin.json` must
declare a `license`.**

**硬规矩：皮肤里的每一份素材，你都必须有权公开它；`skin.json` 必须写 `license`。**

This is the rule the project will actually enforce, because it is the one that can get a
contributor — and everyone who downloads the repo — into real trouble. Specifically:

- Official game art, anime screenshots, and character illustrations are **not** CC0 no matter which
  wallpaper site you found them on. Don't submit them.
- Fan art belongs to the artist. "Credited the artist" is not a licence.
- AI-generated images: say so in `skin.json`, and make sure the generator's terms allow
  redistribution.
- Pure-CSS skins have no asset problem at all. That is why all six built-in skins are pure CSS.

游戏官方立绘、动画截图、角色插画，**不管你在哪个壁纸站找到的，都不是 CC0**，别提交。
同人图版权在画师手里，「标注了作者」不是授权。AI 生成的图请在 `skin.json` 里写明，
并确认生成方的条款允许再分发。纯 CSS 皮肤完全没有这个问题 —— 内置那六套全是纯 CSS，就是这个原因。

CI rejects a skin with no `license` field. A PR shipping artwork you don't own gets closed, not
revised.

### Submitting one

```bash
npx @linzopen/css-guard-cli new my-skin --dir skins
# 改 skins/my-skin/skin.css，边改边在程序里看
npx @linzopen/css-guard-cli validate skins/my-skin     # 必须零 error
npm run lint                                  # 仓库自检
```

Then open a PR with a screenshot in both light and dark. If your skin derives from a palette, add
`palette.json` and run `npm run build:skins` — CI checks that the generated CSS matches.

`warn` findings are not blockers, but say in the PR why you kept one. "It's just how the design
works" is a fine answer; silence is not.

## Code · 代码

```bash
npm install
npm run check          # lint + 单元测试 + 皮肤校验
npx electron app/test/smoke.js               # 程序的端到端测试
npx electron packages/electron/test/smoke.js     # SDK 的端到端测试
npm start              # 跑起来看
```

Things worth knowing before you change something:

- **`packages/core` has no dependencies and never imports Electron.** That is deliberate — it lets
  the same rules run in CI, in the CLI, in the main process, and in any other host. Adding an
  Electron import there would force CI to install a full Electron just to lint a stylesheet.
- **Generated files are committed.** `skins/*/skin.css` comes from `palette.json`, and both are in
  git, because a skin folder has to be self-contained — someone downloading a zip shouldn't need
  Node to use it. `npm run lint` fails if they drift.
- **Comments explain *why*, not *what*.** Most of the odd-looking code in this repo is odd because
  of a specific failure — serialised `insertCSS`, the atomic state write, `min-height: 0` on the
  preview stream. If you remove one, remove the comment too; if you keep it, keep the reason.

## Reporting problems

- Security: [SECURITY.md](SECURITY.md) — don't open a public issue with a working payload.
- Everything else: [open an issue](https://github.com/LinzOpen/css-guard/issues). A skin that renders
  wrong is much easier to fix with the skin folder attached.
