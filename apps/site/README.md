# wilm.ai

The WilmAI website: one bilingual page (`/en`, `/fi`), built with Next.js as
static files and served by Cloudflare Workers.

- `app/`, `components/`, `lib/` — the page; all copy is in `lib/i18n.tsx` and `lib/agents.ts`
- `public/_headers` — security and cache headers
- `public/_redirects` — `/get/claude` (the Claude Desktop extension)
- `worker/index.ts` — sends `/` to `/en` or `/fi` (the EN/FI choice, else the browser's language)
- `wrangler.jsonc` — the Cloudflare Worker (account Wilm.ai)

## Run locally

```bash
pnpm --filter @wilm-ai/site dev        # Next.js dev server; open /en or /fi
pnpm --filter @wilm-ai/site preview    # the real build on Cloudflare's runtime (wrangler dev)
```

`dev` doesn't apply `_headers`, `_redirects` or the `/` redirect; `preview` does.

## Deploy

Cloudflare builds and deploys the site from GitHub (Workers Builds). It's
connected in the dashboard: Workers & Pages → `wilmai-site` → Settings → Build.
Every push to `main` deploys wilm.ai; other branches get their own preview link.
The build settings live in the dashboard, so here they are:

| Setting | Value |
|---|---|
| Git repository | `aikarjal/wilmai`, production branch `main` |
| Root directory | `apps/site` |
| Build command | `pnpm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | `apps/site/*` |
| Preview builds | on: other branches and pull requests get a public preview link on workers.dev |
| Build cache | on: keeps pnpm downloads and Next's build cache between builds; clear it there if a build acts oddly |

By hand, from this computer (needs `wrangler login` with access to the Wilm.ai account):

```bash
pnpm --filter @wilm-ai/site run deploy
```

www.wilm.ai → wilm.ai is a redirect rule on the Cloudflare zone (not in this
repository): a proxied `www` DNS record plus a single redirect rule,
`https://www.wilm.ai/*` → `https://wilm.ai/${1}`, status 301, query string kept.
