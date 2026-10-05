# wilm.ai

The WilmAI website: one bilingual page (`/en`, `/fi`), built with Next.js as
static files and served by Cloudflare Workers.

- `app/`, `components/`, `lib/` — the page; all copy is in `lib/i18n.tsx` and `lib/agents.ts`
- `public/_headers` — security and cache headers
- `public/_redirects` — `/get/claude` (the Claude Desktop extension) and `/changes` (release notes, linked from the update notices)
- `public/og-en.png`, `public/og-fi.png` — the share images (what a link shows in WhatsApp, Facebook and the like), made from `og/card.html`: open it with `?lang=en` or `?lang=fi` at 1200×630 and screenshot it. Its copy follows the hero; update both together
- `worker/index.ts` — sends `/` to `/en` or `/fi` (the EN/FI choice, else the browser's language), and answers `/api/stats`: the CLI's npm downloads (the counter in the hero, `lib/npm-downloads.ts`) and the repository's GitHub stars (the chip in the top bar, `lib/github-stars.ts`). A cron job fetches both once a day (04:00 UTC) and keeps them in the `STATS` KV namespace (`wilmai-site-stats`); the page starts with the numbers from build time. A failed fetch keeps the last value, is logged, and fails that day's cron run: see it in Workers Logs and Workers Issues (the Worker's Observability tab), which can alert through an Issues automation
- `wrangler.jsonc` — the Cloudflare Worker (account Wilm.ai)

## Run locally

```bash
pnpm --filter @wilm-ai/site dev        # Next.js dev server; open /en or /fi
pnpm --filter @wilm-ai/site preview    # the real build on Cloudflare's runtime (wrangler dev)
```

`dev` doesn't apply `_headers`, `_redirects`, the `/` redirect or `/api/stats` (the counters keep the numbers from the build); `preview` does. Before the first daily job has run, `/api/stats` fetches the numbers itself; to run the job by hand, start `wrangler dev --test-scheduled` and open `/cdn-cgi/handler/scheduled`.

GitHub limits anonymous API requests per IP address, and Cloudflare's addresses are shared. If the star count stops updating, give the Worker a GitHub token (a fine-grained token with public read-only access and no permissions): `pnpm --filter @wilm-ai/site exec wrangler secret put GITHUB_TOKEN`.

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

wilm.ai is the Worker's custom domain (`routes` in `wrangler.jsonc`). www.wilm.ai →
wilm.ai is a redirect rule on the Cloudflare zone (not in this repository): Rules →
Redirect Rules, "Redirect from WWW to root", `https://www.*` → `https://${1}`,
301, query string kept. It needs the `www` DNS record to stay proxied.
