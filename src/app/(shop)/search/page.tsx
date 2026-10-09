import { Suspense } from "react"

import { SearchView } from "@/components/listings/search-view"
import { DISPLAY_CURRENCY, getCategories } from "@/lib/etsy/listings"

export default function SearchPage() {
  return (
    <Suspense>
      <Search />
    </Suspense>
  )
}

// Categories are cached for weeks; a failure only costs the category filter.
async function Search() {
  const categories = await getCategories().catch(() => [])
  return <SearchView categories={categories} currency={DISPLAY_CURRENCY} />
}
