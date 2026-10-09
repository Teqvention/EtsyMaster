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
