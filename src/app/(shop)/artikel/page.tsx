import { Suspense } from "react"

import { ArtikelView } from "@/components/artikel/artikel-view"

export default function ArtikelPage() {
  return (
    <Suspense>
      <ArtikelView />
    </Suspense>
  )
}
