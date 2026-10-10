import { Suspense } from "react"

import { PerformanceView } from "@/components/performance/performance-view"

export default function PerformancePage() {
  return (
    <Suspense>
      <PerformanceView />
    </Suspense>
  )
}
