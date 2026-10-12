import { samplePhotoRef } from "@/lib/citys/sample"
import { respond } from "@/lib/mockups/respond"

// The city photo layouts are tried with: the newest approved city poster, else the newest one painted.
export async function GET() {
  return respond(async () => (await samplePhotoRef()) ?? { set: null, file: null })
}
