# WilmAI relay (private testing)

A hosted MCP endpoint so Claude and ChatGPT on the web and phone can use WilmAI. **Not public.** Only Wilma usernames listed in `RELAY_ALLOWED_USERS` can connect.

## How it works

- **OAuth 2.1 with PKCE**, dynamic client registration and client ID metadata documents — what Claude custom connectors and ChatGPT developer mode expect.
- **The authorization page is the Wilma login page** (same page as `wilma login`). The relay checks the login with the school's Wilma, then seals it (AES-256-GCM) into the authorization code and tokens.
- **No database.** Client registrations, codes and tokens are all sealed blobs. The AI app holds the tokens; the relay unseals one in memory per request. Nothing is written or logged.
- **Revoking:** rotate `RELAY_SECRET` (revokes every token), remove a username from `RELAY_ALLOWED_USERS` (checked on every request), or change the Wilma password.
- Only Wilma addresses from the official tenant list are accepted.
- The login page says which app is connecting and where the parent will be sent back; sign-ins can only return to Claude, ChatGPT or apps on the user's own computer.
- After 5 wrong passwords for a username or from one address, logins pause for 15 minutes (per server instance — no database). Wilma allows one live session per account, so tool calls share a session per account within an instance.
- Attachments over 3 MB aren't returned inline (Vercel's 4.5 MB response cap); the tool says where to open them instead.

The relay still sees Wilma passwords and school data in memory while handling a request, so it processes personal data. Get a legal review before any public rollout.

## Endpoints

| Path | |
|---|---|
| `/mcp` | Streamable HTTP MCP (stateless, bearer token) |
| `/.well-known/oauth-protected-resource[/mcp]` | RFC 9728 |
| `/.well-known/oauth-authorization-server` | RFC 8414 |
| `/register` | RFC 7591 dynamic client registration |
| `/authorize` | Wilma login page |
| `/token` | `authorization_code` and `refresh_token` grants |

## Environment

| Variable | |
|---|---|
| `RELAY_SECRET` | 32+ random characters (`openssl rand -hex 32`). Mark as Sensitive in Vercel. |
| `RELAY_ALLOWED_USERS` | Comma-separated logins allowed to connect: a username (any Wilma) or `https://<school>.inschool.fi\|username` (that Wilma only). Empty = nobody. |
| `RELAY_ORIGIN` | Optional public origin, e.g. `https://mcp.wilm.ai` (otherwise taken from the request). |
| `RELAY_REDIRECT_HOSTS` | Optional. Hosts a sign-in may return to (default `claude.ai,claude.com,chatgpt.com,chat.openai.com`; apps on the user's computer via `localhost` are always allowed). |
| `RELAY_ALLOW_ANY_TENANT` | Tests only (`=1`): accept Wilma addresses outside the official list, for mock servers. Ignored in production builds. |

## Deploy (Vercel)

Separate project from the site, root directory `apps/relay`, build command `pnpm run vercel-build` (builds the Wilma packages first). Functions run in `arn1` (Stockholm).

## Connect for testing

- **Claude:** Settings → Connectors → Add custom connector → `https://<relay>/mcp`.
- **ChatGPT:** Settings → Security → Developer mode, then add an MCP server with URL `https://<relay>/mcp` and OAuth.

## Test

```bash
pnpm --filter @wilm-ai/wilma-cli build
pnpm --filter @wilm-ai/relay test
```

Runs the full OAuth + MCP flow against a mock Wilma.
