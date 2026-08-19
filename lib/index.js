/**
 * dsh-balance — host half.
 *
 * Exposes the selected model provider's account balance over one loopback
 * HTTP route that the client half fetches. The API key never crosses the wire
 * boundary: it is resolved server-side through the standard credentials
 * service, using the same reference the harness adapters use — the
 * `llm-deepseek` settings for the DeepSeek official route, and the
 * `llm-pi-ai` provider profiles for every other route the Models page or a
 * settings section declares — so whatever model is selected, its provider's
 * credential is the one used.
 *
 * Balance endpoints vary by provider, so the route probes in order:
 *   1. DeepSeek-style  `GET {baseURL}/user/balance`
 *   2. OpenAI-style    `GET {baseURL}/v1/dashboard/billing/credit_grants`
 *                      (also without the /v1 prefix for bases that carry it)
 * and reports `no-balance-endpoint` for providers that expose none.
 *
 * The response is a small normalized JSON document:
 *   { ok: true, provider, source, isAvailable,
 *     balanceInfos: [{ currency, totalBalance, ... }], fetchedAt }
 *   { ok: false, code, message, provider }
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

/** Stable Cordis plugin name (also the client-modules graph row id). */
export const name = "@kkbsgg/dsh-balance";
/** Services required before the route can mount. */
export const inject = ["webServer"];
/** No composition knobs today; an empty schema keeps any row config valid. */
export const Config = z.object({});

/** Loopback-only route the browser client fetches. */
const BALANCE_PATH = "/dsh-balance/balance";
/** Provider id of the DeepSeek official adapter route. */
const DEEPSEEK_PROVIDER = "deepseek-official";
/** Credential reference fallback, mirroring the llm-deepseek adapter default. */
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Public DeepSeek API origin (the adapter's PUBLIC_BASE_URL). */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Settings namespaces owning the deepseek and pi-ai adapter sections. */
const LLM_DEEPSEEK_NAMESPACE = "llm-deepseek";
const LLM_PI_AI_NAMESPACE = "llm-pi-ai";
/** In-process cache TTL so a room full of sessions does not hammer the API. */
const CACHE_TTL_MS = 15_000;
/** Outbound request budget. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Reject non-browser and cross-origin callers; loopback-only data anyway. */
function sameOrigin(req) {
	const origin = req.headers?.origin;
	if (origin === void 0 || origin === "") return true;
	try {
		return new URL(origin).host === req.headers?.host;
	} catch {
		return false;
	}
}

/** Write one JSON response with the loopback cache-control header. */
function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}

/**
 * Resolve the DeepSeek connection facts from the live settings snapshot,
 * falling back to the adapter defaults when the namespace is absent.
 * @param ctx - host plugin context.
 * @returns the credential reference and API base URL.
 */
