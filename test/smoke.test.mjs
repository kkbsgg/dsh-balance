/**
 * Smoke test for the dsh-balance host half: drives `apply` with a minimal
 * fake context and asserts the balance route registration and provider-aware
 * responses. Runs without any harness running (node test/smoke.test.mjs).
 */
import assert from "node:assert/strict";

const { apply } = await import("../lib/index.js");

const routes = [];
const ctx = {
	webServer: {
		register(route) {
			routes.push(route);
			return () => {};
		}
	},
	effect(fn) {
		return fn();
	},
	get() {
		return undefined;
	},
	logger: { warn() {} }
};

apply(ctx);

assert.equal(routes.length, 1, "exactly one route is registered");
const route = routes[0];
assert.equal(route.kind, "exact", "route kind is exact");
assert.equal(route.path, "/dsh-balance/balance", "route path matches the client contract");
assert.equal(typeof route.handler, "function", "route has a handler");

/** Drive the handler with a fake request/response, returning the parsed body. */
async function callHandler(url, headers = {}) {
	const req = {
		method: "GET",
		headers: { host: "127.0.0.1:8247", origin: "http://127.0.0.1:8247", ...headers },
		url
	};
	let status = 0;
	let body = "";
	const res = {
		writeHead(code) {
			status = code;
		},
		end(payload) {
			body = String(payload);
		}
	};
	await route.handler(req, res);
	return { status, body: JSON.parse(body) };
}

// Same-origin GET without a provider defaults to deepseek-official; with no
// credentials the host answers a structured error, never a crash.
const noKey = await callHandler("/dsh-balance/balance");
assert.equal(noKey.status, 200, "same-origin GET returns 200");
assert.equal(noKey.body.ok, false, "no credential resolves to a structured error body");
assert.equal(noKey.body.code, "no-api-key", "error code identifies the missing credential");
assert.equal(noKey.body.provider, "deepseek-official", "default provider is deepseek-official");

// A provider with no settings section and no pi-ai profile is unsupported.
const unsupported = await callHandler("/dsh-balance/balance?provider=custom-route");
assert.equal(unsupported.body.code, "unsupported-provider", "unknown provider is reported as unsupported");
assert.equal(unsupported.body.provider, "custom-route", "provider id is echoed back");

console.log("smoke test OK");
