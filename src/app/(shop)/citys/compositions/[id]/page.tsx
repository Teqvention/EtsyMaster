import { Suspense } from "react"

import { CompositionEditor } from "@/components/citys/compositions/editor"

export default function CityCompositionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <CompositionEditor id={params.then((p) => p.id)} />
    </Suspense>
  )
}
