import type { Metadata } from "next"

import { RenderHost } from "./render-host"

// The upload pipeline's renderer: headless Chrome opens this page to draw a
// mockup chain's listing photos and video (lib/pipeline/render.ts drives it).
// Nothing here for a person; it sits outside the shop layout on purpose.

export const metadata: Metadata = { title: "Renderer", robots: { index: false, follow: false } }

export default function RenderPage() {
  return <RenderHost />
}
