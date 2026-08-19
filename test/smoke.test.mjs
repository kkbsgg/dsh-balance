/**
 * Smoke test for the dsh-balance host half: drives `apply` with a minimal
 * fake context and asserts the balance route is registered with the right
 * shape. Runs without any harness running (node test/smoke.test.mjs).
 */
import assert from "node:assert/strict";

const { apply } = await import("../lib/index.js");

let registered = null;
const routes = [];
const ctx = {
	webServer: {
		register(route) {
			routes.push(route);
			registered = route;
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
assert.equal(registered.kind, "exact", "route kind is exact");
assert.equal(registered.path, "/dsh-balance/balance", "route path matches the client contract");
assert.equal(typeof registered.handler, "function", "route has a handler");

// The handler must answer a same-origin GET without throwing and without a
// configured credential (structured error body, never a crash).
const req = {
	method: "GET",
	headers: { host: "127.0.0.1:8247", origin: "http://127.0.0.1:8247" },
	url: "/dsh-balance/balance"
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
await registered.handler(req, res);
assert.equal(status, 200, "same-origin GET returns 200");
const parsed = JSON.parse(body);
assert.equal(parsed.ok, false, "no credential resolves to a structured error body");
assert.equal(parsed.code, "no-api-key", "error code identifies the missing credential");

console.log("smoke test OK");
