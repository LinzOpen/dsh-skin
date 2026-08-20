"use strict";
/**
 * 在用户目录里放几个**双击就能跑**的急救文件。
 *
 * 为什么需要这个：前面所有的救援能力都有一个前提 —— 要么程序打得开（点「恢复」页），
 * 要么用户会用终端（跑 `npx @dsh-skin/cli doctor`）。这两个前提同时不成立的人
 * 恰恰是最需要救援的那一类：不写代码、电脑上没装 Node、程序双击没反应。
 *
 * 所以这里生成的脚本满足两条：
 *   1. **双击运行**，不需要输入任何字符（macOS 的 .command、Windows 的 .bat 都可以双击）。
 *   2. **不依赖用户装过任何东西** —— 它们调用的是程序自己的可执行文件，
 *      也就是用户已经装好的那个。没有 Node 也能跑。
 *
 * 每次启动都重写一遍，因为程序可能被挪过位置或升级过，写死的路径会失效 ——
 * 而失效的急救文件比没有更糟：用户以为自己有后路。
 */

const fs = require("node:fs");
const path = require("node:path");
const { home } = require("@dsh-skin/core");

const DIR_NAME = "急救";

/** 文件名用中文，且带序号 —— 用户是在访达/资源管理器里扫一眼，不是在读文档。 */
const SCRIPTS = [
  { order: "1", name: "看看出了什么问题", arg: "doctor",
    note: "列出现在的状况。这一步只看，不改任何东西。" },
  { order: "2", name: "回到上一个正常状态", arg: "undo",
    note: "先只给你看它打算改什么。确认没问题后再点第 3 个。" },
  { order: "3", name: "确认回退", arg: "undo-yes",
    note: "真的执行回退。它只写回和补建，不删任何东西。" },
  { order: "4", name: "下次启动不套皮肤", arg: "safe-on",
    note: "程序打不开时先点这个，再打开程序。" },
  { order: "5", name: "恢复正常启动", arg: "safe-off",
    note: "问题解决后点这个，让皮肤重新生效。" },
];

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/* 急救模式不创建任何窗口 —— 打印完就退。加 --no-sandbox 是因为在
   chrome-sandbox 没有 setuid 位的环境里（容器、解压出来的 AppImage、
   某些企业管控的机器），Electron 宁可在 JS 跑起来之前就 abort 也不肯无沙箱运行，
   表现是双击急救文件后**什么都不发生**。这里没有渲染进程可保护，
   所以关掉它没有任何安全代价，换来的是"在什么环境下都跑得起来"。 */
const SANDBOX_OFF = "--no-sandbox";

function unixScript(exe, extraArgs, arg, note) {
  return `#!/bin/sh
# 双击这个文件就行，不需要输入任何东西。
# ${note}
cd "$(dirname "$0")"
${[exe, ...extraArgs].map(shellQuote).join(" ")} ${SANDBOX_OFF} --recovery=${arg}
printf '\\n————————————————————————————————\\n按回车关闭这个窗口。\\n'
read -r _
`;
}

function windowsScript(exe, extraArgs, arg, note) {
  // chcp 65001：不改的话中文在默认代码页下是乱码，而这些文字正是给看不懂英文的人准备的。
  return `@echo off\r
chcp 65001 >nul\r
rem 双击这个文件就行，不需要输入任何东西。\r
rem ${note}\r
${[exe, ...extraArgs].map((v) => `"${v}"`).join(" ")} ${SANDBOX_OFF} --recovery=${arg}\r
echo.\r
echo ————————————————————————————————\r
echo 按任意键关闭这个窗口。\r
pause >nul\r
`;
}

const README = (dir) => `这个文件夹是干什么的
================================

如果 dsh-skin 出了问题 —— 比如皮肤不见了、换了皮肤没反应、或者程序双击打不开 ——
按顺序双击这里的文件就行。**不需要懂技术，也不需要输入任何东西。**

  1 看看出了什么问题     先点这个。它只看，不改。
  2 回到上一个正常状态   给你看它打算改什么（还没真的改）。
  3 确认回退             看过第 2 步觉得没问题，再点这个。
  4 下次启动不套皮肤     程序打不开时先点它，再去打开程序。
  5 恢复正常启动         问题解决后点它。

双击之后会跳出一个黑色（或白色）的文字窗口，那是正常的 —— 看完里面的字，
按回车或任意键就能关掉。

几件不用担心的事
--------------------------------
· 回退**只写回和补建，从不删东西**。点错了最多是没变化，不会更糟。
· 你自己做的皮肤都在 ${dir} 里，上面这些操作一个都不会删掉它们。
· 每次改动之前程序都会自动存一个「还原点」，所以总有得退。

还是不行？
--------------------------------
把「1 看看出了什么问题」窗口里的全部文字复制下来，连同下面这句话一起
发给任何一个 AI 助手：

    这是 dsh-skin 的体检输出，请告诉我每一条是什么意思、下一步该点哪个文件。
    不要让我删除任何文件。

（这些文件由程序在每次启动时自动更新，不用手动维护。删了也没关系，下次启动会重新生成。）
`;

/**
 * 写出急救文件。
 * exe 和参数**必须分开传**：拼成一个字符串再引用，整串会被当成一个可执行文件名，
 * 双击的结果是 "No such file or directory"。这个错在打包后的程序里不会出现
 * （那时没有额外参数），只在开发模式下出现 —— 也就是只有测试的人会踩到，
 * 而用户踩到的时候没人在看。
 *
 * 失败不抛 —— 写不出急救文件不该让程序起不来，
 * 但会返回失败原因，好在「恢复」页里告诉用户"你现在没有这条后路"。
 */
function write(exePath, extraArgs = [], env) {
  try {
    const root = home.ensureDirs(env).root;
    const dir = path.join(root, DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });

    const isWindows = process.platform === "win32";
    for (const item of SCRIPTS) {
      const file = path.join(dir, `${item.order} ${item.name}${isWindows ? ".bat" : ".command"}`);
      const body = isWindows
        ? windowsScript(exePath, extraArgs, item.arg, item.note)
        : unixScript(exePath, extraArgs, item.arg, item.note);
      fs.writeFileSync(file, body);
      if (!isWindows) fs.chmodSync(file, 0o755);   // 不给执行位就双击不动
    }
    fs.writeFileSync(path.join(dir, "先读我.txt"), README(path.join(root, "skins")));
    return { ok: true, dir };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { write, DIR_NAME, SCRIPTS };
