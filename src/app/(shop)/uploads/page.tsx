import { Suspense } from "react"

import { UploadsView } from "@/components/uploads/uploads-view"

export default function UploadsPage() {
  return (
    <Suspense>
      <UploadsView />
    </Suspense>
  )
}
