# Testing

wilmai uses two tiers of tests.

## 1) Offline tests (no credentials)

Safe for CI (`.github/workflows/ci.yml` runs them on Node 20 and 22). They use fixtures and mock Wilma servers on 127.0.0.1.

```bash
pnpm install
pnpm --filter @wilm-ai/wilma-client test   # parsers, login, sessions, downloads, audit regressions
pnpm --filter @wilm-ai/wilma-cli test      # CLI, MCP server, login page, two-step verification
pnpm --filter @wilm-ai/relay test          # hosted relay: OAuth + MCP flow and pressure tests
pnpm -r lint                               # type checks (and the site's ESLint)
```

`MFA_STRICT=1 node packages/wilma-cli/test/mfa.mjs` makes the mock reject reused one-time codes (slower: it waits for fresh codes).

Parsers are also tested against anonymised copies of real Wilma pages in `packages/wilma-client/test/fixtures/real`. To refresh them after Wilma changes, save the pages from your own account and run `node packages/wilma-client/scripts/anonymize-fixture.mjs` (see the comment at its top); read the result before committing it.

Bulletin links are only fetched from public internet addresses. Tests that serve "external" files from 127.0.0.1 set `WILMAI_ALLOW_PRIVATE_NETWORK=1`; nothing else should.

## 2) Live tests (opt-in, your own Wilma account)

Run these locally only. No secrets are committed to the repo.

### Wilma client
1. Copy `packages/wilma-client/test/.env.example` to `packages/wilma-client/test/.env.local` and fill in your login.
2. Run:
   ```bash
   pnpm --filter @wilm-ai/wilma-client test:live
   ```

### Wilma CLI
1. Log in once with `wilma login` (saved to `~/.config/wilmai/config.json`, or `$XDG_CONFIG_HOME/wilmai/config.json`).
2. Run:
   ```bash
   pnpm --filter @wilm-ai/wilma-cli test:live
   ```
   Use another saved login with `WILMAI_CONFIG_PATH=/path/to/config.json`.

### Notes
- The tests assume at least one student on the account.
- For the CLI, `wilma students` must return at least one student. The run should need at most one login (commands continue the saved session).
