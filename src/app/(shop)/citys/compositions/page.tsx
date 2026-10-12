import { Suspense } from "react"

import { CompositionsView } from "@/components/citys/compositions/compositions-view"

export default function CityCompositionsPage() {
  return (
    <Suspense>
      <CompositionsView />
    </Suspense>
  )
}
