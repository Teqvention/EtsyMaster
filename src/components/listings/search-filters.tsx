"use client"

import * as React from "react"
import { SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Category, ListingQuery, ListingSort } from "@/lib/etsy/types"

const SORTS: { value: ListingSort; label: string }[] = [
  { value: "score", label: "Most relevant" },
  { value: "sales", label: "Top sellers" },
  { value: "created", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
]

const ALL = "all"

// Text fields apply on Enter (each search spends API quota); the dropdowns
// apply immediately. Remount with a `key` to reset drafts from the URL.
export function SearchFilters({
  query,
  categories,
  currency,
  onChange,
}: {
  query: ListingQuery
  categories: Category[]
  currency: string
  onChange: (query: ListingQuery) => void
}) {
  const [draft, setDraft] = React.useState({
    keywords: query.keywords,
    min: query.minPrice?.toString() ?? "",
    max: query.maxPrice?.toString() ?? "",
    location: query.shopLocation ?? "",
  })

  const categoryItems = React.useMemo(
    () => [
      { value: ALL, label: "All categories" },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories]
  )

  function apply(overrides: Partial<ListingQuery> = {}) {
    const number = (value: string) => (value.trim() === "" ? undefined : Number(value))
    onChange({
      ...query,
      keywords: draft.keywords.trim(),
      minPrice: number(draft.min),
      maxPrice: number(draft.max),
      shopLocation: draft.location.trim() || undefined,
      ...overrides,
    })
  }

  const field =
    (name: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [name]: event.target.value }))

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      className="flex flex-wrap items-center gap-2 px-4 lg:px-6"
    >
      <div className="relative min-w-60 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={draft.keywords}
          onChange={field("keywords")}
          placeholder="Search Etsy listings…"
          aria-label="Keywords"
          className="pl-8"
          autoFocus={!query.keywords}
        />
      </div>

      <Select
        value={query.categoryId?.toString() ?? ALL}
        items={categoryItems}
        onValueChange={(value) =>
          apply({ categoryId: !value || value === ALL ? undefined : Number(value) })
        }
      >
        <SelectTrigger className="w-44" aria-label="Category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categoryItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.sort}
        items={SORTS}
        onValueChange={(value) => value && apply({ sort: value as ListingSort })}
      >
        <SelectTrigger className="w-40" aria-label="Sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={draft.min}
          onChange={field("min")}
          placeholder={`Min ${currency}`}
          aria-label={`Minimum price in ${currency}`}
          className="w-24 tabular-nums"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={draft.max}
          onChange={field("max")}
          placeholder={`Max ${currency}`}
          aria-label={`Maximum price in ${currency}`}
          className="w-24 tabular-nums"
        />
      </div>

      <Input
        value={draft.location}
        onChange={field("location")}
        placeholder="Shop location"
        aria-label="Shop location"
        className="w-36"
      />

      <Button type="submit">Search</Button>
    </form>
  )
}
