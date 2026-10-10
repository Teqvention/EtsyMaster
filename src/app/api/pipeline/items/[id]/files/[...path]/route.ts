import { connection } from "next/server"

import { NotFoundError } from "@/lib/mockups/storage"
import { itemFile } from "@/lib/pipeline/files"
import { getFile } from "@/lib/storage/files"

type Context = RouteContext<"/api/pipeline/items/[id]/files/[...path]">

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
}

// A file an item made, by its path in the item's folder: media/01.jpg,
// media/video.mp4, print/r1414.jpg. Byte ranges, because Safari won't play a
// video without them. Files are made again on a re-run, so never cached.
export async function GET(request: Request, { params }: Context) {
  await connection()
  const { id, path } = await params
  const type = TYPES[path.at(-1)?.split(".").pop()?.toLowerCase() ?? ""]
  if (!type) return new Response(null, { status: 404 })
  try {
    const data = await getFile(itemFile(id, path.join("/")))
    const headers = { "Content-Type": type, "Cache-Control": "no-cache", "Accept-Ranges": "bytes" }
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
    const missing = error instanceof NotFoundError || (error as NodeJS.ErrnoException).code === "ENOENT"
    return new Response(null, { status: missing ? 404 : 500 })
  }
}
