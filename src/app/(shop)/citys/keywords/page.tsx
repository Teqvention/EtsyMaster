import { Suspense } from "react"

import { KeywordsView } from "@/components/citys/keywords/keywords-view"

export default function CityKeywordsPage() {
  return (
    <Suspense>
      <KeywordsView />
    </Suspense>
  )
}
