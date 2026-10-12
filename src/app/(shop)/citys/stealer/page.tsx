import { Suspense } from "react"

import { StealerView } from "@/components/citys/stealer/stealer-view"

export default function CityStealerPage() {
  return (
    <Suspense>
      <StealerView />
    </Suspense>
  )
}
