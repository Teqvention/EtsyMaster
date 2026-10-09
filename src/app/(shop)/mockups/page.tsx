import { Suspense } from "react"

import { MockupsView } from "@/components/mockups/mockups-view"

export default function MockupsPage() {
  return (
    <Suspense>
      <MockupsView />
    </Suspense>
  )
}
