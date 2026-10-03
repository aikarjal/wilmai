# wilma-cli tests

## Offline (mock Wilma, no credentials)

```bash
pnpm --filter @wilm-ai/wilma-cli test
```

- `news-resources.mjs`: bulletin attachments and downloads
- `mcp-login.mjs`: MCP server, browser login page, several Wilmas
- `mfa.mjs`: two-step verification (`MFA_STRICT=1` rejects reused codes)
- `audit.mjs`: download names, `--student` matching, argument checks, JSON errors, config safety

## Live (your own account)

Log in once with `wilma login`, then:

```bash
pnpm --filter @wilm-ai/wilma-cli test:live
```

Use another config with `WILMAI_CONFIG_PATH=/path/to/config.json`.
