import { Suspense } from "react"

import { StylesView } from "@/components/styles/styles-view"

export default function StylesPage() {
  return (
    <Suspense>
      <StylesView />
    </Suspense>
  )
}
