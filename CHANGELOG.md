# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] — 2026-08-19

- Support every model provider, not just DeepSeek: the balance route now
  resolves the selected provider's own credential and base URL (the
  `llm-deepseek` section for the DeepSeek official route, the `llm-pi-ai`
  providers table for custom and other routes) and probes the DeepSeek-style
  `/user/balance` endpoint, falling back to the OpenAI-style
  `/v1/dashboard/billing/credit_grants` billing endpoint. Providers with no
  balance endpoint report `no-balance-endpoint` and the seat shows a dash.
- The client passes the selected provider (`?provider=<route>`) so the seat
  always reflects the active model's account.

## [0.1.2] — 2026-08-19

- Fix: the balance text no longer stays visible when the selected model is
  empty or not a DeepSeek official model. The balance is the DeepSeek account
  balance, so it now only renders while a `deepseek-official` model with a
  non-empty id is selected — switching to an empty or other-provider model
  hides it instead of retaining the stale value.

## [0.1.1] — 2026-08-19

- First release published automatically through the npm trusted-publishing
  (OIDC) pipeline on tag push — no manual 2FA at publish time.
- No functional changes.

## [0.1.0] — 2026-08-19

- Initial release: DeepSeek account balance display next to the composer
  model seat after a model and reasoning effort are selected.
- Host half mounts `GET /dsh-balance/balance` on the loopback webserver;
  resolves the API key through the credentials service (`llm-deepseek.apiKeyEnv`,
  default `DEEPSEEK_API_KEY`) and queries `<baseURL>/user/balance`.
- Client half renders the balance text in `conversation.input.right`, polls
  every 60s, and refreshes on click.
- GitHub Actions CI and README badges.
- `dsh.bundle` manifest for DSH plugin market installability.
- Published on npm as `@kkbsgg/dsh-balance`.
