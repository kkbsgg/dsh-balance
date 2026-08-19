/**
 * dsh-balance — host half.
 *
 * Exposes the DeepSeek account balance over one loopback HTTP route that the
 * client half fetches. The API key never crosses the wire boundary: it is
 * resolved server-side through the standard credentials service using the
 * same reference the llm-deepseek adapter uses (`llm-deepseek.apiKeyEnv`,
 * default `DEEPSEEK_API_KEY`), so the Models-page key works out of the box.
 *
 * The response is a small normalized JSON document:
 *   { ok: true, isAvailable, balanceInfos: [{ currency, totalBalance, ... }], fetchedAt }
 *   { ok: false, code, message }
 */
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

/** Stable Cordis plugin name (also the client-modules graph row id). */
export const name = "dsh-balance";
/** Services required before the route can mount. */
export const inject = ["webServer"];
/** No composition knobs today; an empty schema keeps any row config valid. */
export const Config = z.object({});

/** Loopback-only route the browser client fetches. */
const BALANCE_PATH = "/dsh-balance/balance";
/** Credential reference fallback, mirroring the llm-deepseek adapter default. */
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Public DeepSeek API origin (the adapter's PUBLIC_BASE_URL). */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Settings namespace owning the llm-deepseek adapter configuration. */
const LLM_DEEPSEEK_NAMESPACE = "llm-deepseek";
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
 * Fetch and normalize the DeepSeek balance document. Every failure path
 * returns a structured `{ ok: false }` body instead of throwing, so the route
 * stays a pure data source for the client.
 * @param ctx - host plugin context.
 * @returns the normalized balance document.
 */
async function fetchBalance(ctx) {
	const { apiKeyEnv, baseURL } = deepSeekConnection(ctx);
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
		return { ok: false, code: "no-api-key", message: `no credential configured for ${apiKeyEnv}` };
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${baseURL}/user/balance`, {
			headers: {
				authorization: `Bearer ${key}`,
				accept: "application/json"
			},
			signal: controller.signal
		});
		if (!response.ok) {
			return { ok: false, code: `http-${response.status}`, message: `balance endpoint returned HTTP ${response.status}` };
		}
		const data = await response.json();
		const balanceInfos = Array.isArray(data?.balance_infos)
			? data.balance_infos.filter((info) => info !== null && typeof info === "object").map((info) => ({
				currency: typeof info.currency === "string" ? info.currency : "CNY",
				totalBalance: info.total_balance,
				grantedBalance: info.granted_balance,
				toppedUpBalance: info.topped_up_balance
			}))
			: [];
		return {
			ok: true,
			isAvailable: data?.is_available === true,
			balanceInfos,
			fetchedAt: new Date().toISOString()
		};
	} catch (error) {
		return {
			ok: false,
			code: "balance-request-failed",
			message: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Mount the balance route on the loopback webserver.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx) {
	let cache = { at: 0, value: null };
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
				const now = Date.now();
				if (cache.value !== null && now - cache.at < CACHE_TTL_MS) {
					sendJson(res, 200, cache.value);
					return;
				}
				const body = await fetchBalance(ctx);
				cache = { at: now, value: body };
				sendJson(res, 200, body);
			} catch (error) {
				ctx.logger.warn(`dsh-balance: route failure: ${error instanceof Error ? error.message : String(error)}`);
				sendJson(res, 500, { ok: false, code: "internal", message: "balance lookup failed" });
			}
		}
	}), "dsh-balance: balance route");
}
