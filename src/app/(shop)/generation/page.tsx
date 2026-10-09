import { Suspense } from "react"

import { GenerationView } from "@/components/generation/generation-view"

export default function GenerationPage() {
  return (
    <Suspense>
      <GenerationView />
    </Suspense>
  )
}
