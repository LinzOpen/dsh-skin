/**
 * DSH 插件入口（宿主那半）。
 *
 * 它只做一件事：把一个 dsh-skin 皮肤库通过本地 http 端口暴露给 DSH 的渲染进程，
 * 并跟着宿主一起启动、一起关闭。皮肤的检查、编译、素材解析全在 @dsh-skin/core
 * 和 ./server.js 里，这个文件不重复实现任何一条规则。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createAssetServer } from "./server.js";

const name = "dsh-skin-adapter";
const inject = [];

/** 皮肤根，顺序即优先级：用户目录里的同 id 皮肤覆盖仓库自带的。 */
function defaultRoots() {
  const roots = [];
  if (process.env.DSH_SKIN_BUILTIN) roots.push(process.env.DSH_SKIN_BUILTIN);
  roots.push(join(homedir(), ".dsh-skin", "skins"));
  return roots.filter(Boolean);
}

function apply(ctx) {
  const log = (message) => ctx?.logger?.("dsh-skin")?.info?.(message);
  const roots = defaultRoots();
  if (!roots.some(existsSync)) {
    log(`皮肤目录都不存在，插件空转：${roots.join(" / ")}`);
    return;
  }
  const port = Number(process.env.DSH_SKIN_PORT || 3099);
  const api = createAssetServer({ roots, port });

  api.server.on("error", (error) => {
    // EADDRINUSE 说明这个端口上已经有一个素材服务 —— 可能是第二个 DSH 实例。
    // 浏览器那半只需要端口上有**某个**服务，所以这不算失败。
    log(error.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，沿用已有的素材服务`
      : `素材服务启动失败：${error.message}`);
  });

  api.listen()
    .then((base) => log(`素材服务 ${base} → ${roots.join(" / ")}（${api.list().length} 套皮肤）`))
    .catch(() => { /* 上面的 error 处理器已经说明过了 */ });

  ctx?.on?.("dispose", () => { api.close().catch(() => {}); });
}

export { apply, inject, name, defaultRoots };
