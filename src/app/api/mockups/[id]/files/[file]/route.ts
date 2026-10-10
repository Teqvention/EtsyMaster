import { respond } from "@/lib/mockups/respond"
import { NotFoundError, readSceneFile, saveFile } from "@/lib/mockups/storage"

type Context = RouteContext<"/api/mockups/[id]/files/[file]">

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
}

// A layer image or clip preview. Editors re-request with ?v=<n> after
// saving, so the browser may keep each version. Byte ranges, because Safari
// won't play a video without them.
export async function GET(request: Request, { params }: Context) {
  const { id, file } = await params
  try {
    const data = await readSceneFile(id, file)
    const headers = {
      "Content-Type": TYPES[file.split(".").pop()!.toLowerCase()],
      "Cache-Control": "no-cache",
      "Accept-Ranges": "bytes",
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "")
    if (range && (range[1] || range[2])) {
      const size = data.length
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
      }
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` },
      })
    }
    return new Response(new Uint8Array(data), { headers })
  } catch (error) {
    const missing =
      error instanceof NotFoundError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    return new Response(null, { status: missing ? 404 : 500 })
  }
}

// Replace or add a layer image or clip preview (raw body).
export async function PUT(request: Request, { params }: Context) {
  const { id, file } = await params
  const data = Buffer.from(await request.arrayBuffer())
  return respond(() => saveFile(id, file, data))
}
