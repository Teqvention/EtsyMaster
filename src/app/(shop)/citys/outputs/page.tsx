import { Suspense } from "react"

import { OutputsView } from "@/components/citys/outputs-view"

export default function CityOutputsPage() {
  return (
    <Suspense>
      <OutputsView />
    </Suspense>
  )
}
