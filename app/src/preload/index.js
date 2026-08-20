"use strict";
/**
 * 渲染进程能碰到的全部 API。
 *
 * 只暴露方法，不暴露 ipcRenderer 本身 —— 拿到 ipcRenderer 就等于拿到主进程里
 * 所有 handler 的调用权，包括以后才加的那些。这里列出来的就是全集。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cssGuard", {
  state: {
    read: () => ipcRenderer.invoke("state:read"),
    patch: (delta) => ipcRenderer.invoke("state:patch", delta),
  },
  skins: {
    list: () => ipcRenderer.invoke("skins:list"),
    refresh: () => ipcRenderer.invoke("skins:refresh"),
    select: (id) => ipcRenderer.invoke("skins:select", id),
    next: (id) => ipcRenderer.invoke("skins:next", id),
    preview: (id) => ipcRenderer.invoke("skins:preview", id),
    reveal: (id) => ipcRenderer.invoke("skins:reveal", id),
    create: (name) => ipcRenderer.invoke("skins:new", name),
    import: (name) => ipcRenderer.invoke("skins:import", name),
    remove: (id) => ipcRenderer.invoke("skins:delete", id),
  },
  shell: {
    open: (url) => ipcRenderer.invoke("shell:open", url),
    list: () => ipcRenderer.invoke("shell:list"),
    forget: (url) => ipcRenderer.invoke("shell:forget", url),
  },
  /** 救援。程序还开得起来时走这里；开不起来时同样的能力在命令行的
   *  css-guard doctor / undo / safe-mode 里，读写的是同一批文件。 */
  recovery: {
    status: () => ipcRenderer.invoke("recovery:status"),
    history: () => ipcRenderer.invoke("recovery:history"),
    preview: (id) => ipcRenderer.invoke("recovery:preview", id),
    restore: (id) => ipcRenderer.invoke("recovery:restore", id),
    snapshot: (label) => ipcRenderer.invoke("recovery:snapshot", label),
    safeMode: (on) => ipcRenderer.invoke("recovery:safe-mode", on),
    repair: () => ipcRenderer.invoke("recovery:repair"),
    revealHome: () => ipcRenderer.invoke("recovery:reveal-home"),
    revealRescue: () => ipcRenderer.invoke("recovery:reveal-rescue"),
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
    paths: () => ipcRenderer.invoke("app:paths"),
  },
  /** 主进程主动推的三种变化。返回一个取消订阅的函数。 */
  on: (event, handler) => {
    const allowed = ["skin:changed", "library:changed", "shell:changed", "recovery:open"];
    if (!allowed.includes(event)) throw new Error(`未知事件：${event}`);
    const wrapped = (_e, payload) => handler(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
});
