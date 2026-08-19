# dsh-balance

![CI](https://github.com/kkbsgg/dsh-balance/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-0.2.0-blueviolet)

DeepSeek Harness plugin that displays the **selected model provider's account
balance** as a small text next to the composer's model seat, once a model (and
its reasoning effort) is selected for the active conversation.

## How it works

- **Host half** (`lib/index.js`, a Cordis plugin) mounts one loopback HTTP
  route — `GET /dsh-balance/balance?provider=<route>` — on the webserver. The
  route resolves the **selected provider's own** API key through the standard
  credentials service (the `llm-deepseek` section for the DeepSeek official
  route, the `llm-pi-ai` providers table for custom/other routes), then probes
  the provider's balance: DeepSeek-style `GET <baseURL>/user/balance` first,
  falling back to the OpenAI-style `GET <baseURL>/v1/dashboard/billing/credit_grants`.
  The key never crosses the wire boundary.
- **Client half** (`client/client.js`, a web client plugin) registers a seat
  into the `conversation.input.right` slot (immediately beside the model
  selector). It subscribes to the active session's model-selection directory
  (`modelDirectories`), passes the selected provider to the route, and only
  renders after a model with a non-empty id is selected — an empty selection
  hides the text instead of retaining a stale balance. Polls every 60s;
  clicking the text refreshes immediately.

## Installation

### From source (any DSH profile)

The package declares a `dsh.bundle` manifest, so it installs through the
standard plugin command once the repo is resolvable:

```sh
dsh plugin add @kkbsgg/dsh-balance
```

### Manual (packaged DSH Desktop)

With the package resolvable from the profile's `node_modules`, add one loader
row to the profile patch (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: balance
      name: 'dsh-balance'
```

and restart the application so the loader composes the new row. Subsequent
edits to the client bundle hot-reload through the client HMR channel.

For the packaged DSH Desktop app, the package lives in the app's unpacked
`node_modules` and is linked into `$DSH_HOME/profiles/node_modules` as a
junction, so the profile loader resolves it exactly like the in-box plugins.

> Note: the package is installed by hand into the pnpm-managed hoisted store.
> A future `pnpm install` in the profile may prune it; re-create the link if
> the balance text disappears after a plugin-market install.

## Repository layout

```
dsh-balance/  (@kkbsgg/dsh-balance)
├── lib/index.js           # host half (Cordis plugin + balance route)
├── client/client.js       # client half (web client plugin bundle)
├── test/smoke.test.mjs    # host-half smoke test (run: node test/smoke.test.mjs)
├── cordis.patch.yml       # dsh.bundle patch (market installability)
├── package.json           # dsh.bundle + dsh.client manifest
├── CHANGELOG.md
├── .editorconfig
└── README.md
```

The live copy currently installed in the DSH Desktop app lives under the app's
unpacked `node_modules`; this repository is the source of truth. After
changing code here, re-sync the files into the installed copy (or install the
package from this repo and re-create the profile link).

## Response shape

```jsonc
{ "ok": true, "isAvailable": true,
  "balanceInfos": [{ "currency": "CNY", "totalBalance": "110.00", "grantedBalance": "10.00", "toppedUpBalance": "100.00" }],
  "fetchedAt": "2026-01-01T00:00:00.000Z" }
{ "ok": false, "code": "no-api-key", "message": "no credential configured for DEEPSEEK_API_KEY" }
```
