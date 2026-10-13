import { listSets, readSetFile } from "@/lib/generation/storage"
import { fetchReference, placeSheets } from "@/lib/mockups/reference"
import { respond } from "@/lib/mockups/respond"
import { fileKey, getScene } from "@/lib/mockups/storage"
import { deleteFile } from "@/lib/storage/files"

// Gemini looks twice (the room, the photo it came from), well under a minute.
export const maxDuration = 120

type Context = RouteContext<"/api/mockups/[id]/locate">

// The editor's "Detect again": every sheet in the scene's room found afresh,
// its posters made new with light and shine, and what stands in front of
// them cut out onto "In front of poster". The photo it was stolen from (its
// generation set's, or its Etsy source) helps where there is one. Answers
// with the scene.
export async function POST(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    const scene = await getScene(id)
    const set = (await listSets()).find((s) => s.kind === "mockup" && s.sceneId === id)
    const photo =
      set?.original.status === "done" && set.original.file
        ? await readSetFile(set.id, set.original.file).catch(() => null)
        : scene.source?.startsWith("https://")
          ? await fetchReference(scene.source).catch(() => null)
          : null
    const next = await placeSheets(scene, photo)
    // The grid draws its picture again with the new posters.
    await deleteFile(fileKey(id, "thumb.jpg")).catch(() => {})
    return next
  })
}
