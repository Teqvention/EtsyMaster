import { Suspense } from "react"

import { StyleDetail } from "@/components/styles/style-detail"

export default function StylePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <StyleDetail id={params.then((p) => p.id)} />
    </Suspense>
  )
}
