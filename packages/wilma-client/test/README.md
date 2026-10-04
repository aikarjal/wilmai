# wilma-client tests

## Offline (fixtures and mock servers)

```bash
pnpm --filter @wilm-ai/wilma-client test
```

Parser tests use inline fixtures; `real-pages.mjs` and `client-features.mjs` use anonymised copies of real Wilma pages in `fixtures/real/` (made with `scripts/anonymize-fixture.mjs`, which replaces every name and text while keeping markup, dates, codes and Wilma's labels). `audit.mjs` covers the private-network guard for bulletin links, Wilma-only redirects and cookies, stopping after a refused login, and Finnish time on machines in other time zones.

## Live test (opt-in)

1. Copy `test/.env.example` to `test/.env.local` and fill in your login.
2. Run:
   ```bash
   pnpm --filter @wilm-ai/wilma-client test:live
   ```

Point to a different env file with `WILMA_ENV_PATH=/path/to/.env`. Never commit `.env.local`.
