import { respond } from "@/lib/mockups/respond"
import { planUpload, saveUploadSettings, type CityUploadSettings } from "@/lib/citys/upload"

// The upload order the groups make (saving them first when sent): which
// posters go where, in which order, which slots they take, what's left out.
export async function POST(request: Request) {
  const patch = (await request.json().catch(() => null)) as Partial<CityUploadSettings> | null
  return respond(async () => planUpload(await saveUploadSettings(patch ?? {})))
}
