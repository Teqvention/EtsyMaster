import { Suspense } from "react"

import { RankingView } from "@/components/citys/ranking-view"

export default function CityRankingPage() {
  return (
    <Suspense>
      <RankingView />
    </Suspense>
  )
}
