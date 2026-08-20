# @dsh-skin/cli

```bash
npx @dsh-skin/cli validate skins        # 有 error 时退出码 1 —— 直接当 CI 闸门
npx @dsh-skin/cli validate skins --json # 机器可读
npx @dsh-skin/cli list skins
npx @dsh-skin/cli new my-skin --dir skins
npx @dsh-skin/cli pack skins/my-skin -o my-skin.zip
```

`validate` 是这个命令存在的理由：皮肤是别人 PR 进来的、会被注入进用户界面的代码，
人工审 CSS 审不动，这个命令把「有没有远程 URL」变成一个退出码。

`pack` 用的是自带的零依赖 ZIP 编码器（固定时间戳，输出可复现），并且**拒绝打包带 error 的皮肤**。

Rules: [docs/skin-format.md](../../docs/skin-format.md) · MIT
