"use strict";
/**
 * 渲染进程能碰到的全部 API。
 *
 * 只暴露方法，不暴露 ipcRenderer 本身 —— 拿到 ipcRenderer 就等于拿到主进程里
 * 所有 handler 的调用权，包括以后才加的那些。这里列出来的就是全集。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshSkin", {
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
  app: {
    openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
    paths: () => ipcRenderer.invoke("app:paths"),
  },
  /** 主进程主动推的三种变化。返回一个取消订阅的函数。 */
  on: (event, handler) => {
    const allowed = ["skin:changed", "library:changed", "shell:changed"];
    if (!allowed.includes(event)) throw new Error(`未知事件：${event}`);
    const wrapped = (_e, payload) => handler(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
});
