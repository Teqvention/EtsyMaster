import { Suspense } from "react"

import { ShopAnalysisView } from "@/components/shops/shop-analysis-view"
import { DISPLAY_CURRENCY } from "@/lib/etsy/listings"

export default function ShopsPage() {
  return (
    <Suspense>
      <ShopAnalysisView currency={DISPLAY_CURRENCY} />
    </Suspense>
  )
}
