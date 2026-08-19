window.__ModuleLoader__.load({
	id: "dsh-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.ts
		/**
		* dsh-balance — client half.
		*
		* Renders a small balance text in the composer's right tool zone
		* (`conversation.input.right`, immediately next to the model seat). The
		* text appears only after a model — and with it a reasoning effort — is
		* selected for the active session (the ui-model-selection directory's
		* `current` selection), then polls the loopback host route
		* `/dsh-balance/balance` on an interval. Clicking the text refreshes
		* immediately.
		*
		* Only platform seed modules are imported (react, react/jsx-runtime), so
		* the bundle is load-order independent; all services are reached by name
		* through the plugin context at runtime.
		*/
		const BALANCE_ENDPOINT = "/dsh-balance/balance";
		const REFRESH_INTERVAL_MS = 60_000;
		const COPY = {
			en: {
				balance: "Balance",
				loading: "Balance…",
				unavailable: "Balance —",
				refresh: "Click to refresh balance",
				errorTitle: "Balance unavailable"
			},
			zh: {
				balance: "余额",
				loading: "余额…",
				unavailable: "余额 —",
				refresh: "点击刷新余额",
				errorTitle: "余额暂不可用"
			}
		};
		const STYLES = `
[data-balance-display] { box-sizing: border-box; height: 28px; min-width: 0; flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 20px; white-space: nowrap; user-select: none; cursor: pointer; border-radius: 8px; }
[data-balance-display]:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-balance-display][data-balance-state="error"] { color: var(--dsw-alias-state-warn-label); }
`;
		function copy() {
			return (document.documentElement.lang || navigator.language).toLowerCase().startsWith("zh") ? COPY.zh : COPY.en;
		}
		function noopSubscribe() {
			return () => {};
		}
		function emptySnapshot() {
			return null;
		}
		/** Format one balance entry for display: ¥12.34 / USD 12.34. */
		function formatBalance(info) {
			if (info === null || typeof info !== "object") return "—";
			const value = info.totalBalance;
			if (value === void 0 || value === null) return "—";
			const text = String(value);
			const currency = typeof info.currency === "string" && info.currency.length > 0 ? info.currency : "CNY";
			return currency === "CNY" ? `¥${text}` : `${currency} ${text}`;
		}
		/**
		* The composer balance seat. `directory` is the active session's shared
		* model-selection store (undefined when ui-model-selection is absent or
		* the session cannot resolve one).
		*/
		function BalanceText({ sessionId, directory }) {
			const modelState = react.useSyncExternalStore(directory === void 0 ? noopSubscribe : directory.subscribe, directory === void 0 ? emptySnapshot : directory.getSnapshot);
			const selected = modelState !== null && modelState !== void 0 && modelState.current !== null && modelState.status === "ready";
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const seq = react.useRef(0);
			const refresh = react.useCallback(() => {
				const id = ++seq.current;
				setLoading(true);
				fetch(BALANCE_ENDPOINT, { cache: "no-store" }).then((response) => response.json()).then((body) => {
					if (seq.current !== id) return;
					setData(body);
					setError(null);
					setLoading(false);
				}).catch((cause) => {
					if (seq.current !== id) return;
					setError(cause instanceof Error ? cause.message : String(cause));
					setData(null);
					setLoading(false);
				});
			}, []);
			react.useEffect(() => {
				if (!selected) return;
				refresh();
				const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
				return () => {
					clearInterval(timer);
					seq.current += 1;
				};
			}, [selected, refresh]);
			if (!selected) return null;
			const c = copy();
			const unavailable = error !== null || data === null || data.ok !== true;
			const label = loading && data === null
				? c.loading
				: unavailable
					? c.unavailable
					: `${c.balance} ${Array.isArray(data.balanceInfos) && data.balanceInfos.length > 0 ? data.balanceInfos.map(formatBalance).join(" · ") : "—"}`;
			const title = unavailable && error !== null
				? `${c.errorTitle}: ${String(error)}`
				: c.refresh;
			return react_jsx_runtime.jsx("span", {
				"data-balance-display": "",
				"data-balance-state": unavailable && error !== null ? "error" : void 0,
				role: "status",
				"aria-live": "polite",
				title,
				onClick: () => {
					refresh();
				},
				children: label
			}, sessionId);
		}
		/** Install and remove the balance seat styles. */
		function installStyles() {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-balance";
			style.dataset.pluginCss = "dsh-balance/balance-seat";
			style.textContent = STYLES;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/** Cordis plugin name. */
		const name = "dsh-balance";
		/** Services required before the contribution can register. */
		const inject = ["slots"];
		/**
		* Register the balance seat into the composer's right tool zone once the
		* conversation layout declares it.
		* @param ctx - browser Cordis context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const removeStyles = installStyles();
				const dispose = ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "balance",
					order: 0,
					inject: (sessionId) => {
						const models = ctx.get("modelDirectories");
						if (models === void 0) return {};
						try {
							return { directory: models.directoryFor(sessionId).store };
						} catch {
							return {};
						}
					}
				}, BalanceText));
				return () => {
					dispose();
					removeStyles();
				};
			}, "dsh-balance: composer balance seat");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
