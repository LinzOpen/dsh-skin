# AGENTS.md

给在这个仓库里干活的 agent。**操作这个软件**（而不是改它的代码）的契约在
[docs/agent-recovery.md](docs/agent-recovery.md)。

## 先跑这一条

```bash
npm install
npm run check                                 # 仓库自检 + 单元测试 + 皮肤校验
npx electron app/test/smoke.js                # 程序端到端（真 Electron）
npx electron packages/electron/test/smoke.js      # SDK 端到端
```

四条全过才算能提交。CI 在 ubuntu / macOS / windows 三个平台重复跑同样的东西。

## 结构

```
packages/core   引擎：清单、检查器、皮肤库、用户目录、还原点、体检。
                零依赖，**永不 import electron**。
packages/electron   Electron 接入 SDK。
packages/cli    命令行 —— 也是程序打不开时唯一的入口。
app             桌面程序：工作室 + 外壳 + 恢复。
skins           六套原创皮肤，从 palette.json 生成，源和产物都提交。
adapters/       DSH 插件。
```

## 踩过的坑（动手前先读这一段）

- **结论**：改设置或皮肤读写逻辑时，改 `packages/core/src/home.js`，不要在 app 里另写一份。
  **为什么**：`css-guard doctor` 在终端里读的就是这一份。两份实现必然漂移，而漂移的后果是
  体检报出来的现状不是程序真正用的那份 —— agent 拿着错的诊断去修，会越修越远。
  **代价**：没量到；这一条是重构时主动收敛的，不是事故后补的。

- **结论**：`packages/core` 里永远不要 `require("electron")`。
  **为什么**：CI 会为了跑一次样式检查去装整个 Electron，而 `css-guard doctor` 在一台没装程序的
  机器上就跑不起来 —— 那恰恰是最需要它的场景。
  **代价**：没量到。

- **结论**：拼 `file://` URL 一律用 `node:url` 的 `pathToFileURL`，不要 `"file://" + encodeURI(p)`。
  **为什么**：`encodeURI` **不转义 `#`**。一个叫 `a #1 b.png` 的素材会被解析成路径 `a%20` 加
  片段 `#1%20b.png`，图静默 404，没有任何报错。用户从相册导出的文件名带 `#` 很常见。
  **代价**：一次 CI 往返 + 一次探针验证；发现它靠的是写探针，不是看代码。

- **结论**：生成物（`skins/*/skin.css`）和源（`palette.json`）都要提交，且加 `.gitattributes`
  锁 `eol=lf`。
  **为什么**：皮肤目录必须自包含（别人下个 zip 就能用，不该要求他装 Node）。而 Windows 的 git
  默认 `autocrlf=true`，检出成 CRLF，逐字节比对必然不等 —— 表现是 **Windows 上 CI 100% 失败，
  macOS 和 Linux 全绿**。
  **代价**：第一次 CI 直接红，两次往返。

- **结论**：CI 的 Linux runner 上跑 Electron 要加 `--no-sandbox`。
  **为什么**：`node_modules/electron/dist/chrome-sandbox` 不是 setuid root，Electron 宁可
  `SIGTRAP` 也不肯无沙箱运行。
  **代价**：一次 CI 往返。

- **结论**：`execFileSync` 失败时不要写 `error.stdout || error.stderr`。
  **为什么**：两者都是 Buffer，而**空 Buffer 是 truthy** —— 永远选中空的那个，于是失败信息
  一个字都印不出来。要 `[a,b].map(String).filter(Boolean)`。
  **代价**：Windows 上那次 CI 失败只看到一行标题没有细节，多花了一轮才定位。

- **结论**：皮肤 id 从目录名推导时要兜底非 ASCII 名字（`manifest.deriveId`）。
  **为什么**：id 必须 URL / 路径安全，但用户建目录几乎一定用自己的语言。直接判「不合法」
  的后果是一套完全正常的中文名皮肤被报成「读不出来」，报错还看不懂。
  **代价**：没量到；是看恢复页截图时发现的 —— **界面截图能抓到代码审查抓不到的东西**。

- **结论**：flex 列布局里，`flex: 1` 且内部滚动的子项必须写 `min-height: 0`。
  **为什么**：默认 `min-height: auto` 让它不肯收缩，内容一长就把下面的元素顶出可视区，
  而且**只在内容够长时才复现**。
  **代价**：一次截图往返。

- **结论**：Linux 的 `executableName` 必须在 `electron-builder.yml` 里显式写。
  **为什么**：它默认取 `package.json` 的 `name`，而这里是 `@css-guard/app` —— 清洗后仍带 `@`，
  AppImage 直接拒绝构建。macOS 用的是 `productName`，所以**本机永远发现不了**。
  **代价**：一轮 Docker（约 5 分钟）；如果没有 Docker 这一步，Linux 包会带着一个必炸的配置发出去。

- **结论**：跑全量测试要用 `Dockerfile.test`，不能只信本机。
  **为什么**：本机有攒了几个月的 node_modules 和 macOS 特有行为。第一次在容器里跑就抓出
  三个本机全绿的问题：`xvfb-run` 缺 `xauth`、Linux `executableName` 非法、
  以及一个**在 macOS 上只有 50% 概率复现**的换背景 bug。
  **代价**：抓到 3 个 bug，其中 1 个会以"按钮点了没反应"的形式出现在一半用户面前。

- **结论**：洗牌之后要显式跳过"和当前这张相同"的那一张。
  **为什么**：只有两张背景时，重洗后第一张正好是当前这张的概率是 50%。不处理的话
  「换下一张」点了等于没换，没有任何报错。macOS 上连过十几次都没抽中。
  **代价**：一轮 Docker + 6 次本地复跑确认确定性。

- **结论**：生成 shell 脚本时，可执行文件和参数**必须分开引用**，不能拼成一个字符串。
  **为什么**：整串会被当成一个可执行文件名，双击的结果是 `No such file or directory`。
  **代价**：一轮往返；这个错只在开发形态出现，也就是只有测试的人会踩到 —— 而用户踩到时没人在看。

- **结论**：急救脚本调起程序时要带 `--no-sandbox`。
  **为什么**：急救模式不创建任何窗口，但 Electron 会在 JS 跑起来**之前**检查
  `chrome-sandbox` 的 setuid 位，不满足就直接 abort —— 表现是双击急救文件后什么都不发生。
  容器、解压出来的 AppImage、被管控的机器都会命中。这里没有渲染进程可保护，关掉零代价。
  **代价**：一轮 Docker。

- **结论**：验证 GUI 用 `webContents.capturePage()` 离屏截图，别把窗口弹到用户面前。
  **为什么**：这台机器上同时跑着别的会话，抢焦点会打断人。离屏截图一样能看清。
  **代价**：没量到。

## 收尾

改完这个仓，把新的结论按上面的格式追加到这一节，然后跑：

```bash
bash ~/.memory-atlas/on-archive.sh
```
