import { Suspense } from "react"

import { KeywordsView } from "@/components/keywords/keywords-view"
import { DISPLAY_CURRENCY } from "@/lib/etsy/listings"

export default function KeywordsPage() {
  return (
    <Suspense>
      <KeywordsView currency={DISPLAY_CURRENCY} />
    </Suspense>
  )
}
