import { Suspense } from "react"

import { CityStylesView } from "@/components/citys/styles/city-styles-view"

export default function CityStylesPage() {
  return (
    <Suspense>
      <CityStylesView />
    </Suspense>
  )
}
