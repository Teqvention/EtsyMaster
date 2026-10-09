import { Suspense } from "react"

import { SavedView } from "@/components/saved/saved-view"
import { DISPLAY_CURRENCY } from "@/lib/etsy/listings"

export default function SavedPage() {
  return (
    <Suspense>
      <SavedView currency={DISPLAY_CURRENCY} />
    </Suspense>
  )
}
