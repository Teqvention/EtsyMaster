import { Suspense } from "react"

import { LikedView } from "@/components/listings/liked-view"
import { DISPLAY_CURRENCY } from "@/lib/etsy/listings"

export default function LikedPage() {
  return (
    <Suspense>
      <LikedView currency={DISPLAY_CURRENCY} />
    </Suspense>
  )
}
