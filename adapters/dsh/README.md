# dsh-css-guard

Serves a `css-guard` library to a DSH (DeepSeek Harness) renderer.

## Why this exists

DSH's plugin route serves exactly one file per plugin — `/plugins/<pkg>/client.js`. Every other path
under a mounted plugin returns 404, and the renderer refuses `file://`. So the browser half can only
reach artwork over http.

Putting that server **inside the plugin** rather than in a separate process is the point: installing
the plugin is the whole install, and the server dies with the host instead of outliving it. The
earlier design used a standalone script, and the first time someone forgot to start it, DSH silently
lost every backdrop while the picker still worked — which reads as "the skin is broken".

DSH 每个插件只开一条静态路由，别的路径一律 404，渲染进程又拒绝 `file://`，所以只能走 http。
服务放进插件里，装插件就是全部安装步骤，而且它跟着宿主一起死 —— 独立进程那一版，
第一次有人忘了启动，表现是「挑选器还能用但一张背景都没有」，读起来像皮肤坏了。

## Endpoints

```
GET /catalog.json      皮肤目录
GET /css/<id>          可注入的 CSS，__SKIN__ 已替换
                       带 error 的皮肤返回 409，响应体里是拒绝原因
GET /skin/<id>/<path>  素材，长缓存、immutable
```

Only listens on `127.0.0.1`. `CSS_GUARD_PORT` 改端口（默认 3099），`CSS_GUARD_BUILTIN` 加一个皮肤根。

## Verification status · 验证边界

**Tested** (`test/server.test.js`, runs in CI): the catalogue, CSS compilation and placeholder
substitution, the 409 refusal for skins the linter rejects, path-traversal guards including encoded
`..`, the 404s, and the method allowlist.

**Not tested:** mounting the plugin into a live DSH, and the browser half (`lib/client.js`). Treat
those as unverified until you have run them against your own DSH.

**测过的**：目录、CSS 编译与占位符替换、检查器拒绝时的 409、路径穿越（含编码过的 `..`）、
404、方法白名单 —— 这些在 CI 里跑。
**没测过的**：把插件挂进真实 DSH，以及浏览器那半（`lib/client.js`）。在你自己的 DSH 上跑通之前，
把它们当作未验证的。

MIT
