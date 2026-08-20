# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[SemVer](https://semver.org/lang/zh-CN/).

## [Unreleased]

## [0.1.0]

第一个版本。

### Added

- **`@dsh-skin/core`** — 皮肤清单解析、皮肤库扫描，以及带行号的检查器：5 条安全规则
  （远程 URL / 远程 @import / 远程字体 / 脚本注入 / 旧式行为绑定）和 4 条稳定性规则
  （永动动画 / 编译产物类名 / 属性值选择器 / 核心变量缺失）。零依赖，不碰 Electron。
- **`@dsh-skin/host`** — Electron 接入 SDK：自定义协议、串行化 `insertCSS`、注入前拦截。
- **`@dsh-skin/cli`** — `validate` / `list` / `new` / `pack`。`validate` 有 error 时退出码 1，
  可直接当 CI 闸门。`pack` 用零依赖的 ZIP 编码器，输出可复现。
- **桌面程序** —「工作室」在内置沙盒里实时预览、跑检查、新建皮肤、把本地图片导入成皮肤；
  「外壳」把任意网址装进一个带皮肤的窗口。macOS / Windows / Linux。
- **六套原创皮肤**，全部纯 CSS、零图片、CC0-1.0：午夜港湾、纸灯、苔痕、青瓷、余烬、石墨。
- **出事之后的一整套救援机制** —— 面向"用户 100% 依赖 agent，而 agent 做错了事又崩了"
  这个场景：每次改动前自动存还原点（最多 30 个，只存文本）；回退**只写回和补建、从不删除**，
  且默认先预演；连续两次启动没走到界面自动进安全模式；`state.json` 坏了先隔离再退回默认值，
  越界字段自动收拢；`dsh-skin doctor / history / undo / snapshot / safe-mode` 全部
  **不需要程序在运行**，读写的是同一批文件；`doctor --json` 的每条结论都带可执行的修复命令，
  写给 agent 读。程序里对应「恢复」页。见 `docs/agent-recovery.md`。
- **`AGENTS.md`** —— 在这个仓库里干活踩过的坑，含每一条的代价。
- **`adapters/dsh-plugin`** — 给 DSH 渲染进程提供皮肤库的本地素材服务。
  服务端有自动化测试；挂进真实 DSH 那一步未验证。

[Unreleased]: https://github.com/LinzOpen/dsh-skin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LinzOpen/dsh-skin/releases/tag/v0.1.0
