import { Suspense } from "react"

import { MockupEditor } from "@/components/mockups/mockup-editor"

export default function MockupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <MockupEditor id={params.then((p) => p.id)} />
    </Suspense>
  )
}
