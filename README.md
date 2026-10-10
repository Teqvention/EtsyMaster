# Etsy Dashboard

A seller dashboard for an Etsy shop: revenue/orders/visits KPIs, a sales chart,
and an orders table. Built with Next.js 16 (App Router, Cache Components),
Tailwind CSS v4, and [shadcn/ui](https://ui.shadcn.com) (`base-nova` style,
Base UI primitives), starting from the `dashboard-01` block.

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 — it redirects to `/dashboard`.

## Shared data

Everyone runs their own `pnpm dev` and works on the same data: a Postgres on
Dokploy (reached over Tailscale; its port isn't open to the internet) and a
Hetzner bucket for images and videos. `.env` needs:

```bash
ETSY_KEY_STRING=…
ETSY_SECRET=…
DATABASE_URL=postgres://postgres:<password>@<the database's Tailscale IP>:5432/postgres
S3_ENDPOINT=https://nbg1.your-objectstorage.com
S3_BUCKET=etsy-master
HETZNER_S3_ACCESS_KEY=…
HETZNER_S3_SECRET_KEY=…
```

plus `GOOGLE_APPLICATION_CREDENTIALS` in `.env.local` for Gemini. Your
machine has to be on the tailnet with the database server shared to it.

- **JSON data** (accounts, jobs, generations, scenes, sync, …) is in the
  `documents` table, keyed like the files it once was (`pricing/fx`,
  `generations/<id>/set`). Each server keeps what it read in memory; Postgres
  tells every server about each change, so they all stay current.
- **Images and videos** are private objects under `data/` in the bucket,
  indexed in the `files` table. Each one read is kept in `.cache/files/`, so
  it's downloaded once per machine.
- **Background work** (upload pipeline, daily sync, Artikel's bulk actions,
  the copywriter) runs on one dev server at a time, whichever holds the
  leader lock; when it stops, another takes over within seconds. Generation
  runs on the server that started it.

`pnpm data:push` copies a local `data/` folder into the database and bucket
(only what isn't there yet; `--dry` to see what it would do, `--overwrite`
to replace what differs). Run it after `scripts/import-mockups.py`, which
still writes to `data/mockups/`.

## Project layout

| Path | What it is |
| --- | --- |
| `src/app/(shop)/layout.tsx` | App shell shared by all pages: sidebar + header + a fixed content surface. Only the area inside the surface scrolls. |
| `src/app/(shop)/*/page.tsx` | One folder per page; each renders inside the surface. Live data streams in behind `<Suspense>`. |
| `src/components/nav-config.tsx` | Sidebar links and page titles. Add a page here, then create `src/app/(shop)/<slug>/page.tsx`. |
| `src/components/page-placeholder.tsx` | "Coming soon" stand-in used by pages that aren't built yet. |
| `src/lib/etsy/data.ts` | Data access. **Currently returns deterministic mock data.** |
| `src/lib/etsy/types.ts` | The shapes the UI renders (`Order`, `DailyStat`, `ShopSummary`, …). |
| `src/lib/etsy/format.ts` | Currency / number / date formatting. |
| `src/components/section-cards.tsx` | KPI cards (revenue, orders, visits, conversion). |
| `src/components/sales-chart.tsx` | Revenue / orders / visits over 7d / 30d / 90d. |
| `src/components/orders-table.tsx` | Orders table: status tabs, search, sorting, paging. |
| `src/components/ui/*` | shadcn components — add more with `pnpm dlx shadcn@latest add <name>`. |

## Connecting real Etsy data

Replace the bodies of the functions in `src/lib/etsy/data.ts` with calls to the
[Etsy Open API v3](https://developers.etsy.com/documentation/) and map the
responses into the types in `src/lib/etsy/types.ts`. Useful endpoints:

- Orders: `GET /v3/application/shops/{shop_id}/receipts`
- Shop: `GET /v3/application/shops/{shop_id}`
- Listings: `GET /v3/application/shops/{shop_id}/listings/active`

The Open API requires an app key (`x-api-key`) plus an OAuth 2.0 (PKCE) access
token with the `transactions_r` and `shops_r` scopes. Etsy's public API has no
endpoint for shop visit stats, so visits and conversion rate need another
source (or can be dropped).

## Theming

The Etsy orange lives in `--brand` in `src/app/globals.css` and also drives
`--chart-1`. Dark mode uses a slightly deeper orange so the chart line stays
legible on the dark surface. Use the sun/moon button in the header to switch
themes.