function deepSeekConnection(ctx) {
	let apiKeyEnv = DEFAULT_API_KEY_ENV;
	let baseURL = DEFAULT_BASE_URL;
	const settings = ctx.get("settings");
	if (settings !== void 0) {
		try {
			const section = settings.get(LLM_DEEPSEEK_NAMESPACE);
			if (section !== null && typeof section === "object") {
				if (typeof section.apiKeyEnv === "string" && section.apiKeyEnv.length > 0) apiKeyEnv = section.apiKeyEnv;
				if (typeof section.baseURL === "string" && section.baseURL.length > 0) baseURL = section.baseURL.replace(/\/+$/, "");
			}
		} catch (error) {
			ctx.logger.warn(`dsh-balance: reading llm-deepseek settings failed, using defaults: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { apiKeyEnv, baseURL };
}

/**
 * Resolve the connection facts for one provider route: the DeepSeek official
 * route reads the `llm-deepseek` section; every other route is looked up in
 * the `llm-pi-ai` providers table (what the Models page writes for custom
 * providers). A route with no baseURL or credential reference is unsupported.
 * @param ctx - host plugin context.
 * @param provider - the selected model's provider route id.
 * @returns connection facts, or undefined when the route is unknown.
 */
function providerConnection(ctx, provider) {
	if (provider === DEEPSEEK_PROVIDER) return deepSeekConnection(ctx);
	const settings = ctx.get("settings");
	if (settings === void 0) return void 0;
	let section;
	try {
		section = settings.get(LLM_PI_AI_NAMESPACE);
	} catch {
		return void 0;
	}
	const profile = section?.providers?.[provider];
	if (profile === null || typeof profile !== "object") return void 0;
	const apiKeyEnv = typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : void 0;
	const baseURL = typeof profile.baseURL === "string" && profile.baseURL.length > 0 ? profile.baseURL.replace(/\/+$/, "") : void 0;
	if (apiKeyEnv === void 0 || baseURL === void 0) return void 0;
	return { apiKeyEnv, baseURL };
}

/**
 * Probe one balance endpoint. Returns `{ kind: "ok", data }`, `{ kind: "error",
 * status }` for a reachable non-2xx response, `{ kind: "missing" }` for
 * 404/405 (the endpoint does not exist), or `{ kind: "network", error }`.
 */
async function probeEndpoint(baseURL, path, key, controller) {
	let response;
	try {
		response = await fetch(`${baseURL}${path}`, {
			headers: { authorization: `Bearer ${key}`, accept: "application/json" },
			signal: controller.signal
		});
	} catch (error) {
		return { kind: "network", error };
	}
	if (response.status === 404 || response.status === 405) return { kind: "missing" };
	try {
		const data = await response.json();
		return response.ok ? { kind: "ok", data } : { kind: "error", status: response.status };
	} catch {
		return response.ok ? { kind: "ok", data: void 0 } : { kind: "error", status: response.status };
	}
}

/** Normalize a DeepSeek-style `user/balance` document. */
function normalizeDeepSeek(data) {
	const balanceInfos = Array.isArray(data?.balance_infos)
		? data.balance_infos.filter((info) => info !== null && typeof info === "object").map((info) => ({
			currency: typeof info.currency === "string" ? info.currency : "CNY",
			totalBalance: info.total_balance,
			grantedBalance: info.granted_balance,
			toppedUpBalance: info.topped_up_balance
		}))
		: [];
	return { isAvailable: data?.is_available === true, balanceInfos };
}

/** Normalize an OpenAI-style `credit_grants` document; undefined when it is not one. */
function normalizeOpenAi(data) {
	if (data === null || typeof data !== "object") return void 0;
	const total = data.total_available;
	if (typeof total !== "number" && typeof total !== "string") return void 0;
	return {
		isAvailable: true,
		balanceInfos: [{
			currency: "USD",
			totalBalance: String(total),
			grantedBalance: data.total_granted,
			toppedUpBalance: void 0
		}]
	};
}

/**
 * Fetch and normalize the balance for one provider route. Every failure path
 * returns a structured `{ ok: false }` body instead of throwing, so the route
 * stays a pure data source for the client.
 * @param ctx - host plugin context.
 * @param provider - the selected model's provider route id.
 * @returns the normalized balance document.
 */
async function fetchBalance(ctx, provider) {
	const connection = providerConnection(ctx, provider);
	if (connection === void 0) {
		return { ok: false, code: "unsupported-provider", message: `no balance source for provider "${provider}"`, provider };
	}
	const { apiKeyEnv, baseURL } = connection;
	let key;
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		try {
			const hit = await credentials.resolve(credentialRef(apiKeyEnv));
			key = hit?.value;
		} catch (error) {
			ctx.logger.warn(`dsh-balance: credential resolution failed: ${error instanceof Error ? error.message : String(error)}`);
			key = void 0;
		}
	}
	if (key === void 0 || key.length === 0) {
		return { ok: false, code: "no-api-key", message: `no credential configured for ${apiKeyEnv}`, provider };
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const deepSeek = await probeEndpoint(baseURL, "/user/balance", key, controller);
		if (deepSeek.kind === "ok" && deepSeek.data !== void 0) {
			const normalized = normalizeDeepSeek(deepSeek.data);
			return { ok: true, provider, source: "deepseek", ...normalized, fetchedAt: new Date().toISOString() };
		}
		if (deepSeek.kind === "error") {
			return { ok: false, code: `http-${deepSeek.status}`, message: `"${provider}" balance endpoint returned HTTP ${deepSeek.status}`, provider };
		}
		if (deepSeek.kind === "network") {
			return { ok: false, code: "balance-request-failed", message: deepSeek.error instanceof Error ? deepSeek.error.message : String(deepSeek.error), provider };
		}
		const grantPaths = baseURL.endsWith("/v1")
			? ["/dashboard/billing/credit_grants"]
			: ["/v1/dashboard/billing/credit_grants", "/dashboard/billing/credit_grants"];
		let endpointError;
		for (const path of grantPaths) {
			const probe = await probeEndpoint(baseURL, path, key, controller);
			if (probe.kind === "ok" && probe.data !== void 0) {
				const normalized = normalizeOpenAi(probe.data);
				if (normalized !== void 0) {
					return { ok: true, provider, source: "openai-billing", ...normalized, fetchedAt: new Date().toISOString() };
				}
			} else if (probe.kind === "error" && endpointError === void 0) {
				endpointError = probe.status;
			} else if (probe.kind === "network") {
				return { ok: false, code: "balance-request-failed", message: probe.error instanceof Error ? probe.error.message : String(probe.error), provider };
			}
		}
		if (endpointError !== void 0) {
			return { ok: false, code: `http-${endpointError}`, message: `"${provider}" billing endpoint returned HTTP ${endpointError}`, provider };
		}
		return { ok: false, code: "no-balance-endpoint", message: `"${provider}" exposes no supported balance endpoint`, provider };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Mount the balance route on the loopback webserver. The client selects the
 * provider with a `?provider=<route>` query parameter.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx) {
	const cache = new Map();
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BALANCE_PATH,
		handler: async (req, res) => {
			try {
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				if (!sameOrigin(req)) {
					sendJson(res, 403, { ok: false, code: "forbidden", message: "balance is limited to same-origin requests" });
					return;
				}
				const provider = new URL(req.url ?? "/", "http://x").searchParams.get("provider") ?? DEEPSEEK_PROVIDER;
				const now = Date.now();
				const cached = cache.get(provider);
				if (cached !== void 0 && now - cached.at < CACHE_TTL_MS) {
					sendJson(res, 200, cached.value);
					return;
				}
				const body = await fetchBalance(ctx, provider);
				cache.set(provider, { at: now, value: body });
				sendJson(res, 200, body);
			} catch (error) {
				ctx.logger.warn(`dsh-balance: route failure: ${error instanceof Error ? error.message : String(error)}`);
				sendJson(res, 500, { ok: false, code: "internal", message: "balance lookup failed" });
			}
		}
	}), "dsh-balance: balance route");
}
