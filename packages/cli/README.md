# @css-guard/cli

```bash
npx @css-guard/cli validate skins        # 有 error 时退出码 1 —— 直接当 CI 闸门
npx @css-guard/cli validate skins --json # 机器可读
npx @css-guard/cli list skins
npx @css-guard/cli new my-skin --dir skins
npx @css-guard/cli pack skins/my-skin -o my-skin.zip
```

`validate` 是这个命令存在的理由：皮肤是别人 PR 进来的、会被注入进用户界面的代码，
人工审 CSS 审不动，这个命令把「有没有远程 URL」变成一个退出码。

`pack` 用的是自带的零依赖 ZIP 编码器（固定时间戳，输出可复现），并且**拒绝打包带 error 的皮肤**。

## 出事之后

这几条**不需要程序在运行** —— 它们读写的是 `~/.css-guard`，所以在程序打不开的时候仍然可用。
那正是它们存在的理由。

```bash
npx @css-guard/cli doctor          # 现在什么状况，每条结论带着修它的命令
npx @css-guard/cli doctor --json   # 同上，给 AI 助手读的结构化输出
npx @css-guard/cli undo            # 预演回退（不动手）
npx @css-guard/cli undo --yes      # 真的回退
npx @css-guard/cli history         # 列出还原点
npx @css-guard/cli snapshot -m 说明 # 现在存一个
npx @css-guard/cli safe-mode on    # 下次启动不套任何皮肤
```

`undo` 不加 `--yes` 永远只是预演；回退只写回和补建，从不删东西。
完整契约（含给 agent 的四条硬规矩）：[docs/agent-recovery.md](../../docs/agent-recovery.md)

Rules: [docs/skin-format.md](../../docs/skin-format.md) · MIT
