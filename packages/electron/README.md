# css-guard-electron

Make an Electron window skinnable.

```bash
npm install css-guard-electron
```

```js
const { registerSkinScheme, createSkinHost } = require("css-guard-electron");

registerSkinScheme();                                  // 必须在 app ready 之前

const skins = createSkinHost({ roots: [skinsDir] });   // ready 之后
skins.install();
skins.attach(win);
await skins.apply("midnight-harbor");
```

Three things this does that are easy to get wrong, each of which shows up as
"the skin doesn't seem to work":

1. **Registers the custom protocol before `ready`.** Too late is silent — assets just 404.
2. **Serialises `insertCSS`.** Concurrent switches leave the previous skin's CSS in the page for
   good. Observed symptom: new palette applied, old backdrop still showing.
3. **Runs the linter before injecting**, and refuses skins that reach the network.
   See [docs/security.md](../../docs/security.md).

Full guide, including what the renderer side has to expose: [docs/hosts.md](../../docs/hosts.md).

MIT
