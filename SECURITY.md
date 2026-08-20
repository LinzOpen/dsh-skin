# Security policy · 安全

## Scope

The thing worth attacking here is the linter in `@dsh-skin/core`. A skin is CSS that gets injected
into a live interface, and the whole promise of this project is that a skin cannot reach the network.
See [docs/security.md](docs/security.md) for why that is the line.

这个项目值得攻击的是 `@dsh-skin/core` 里的检查器。皮肤是被注入进正在运行的界面的 CSS，
而这个项目的全部承诺就是「皮肤碰不到网络」。

**In scope**

- A stylesheet that passes `dsh-skin validate` but still reaches the network, executes script, or
  reads data it shouldn't.
- Path traversal out of a skin directory through the custom protocol, the DSH adapter's HTTP server,
  or `skin.json` fields.
- Anything that makes the app inject a skin the linter rejected.

**Out of scope**

- A skin that looks bad or is unreadable.
- Attacks that require the host application to already be compromised.
- The absence of code signing on the released binaries. It's stated plainly in the README; there is
  no paid certificate behind this project.

## Reporting

Use **GitHub → Security → Report a vulnerability** (private advisory) on this repository.

Please include the smallest stylesheet that demonstrates the problem and which consumer you used
(app, `@dsh-skin/host`, the DSH adapter, or the CLI). Don't open a public issue containing a working
exfiltration payload before there's a fix.

请用仓库的 **Security → Report a vulnerability** 私下报告，附上能复现的最小样式表和你用的是哪个消费方。
在修好之前，别在公开 issue 里贴可用的外泄样本。

## Supported versions

The latest release. This project is young; there are no maintenance branches yet.
