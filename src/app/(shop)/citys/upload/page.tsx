import { Suspense } from "react"

import { UploadView } from "@/components/citys/upload/upload-view"

export default function CityUploadPage() {
  return (
    <Suspense>
      <UploadView />
    </Suspense>
  )
}
