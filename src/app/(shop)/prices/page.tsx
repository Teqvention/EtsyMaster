import { Suspense } from "react"

import { PricesView } from "@/components/prices/prices-view"

export default function PricesPage() {
  return (
    <Suspense>
      <PricesView />
    </Suspense>
  )
}
