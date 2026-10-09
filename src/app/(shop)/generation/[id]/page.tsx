import { Suspense } from "react"

import { SetView } from "@/components/generation/set-view"

export default function GenerationSetPage({ params }: PageProps<"/generation/[id]">) {
  return (
    <Suspense>
      <SetView id={params.then((p) => p.id)} />
    </Suspense>
  )
}
