import { respond } from "@/lib/mockups/respond"
import { addImages, readGenerationFile } from "@/lib/styles/storage"
import { scheduleReading } from "@/lib/styles/understand"

type Context = RouteContext<"/api/styles/[id]/images">

const MAX_BYTES = 25 * 1024 * 1024

// Adds images to the end of the moodboard: uploaded files (multipart field
// `files`), or posters from the Generation page (JSON `{ generation, file }`,
// or `{ items: [{ generation, file }] }` for several). The guide is read
// again shortly after.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const type = request.headers.get("content-type") ?? ""

  let items: { data: Buffer; from?: string }[]
  try {
    items = type.includes("multipart/form-data") ? await uploads(request) : await fromGenerations(request)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
  if (items.length === 0) return Response.json({ error: "No images" }, { status: 400 })

  return respond(async () => {
    const style = await addImages(id, items)
    await scheduleReading(id)
    return style
  })
}

async function uploads(request: Request) {
  const form = await request.formData()
  const files = form.getAll("files").filter((f): f is File => f instanceof File)
  if (files.some((f) => f.size > MAX_BYTES)) throw new Error("Images can be up to 25 MB")
  return Promise.all(files.map(async (f) => ({ data: Buffer.from(await f.arrayBuffer()) })))
}

async function fromGenerations(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    generation?: unknown
    file?: unknown
    items?: unknown
  }
  const list = Array.isArray(body.items) ? body.items : [body]
  const picks = list.filter(
    (p): p is { generation: string; file: string } =>
      typeof p?.generation === "string" && typeof p?.file === "string"
  )
  if (picks.length !== list.length) throw new Error("Each image needs a generation and a file")
  return Promise.all(
    picks.map(async ({ generation, file }) => {
      try {
        return { data: await readGenerationFile(generation, file), from: `${generation}/${file}` }
      } catch {
        throw new Error("That generated image is gone")
      }
    })
  )
}
