import { Suspense } from "react"

import { StyleLab } from "@/components/citys/styles/style-lab"

export default function CityStylePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <StyleLab id={params.then((p) => p.id)} />
    </Suspense>
  )
}
