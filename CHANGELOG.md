# Changelog

All notable changes to this project are documented in this file.

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
