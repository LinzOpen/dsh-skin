# @dsh-skin/core

The skin engine: manifest parsing, library scanning, and the linter.

**No dependencies. Never imports Electron.** That is deliberate — the same rules have to run in CI,
in the CLI, in an Electron main process, and in any other host. An Electron import here would force
CI to install a full Electron just to lint a stylesheet.

零依赖，不 import Electron —— 同一套规则要能跑在 CI、命令行、Electron 主进程和任何别的宿主里。

```js
const { validateCss, scanLibrary, resolveCss } = require("@dsh-skin/core");

const report = validateCss(css, { dir: skinDir });
// { ok, errors, warnings, findings: [{ rule, severity, message, why, line, snippet }] }

if (report.ok) {
  const injectable = resolveCss(css, "myapp://skin/midnight-harbor");
}
```

| | |
|---|---|
| `validateCss(css, { dir?, assetsDir? })` | 检查。给了 `dir` 才会核对素材是否存在 |
| `scanLibrary(roots)` | 扫多个根，后面的覆盖前面的同 id；坏皮肤只让自己 `broken` |
| `readSkin(dir)` / `isSkinDir(dir)` | 单套皮肤 |
| `normalizeManifest(raw, dirName)` | `skin.json` 归一化。非法 id、越权 `assets` 会抛 |
| `resolveCss(css, assetBase)` | 把 `__SKIN__` 换成宿主的取图前缀 |
| `rules` | 规则表，含每条的 `why` |

Rules and the threat model behind them: [docs/security.md](../../docs/security.md),
[docs/skin-format.md](../../docs/skin-format.md).

MIT
