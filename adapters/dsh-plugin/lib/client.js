window.__ModuleLoader__.load({
	id: "dsh-skin-adapter",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * DSH 插件（浏览器那半）：一个挑选器 + 把选中的皮肤 CSS 挂上去。
		 *
		 * 三条约束，每一条都对应一次真实故障：
		 *
		 * 1. 素材必须走 http。这个构建给插件只开一条静态路由（client.js），
		 *    挂载目录下的别的路径一律 404，渲染进程又拒绝 file://。
		 *    所以宿主那半在 127.0.0.1 上开了个服务，这里去拿。
		 * 2. 服务没起来时，界面必须**看起来是刻意的**，不能像坏了。
		 *    所以取不到目录就安静地什么都不做，而不是弹一个红色报错。
		 * 3. 绝不写 infinite 动画。一条铺满窗口的永动动画曾把这个宿主
		 *    从 2.5% CPU 拉到 111%。
		 */

		const inject = [];
		const PORT = 3099;
		const BASE = `http://127.0.0.1:${PORT}`;
		const STORE = "dsh-skin.selected.v1";
		const STYLE_ID = "dsh-skin-css";
		const PANEL_ID = "dsh-skin-panel";

		const read = () => { try { return window.localStorage.getItem(STORE) || ""; } catch { return ""; } };
		const save = (id) => { try { window.localStorage.setItem(STORE, id); } catch { /* 无痕模式 */ } };

		/** 换的是同一个 <style> 的内容，不是删了再插 —— 删插会闪一帧。 */
		function mount(css) {
			let style = document.getElementById(STYLE_ID);
			if (!style) {
				style = document.createElement("style");
				style.id = STYLE_ID;
				document.head.appendChild(style);
			}
			style.textContent = css || "";
		}

		async function applySkin(id) {
			if (!id || id === "none") { mount(""); save("none"); return { ok: true }; }
			const res = await fetch(`${BASE}/css/${encodeURIComponent(id)}`);
			// 409 = 服务端的检查器拒绝提供这套皮肤。它在响应体里写了原因，
			// 照原样打进控制台，而不是笼统地说"套用失败"。
			if (res.status === 409) {
				console.warn(`[dsh-skin] ${id} 被检查器拒绝：\n${await res.text()}`);
				return { ok: false, blocked: true };
			}
			if (!res.ok) return { ok: false };
			mount(await res.text());
			save(id);
			return { ok: true };
		}

		function panelStyle() {
			const style = document.createElement("style");
			style.textContent = `
#${PANEL_ID}{position:fixed;right:16px;bottom:56px;width:min(680px,66vw);max-height:60vh;
 overflow:auto;z-index:2147483000;display:none;padding:14px;border-radius:14px;
 background:#101826f2;color:#e8eef7;border:1px solid #ffffff24;box-shadow:0 24px 64px #00000070;
 font:13px/1.5 -apple-system,"PingFang SC",system-ui,sans-serif}
#${PANEL_ID}[data-open="1"]{display:block}
#${PANEL_ID} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
#${PANEL_ID} .card{border:1px solid #ffffff1f;border-radius:9px;overflow:hidden;cursor:pointer;
 background:#0009;transition:border-color 160ms ease}
#${PANEL_ID} .card:hover,#${PANEL_ID} .card:focus-visible{border-color:#7fb7ff;outline:none}
#${PANEL_ID} .card[data-on="1"]{border-color:#ffd479}
#${PANEL_ID} .card .sw{display:block;width:100%;aspect-ratio:16/9;background-size:cover;background-position:center}
#${PANEL_ID} .card figcaption{padding:5px 7px;font-size:11px;color:#c6d3e8}
#dsh-skin-toggle{position:fixed;right:16px;bottom:16px;z-index:2147483000;padding:7px 13px;
 border-radius:999px;cursor:pointer;background:#101826e6;color:#e8eef7;border:1px solid #ffffff2b;
 font:12px/1 -apple-system,"PingFang SC",system-ui,sans-serif}`;
			return style;
		}

		function swatchFor(entry) {
			if (entry.preview) return `background-image:url("${entry.preview}")`;
			const [light, dark, accent] = entry.swatch || [];
			if (light && dark) return `background:linear-gradient(118deg,${light} 0 47%,${accent || dark} 47% 53%,${dark} 53% 100%)`;
			return `background:${entry.accent || "#4c6ef5"}`;
		}

		async function boot() {
			let catalog = [];
			try { catalog = await (await fetch(`${BASE}/catalog.json`)).json(); }
			catch { return; }                       // 服务没起来：安静退出，界面保持原样
			if (!Array.isArray(catalog) || !catalog.length) return;

			document.head.appendChild(panelStyle());

			const panel = document.createElement("div");
			panel.id = PANEL_ID;
			const grid = document.createElement("div");
			grid.className = "grid";
			panel.appendChild(grid);

			const paint = () => {
				const current = read();
				grid.replaceChildren();
				for (const entry of catalog) {
					const card = document.createElement("figure");
					card.className = "card";
					card.tabIndex = 0;
					card.dataset.on = current === entry.id ? "1" : "0";
					const sw = document.createElement("span");
					sw.className = "sw";
					sw.setAttribute("style", swatchFor(entry));
					const cap = document.createElement("figcaption");
					cap.textContent = entry.name || entry.id;   // 目录内容当不可信输入，只用 textContent
					card.append(sw, cap);
					card.addEventListener("click", async () => { await applySkin(entry.id); paint(); });
					grid.appendChild(card);
				}
			};
			paint();

			const toggle = document.createElement("button");
			toggle.id = "dsh-skin-toggle";
			toggle.textContent = "皮肤";
			toggle.addEventListener("click", () => {
				panel.dataset.open = panel.dataset.open === "1" ? "0" : "1";
			});

			document.body.append(panel, toggle);
			const remembered = read();
			if (remembered && remembered !== "none") applySkin(remembered);
		}

		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
		else boot();

		exports.inject = inject;
		exports.applySkin = applySkin;
		return module.exports;
	},
});
